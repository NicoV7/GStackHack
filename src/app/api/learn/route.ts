import { createSSEStream, sseResponse } from "@/lib/sse";
import { browserAgent } from "@/lib/agents/browser-agent";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import { graphAgent } from "@/lib/agents/graph-agent";
import { decompositionAgent } from "@/lib/agents/decomposition-agent";
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
let memoryWriteQueue: Promise<unknown> = Promise.resolve();

export async function POST(req: Request) {
  const { topic, sessionId = "anonymous", nodeId, mode, existingNodes = [] } = (await req.json()) as {
    topic: string;
    sessionId?: string;
    nodeId?: string;
    mode?: "full" | "single";
    existingNodes?: ExistingLessonNode[];
  };
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
        loadMemory(sid, topic, existingNodes),
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
        queueMemoryWrite({ sid, topic, topicId, sources, lessons: [lesson], metrics, emit });
        emit({ type: "pipeline.complete", totalMs: Date.now() - start });
        return;
      }

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
      for (let i = 0; i < effectivePlans.length; i++) {
        if (lessons.length >= MAX_INLINE_LESSONS) break;
        const targetNode = existingById.get(planNodeIds[i]);
        if (targetNode?.hasLesson) continue;
        try {
          const lesson = await lessonAgent(effectivePlans[i].subTopic, sources, emit, planNodeIds[i], planContext[i]);
          lessons.push(lesson);
        } catch {
          // Lesson failed — skip it, continue with next
        }
      }
      metrics.lesson_generation_ms = Date.now() - lessonStart;
      metrics.cards_generated_count = lessons.length;
      emitMetric("lesson_generation_ms", metrics.lesson_generation_ms, emit);
      emitMetric("cards_generated_count", lessons.length, emit);

      if (lessons.length === 0) {
        throw new Error("All lesson agents failed");
      }

      // ⑥ Graph Agent is optional; heuristic graph/pathway is the default demo path.
      const existingNodeIds = [topicId, ...planNodeIds];
      let newNodes: GraphNode[] = [];
      let newEdges: GraphEdge[] = [];
      if (process.env.ENABLE_GRAPH_AGENT === "true") {
        const graphStart = Date.now();
        try {
          const graphResult = await graphAgent(topic, lessons[0], existingNodeIds, emit);
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
      responseCache.set(cacheKey, { lesson: lessons[0], nodes: newNodes, edges: newEdges });
      queueMemoryWrite({ sid, topic, topicId, sources, lessons, metrics, emit });

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
  existingNodes: ExistingLessonNode[]
): Promise<{ profile: LearnerProfile; context: string[]; online: boolean }> {
  const [profile, context] = await Promise.all([
    getProfile(sid),
    queryContext(sid, [topic, ...existingNodes.map((node) => node.topic)].join(" ")),
  ]);

  return { profile, context, online: !getGbrainDiagnostic().lastError };
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
