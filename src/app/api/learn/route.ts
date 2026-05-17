import { createSSEStream, sseResponse } from "@/lib/sse";
import { browserAgent } from "@/lib/agents/browser-agent";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import { graphAgent } from "@/lib/agents/graph-agent";
import { decompositionAgent } from "@/lib/agents/decomposition-agent";
import { visualizationAgent } from "@/lib/agents/visualization-agent";
import { buildLessonPathway, buildRelatedNodeEdges, slugTopic, type ExistingLessonNode } from "@/lib/lesson-pathway";
import { getGbrainDiagnostic, getProfile, putConceptMemory, putLesson, putResearch, queryContext, safeSessionId, touchSession } from "@/lib/gbrain";
import type { Lesson, GraphNode, GraphEdge, LearnerProfile, Source, SSEEvent } from "@/lib/types";

const responseCache = new Map<
  string,
  { lesson: Lesson; nodes: GraphNode[]; edges: GraphEdge[] }
>();

const DEFAULT_PROFILE = {
  languageLevel: "intermediate" as const,
  visualPreference: "diagrams" as const,
  weakAreas: [] as string[],
  completedTopics: [] as string[],
};

const GBRAIN_READ_TIMEOUT_MS = Number(process.env.GBRAIN_READ_TIMEOUT_MS || 1500);
const GBRAIN_WRITE_TIMEOUT_MS = Number(process.env.GBRAIN_WRITE_TIMEOUT_MS || 2500);
const MAX_INLINE_LESSONS = Number(process.env.MAX_INLINE_LESSONS || 1);
const PARALLEL_LESSONS = process.env.PARALLEL_LESSONS === "true";
let memoryWriteQueue: Promise<unknown> = Promise.resolve();

export async function POST(req: Request) {
  const body = (await req.json()) as {
    topic: string;
    sessionId?: string;
    nodeId?: string;
    mode?: "full" | "single";
    existingNodes?: ExistingLessonNode[];
    clientMemory?: {
      profile?: Partial<LearnerProfile>;
      context?: string[];
    };
  };
  const { topic, sessionId = "anonymous", nodeId, mode, existingNodes = [] } = body;
  const clientMemory = normalizeClientMemory(body.clientMemory);
  const normalizedTopic = topic.trim().toLowerCase();
  const topicId = slugTopic(normalizedTopic);
  const sid = safeSessionId(sessionId);
  const cacheKey = `${sid}:${normalizedTopic}`;

  const { readable, emit, close } = createSSEStream();

  (async () => {
    const start = Date.now();
    const metrics: Record<string, number | string> = {
      sessionId: sid,
    };

    try {
      emit({ type: "browser.searching", query: `Starting pipeline for "${topic}"` });

      const memoryStart = Date.now();
      const memory = await withTimeout(
        loadMemory(sid, topic, existingNodes, clientMemory),
        GBRAIN_READ_TIMEOUT_MS,
        { profile: DEFAULT_PROFILE, context: [] as string[], online: false }
      );
      metrics.gbrain_read_ms = Date.now() - memoryStart;
      if (memory.online) {
        emit({ type: "gbrain.context_loaded", sessionId: sid, count: memory.context.length });
      } else {
        emit({ type: "gbrain.offline", reason: "read_timeout_or_failed", diagnostic: getGbrainDiagnostic() });
      }
      emitMetric("gbrain_read_ms", metrics.gbrain_read_ms, emit);

      // Cache replay
      const cached = responseCache.get(cacheKey);
      if (cached) {
        emit({ type: "browser.searching", query: `${topic} (cached)` });
        for (const source of cached.lesson.sources) emit({ type: "browser.source_found", source });
        emit({ type: "lesson.writing", topic });
        if (cached.lesson.visualization) emit({ type: "lesson.visualization", description: cached.lesson.visualization });
        emit({ type: "lesson.quiz_generated", lesson: cached.lesson });
        for (const node of cached.nodes) emit({ type: "graph.node_added", node });
        for (const edge of cached.edges) emit({ type: "graph.edge_added", edge });
        emit({ type: "pipeline.complete", totalMs: Date.now() - start });
        return;
      }

      // ② Browser Agent (Tavily search)
      const searchStart = Date.now();
      const sources = await browserAgent(topic, emit);
      metrics.search_ms = Date.now() - searchStart;
      emitMetric("search_ms", metrics.search_ms, emit);

      // Single-lesson mode: skip decomposition, generate one lesson directly
      if (mode === "single") {
        const lessonStart = Date.now();
        const lesson = await lessonAgent(topic, sources, emit, nodeId);
        metrics.lesson_generation_ms = Date.now() - lessonStart;
        emitMetric("lesson_generation_ms", metrics.lesson_generation_ms, emit);
        try { await visualizationAgent(lesson, emit); } catch {}
        queueMemoryWrite({ sid, topic, topicId, sources, lessons: [lesson], metrics, emit });
        emit({ type: "pipeline.complete", totalMs: Date.now() - start });
        return;
      }

      // ③ Root lesson — generate for the search topic itself
      const rootLessonStart = Date.now();
      let rootLesson: Lesson | null = null;
      try {
        rootLesson = await lessonAgent(topic, sources, emit, topicId);
      } catch {
        // Root lesson failed — will still decompose into branches
      }
      metrics.root_lesson_ms = Date.now() - rootLessonStart;
      emitMetric("root_lesson_ms", metrics.root_lesson_ms, emit);

      // ④ Decomposition Agent
      const decompositionStart = Date.now();
      const { plans } = await decompositionAgent(topic, sources, memory.profile, emit);
      metrics.decomposition_ms = Date.now() - decompositionStart;
      emitMetric("decomposition_ms", metrics.decomposition_ms, emit);
      const effectivePlans = plans.length > 0
        ? plans
        : [{ subTopic: topic, focus: topic, visualStyle: "diagram" as const, prerequisiteOf: null }];

      // ④b Emit branch nodes so frontend has targets before lessons arrive
      const pathway = buildLessonPathway(topicId, effectivePlans);
      const planNodeIds = pathway.nodeIds;
      const existingById = new Map(existingNodes.map((node) => [node.id, node]));
      for (const node of pathway.nodes) {
        emit({ type: "graph.node_added", node });
      }
      for (const edge of pathway.edges) {
        emit({ type: "graph.edge_added", edge });
      }
      for (const edge of buildRelatedNodeEdges({
        topicId,
        topic,
        pathwayNodes: pathway.nodes,
        existingNodes,
        gbrainContext: memory.context,
      })) {
        emit({ type: "graph.edge_added", edge, source: memory.online ? "gbrain.related" : "related" });
      }

      // ⑤ Generate the first missing lesson only. Branch lessons are generated on tap.
      const planContext = effectivePlans.map((plan, index) => ({
        focus: plan.focus,
        visualStyle: plan.visualStyle,
        prerequisiteOf: plan.prerequisiteOf,
        previousTopic: effectivePlans[index - 1]?.subTopic,
        nextTopic: effectivePlans[index + 1]?.subTopic || plan.prerequisiteOf || undefined,
      }));

      const lessons: Lesson[] = [];
      const lessonStart = Date.now();

      // Build list of lessons to generate (respecting MAX_INLINE_LESSONS and existing)
      const toGenerate: Array<{ plan: typeof effectivePlans[0]; nodeId: string; context: typeof planContext[0] }> = [];
      for (let i = 0; i < effectivePlans.length && toGenerate.length < MAX_INLINE_LESSONS; i++) {
        const targetNode = existingById.get(planNodeIds[i]);
        if (targetNode?.hasLesson) continue;
        toGenerate.push({ plan: effectivePlans[i], nodeId: planNodeIds[i], context: planContext[i] });
      }

      if (PARALLEL_LESSONS) {
        // Parallel: local Ollama with plenty of resources
        const results = await Promise.allSettled(
          toGenerate.map(({ plan, nodeId, context }) =>
            lessonAgent(plan.subTopic, sources, emit, nodeId, context)
          )
        );
        for (const r of results) {
          if (r.status === "fulfilled") lessons.push(r.value);
        }
      } else {
        // Sequential: shared/remote Ollama with limited resources
        for (const { plan, nodeId, context } of toGenerate) {
          try {
            const lesson = await lessonAgent(plan.subTopic, sources, emit, nodeId, context);
            lessons.push(lesson);
          } catch {
            // Lesson failed — skip it, continue with next
          }
        }
      }
      metrics.lesson_generation_ms = Date.now() - lessonStart;

      // Combine root + branch lessons
      const allLessons: Lesson[] = [];
      if (rootLesson) allLessons.push(rootLesson);
      allLessons.push(...lessons);
      metrics.cards_generated_count = allLessons.length;
      emitMetric("lesson_generation_ms", metrics.lesson_generation_ms, emit);
      emitMetric("cards_generated_count", allLessons.length, emit);

      if (allLessons.length === 0) {
        throw new Error("All lesson agents failed");
      }

      // ⑤b Visualization Agent — generate visuals for each lesson
      for (const lesson of allLessons) {
        try { await visualizationAgent(lesson, emit); } catch {}
      }

      // ⑥ Graph Agent is optional; heuristic graph/pathway is the default demo path.
      const existingNodeIds = [topicId, ...planNodeIds];
      let newNodes: GraphNode[] = [];
      let newEdges: GraphEdge[] = [];
      if (process.env.ENABLE_GRAPH_AGENT === "true") {
        const graphStart = Date.now();
        try {
          const graphResult = await graphAgent(topic, allLessons[0], existingNodeIds, emit);
          newNodes = graphResult.newNodes;
          newEdges = graphResult.newEdges;
        } catch {
          // Graph agent failed — not critical
        } finally {
          metrics.graph_generation_ms = Date.now() - graphStart;
          emitMetric("graph_generation_ms", metrics.graph_generation_ms, emit);
        }
      }

      // Cache first lesson for quick replay
      responseCache.set(cacheKey, { lesson: allLessons[0], nodes: newNodes, edges: newEdges });
      queueMemoryWrite({ sid, topic, topicId, sources, lessons: allLessons, metrics, emit });

      // ⑧ Pipeline complete
      emit({ type: "pipeline.complete", totalMs: Date.now() - start });
    } catch (err) {
      emit({ type: "pipeline.error", error: String(err) });
    } finally {
      close();
    }
  })();

  return sseResponse(readable);
}

async function loadMemory(
  sid: string,
  topic: string,
  existingNodes: ExistingLessonNode[],
  clientMemory: { profile: LearnerProfile; context: string[]; hasMemory: boolean }
): Promise<{ profile: LearnerProfile; context: string[]; online: boolean }> {
  if (clientMemory.hasMemory || process.env.DISABLE_GBRAIN === "true") {
    return {
      profile: clientMemory.profile,
      context: clientMemory.context,
      online: true,
    };
  }

  const [profile, context] = await Promise.all([
    getProfile(sid),
    queryContext(sid, [topic, ...existingNodes.map((node) => node.topic)].join(" ")),
  ]);

  return { profile, context, online: !getGbrainDiagnostic().lastError };
}

function normalizeClientMemory(input: unknown): { profile: LearnerProfile; context: string[]; hasMemory: boolean } {
  const value = input && typeof input === "object"
    ? input as { profile?: Partial<LearnerProfile>; context?: unknown }
    : {};
  const profile = value.profile || {};
  const context = Array.isArray(value.context)
    ? value.context.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 600)).slice(-16)
    : [];
  const visualPreference = profile.visualPreference && ["graphs", "diagrams", "animations", "examples"].includes(profile.visualPreference)
    ? profile.visualPreference
    : DEFAULT_PROFILE.visualPreference;
  const languageLevel = profile.languageLevel && ["beginner", "intermediate", "advanced"].includes(profile.languageLevel)
    ? profile.languageLevel
    : DEFAULT_PROFILE.languageLevel;

  return {
    profile: {
      languageLevel,
      visualPreference,
      weakAreas: Array.isArray(profile.weakAreas) ? profile.weakAreas.filter(Boolean).map(String).slice(0, 12) : [],
      completedTopics: Array.isArray(profile.completedTopics) ? profile.completedTopics.filter(Boolean).map(String).slice(0, 24) : [],
    },
    context,
    hasMemory: context.length > 0 || Boolean(profile.weakAreas?.length) || Boolean(profile.completedTopics?.length),
  };
}

function queueMemoryWrite(args: {
  sid: string;
  topic: string;
  topicId: string;
  sources: Source[];
  lessons: Lesson[];
  metrics: Record<string, number | string>;
  emit: (event: SSEEvent) => void;
}) {
  if (process.env.DISABLE_GBRAIN === "true") {
    args.emit({ type: "gbrain.memory_written", topic: args.topic, source: "local" });
    return;
  }

  args.emit({ type: "gbrain.memory_queued", topic: args.topic });
  memoryWriteQueue = memoryWriteQueue
    .catch(() => false)
    .then(() => withTimeout(writeMemory(args), GBRAIN_WRITE_TIMEOUT_MS, false))
    .then((ok) => {
      if (ok) args.emit({ type: "gbrain.memory_written", topic: args.topic });
    });
}

async function writeMemory(args: {
  sid: string;
  topic: string;
  topicId: string;
  sources: Source[];
  lessons: Lesson[];
  metrics: Record<string, number | string>;
}): Promise<boolean> {
  const writes: Array<() => Promise<boolean>> = [
    () => touchSession(args.sid, args.topic),
    () => putResearch(args.sid, args.topic, args.sources),
    () => putConceptMemory(
        args.sid,
        args.topic,
        [
          `Generated ${args.lessons.length} card(s).`,
          `Metrics: ${JSON.stringify(args.metrics)}`,
          `Next due for review: ${new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()}`,
        ].join("\n")
      ),
    ...args.lessons.map((lesson) => () => putLesson(args.sid, args.topic, args.topicId || lesson.title, lesson)),
  ];

  const results = [];
  for (const write of writes) {
    results.push(await write());
  }
  return results.every(Boolean);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function emitMetric(name: string, value: number | string, emit: (event: SSEEvent) => void) {
  emit({ type: "pipeline.metric", name, value });
}
