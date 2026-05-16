import { createSSEStream, sseResponse } from "@/lib/sse";
import { browserAgent } from "@/lib/agents/browser-agent";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import { graphAgent } from "@/lib/agents/graph-agent";
import { decompositionAgent } from "@/lib/agents/decomposition-agent";
import { visualizationAgent } from "@/lib/agents/visualization-agent";
import { getGbrainDiagnostic, getProfile, putResearch, putLesson, queryContext, touchSession, safeSessionId } from "@/lib/gbrain";
import { buildLessonPathway, buildRelatedNodeEdges, slugTopic, type ExistingLessonNode } from "@/lib/lesson-pathway";
import type { Lesson, GraphNode, GraphEdge } from "@/lib/types";

const responseCache = new Map<
  string,
  { lesson: Lesson; nodes: GraphNode[]; edges: GraphEdge[] }
>();

function rememberedPrerequisite(context: string[]): string | null {
  const text = context.join("\n").toLowerCase();
  if (text.includes("limits")) return "Limits";
  if (text.includes("power rule")) return "Power Rule";
  if (text.includes("chain rule")) return "Chain Rule";
  return null;
}

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

    try {
      const memoryOnline = await touchSession(sid, topic);
      if (!memoryOnline) {
        emit({ type: "gbrain.offline", reason: "session_touch_failed", diagnostic: getGbrainDiagnostic() });
      }

      const [profile, context] = await Promise.all([
        getProfile(sid),
        queryContext(sid, [topic, ...existingNodes.map((node) => node.topic)].join(" ")),
      ]);

      if (context.length > 0 || profile.weakAreas.length > 0 || profile.completedTopics.length > 0) {
        emit({ type: "gbrain.context_loaded", sessionId: sid, count: context.length });
      }

      // Cache replay
      const cached = context.length === 0 ? responseCache.get(cacheKey) : undefined;
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

      // ② Browser Agent
      const sources = await browserAgent(topic, emit);

      // Single-lesson mode: skip decomposition, generate one lesson directly
      if (mode === "single") {
        const lesson = await lessonAgent(topic, sources, emit, nodeId);
        await visualizationAgent(lesson, emit);
        putLesson(sid, topic, topicId, lesson).catch(() => {});
        emit({ type: "pipeline.complete", totalMs: Date.now() - start });
        return;
      }

      const contextHints = context.map((item) => item.slice(0, 160));
      const personalizedProfile = {
        ...profile,
        weakAreas: Array.from(new Set([...profile.weakAreas, ...contextHints])).slice(0, 8),
      };

      // ④ Decomposition Agent
      const { plans } = await decompositionAgent(topic, sources, personalizedProfile, emit);
      const basePlans = plans.length > 0 ? plans : [{ subTopic: topic, focus: topic, visualStyle: "diagram" as const, prerequisiteOf: null }];
      const prerequisite = rememberedPrerequisite([...profile.weakAreas, ...context]);
      const effectivePlans = prerequisite
        ? [
            {
              subTopic: prerequisite,
              focus: `${prerequisite} is blocking ${topic} for this learner`,
              visualStyle: "graph" as const,
              prerequisiteOf: topic,
            },
            ...basePlans.filter((plan) => plan.subTopic.toLowerCase() !== prerequisite.toLowerCase()),
          ]
        : basePlans;

      if (prerequisite) {
        emit({
          type: "decomposition.plan_created",
          plan: effectivePlans[0],
          source: "gbrain",
        });
      }

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
        gbrainContext: context,
      })) {
        emit({ type: "graph.edge_added", edge, source: "gbrain.related" });
      }

      // ⑤ Fan-out Lesson Agents (with nodeId routing)
      const planContext = effectivePlans.map((plan, index) => ({
        focus: plan.focus,
        visualStyle: plan.visualStyle,
        prerequisiteOf: plan.prerequisiteOf,
        previousTopic: effectivePlans[index - 1]?.subTopic,
        nextTopic: effectivePlans[index + 1]?.subTopic || plan.prerequisiteOf || undefined,
      }));
      let lessonResults: PromiseSettledResult<Lesson>[];
      if (prerequisite) {
        const secondaryResults = await Promise.allSettled(
          effectivePlans.slice(1).map((plan, i) => {
            const targetNode = existingById.get(planNodeIds[i + 1]);
            if (targetNode?.hasLesson) return Promise.reject(new Error("lesson already exists"));
            return lessonAgent(plan.subTopic, sources, emit, planNodeIds[i + 1], planContext[i + 1]);
          })
        );
        const primaryNode = existingById.get(planNodeIds[0]);
        const primaryResult: PromiseSettledResult<Lesson> = primaryNode?.hasLesson
          ? { status: "rejected", reason: new Error("lesson already exists") }
          : { status: "fulfilled", value: await lessonAgent(effectivePlans[0].subTopic, sources, emit, planNodeIds[0], planContext[0]) };
        lessonResults = [primaryResult, ...secondaryResults];
      } else {
        lessonResults = await Promise.allSettled(
          effectivePlans.map((plan, i) => {
            const targetNode = existingById.get(planNodeIds[i]);
            if (targetNode?.hasLesson) return Promise.reject(new Error("lesson already exists"));
            return lessonAgent(plan.subTopic, sources, emit, planNodeIds[i], planContext[i]);
          })
        );
      }
      const lessons = lessonResults
        .filter((r): r is PromiseFulfilledResult<Lesson> => r.status === "fulfilled")
        .map((r) => r.value);

      if (lessons.length === 0 && planNodeIds.every((id) => !existingById.get(id)?.hasLesson)) {
        throw new Error("All lesson agents failed");
      }

      // ⑥ Parallel: Visualization Agent + Graph Agent
      const existingNodeIds = [topicId, ...planNodeIds];
      const parallelResults = lessons.length > 0
        ? await Promise.allSettled([
            ...lessons.map((l) => visualizationAgent(l, emit)),
            graphAgent(topic, lessons[0], existingNodeIds, emit),
          ])
        : [];

      // Extract graph result (last item)
      const graphResult = parallelResults[parallelResults.length - 1];
      const { newNodes, newEdges } = graphResult?.status === "fulfilled"
        ? graphResult.value as { newNodes: GraphNode[]; newEdges: GraphEdge[] }
        : { newNodes: [] as GraphNode[], newEdges: [] as GraphEdge[] };

      // ⑦ Persist research and lessons
      const memoryWrites: Array<() => Promise<boolean>> = [() => putResearch(sid, topic, sources)];
      for (const lesson of lessons) {
        const subId = lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        memoryWrites.push(() => putLesson(sid, topic, subId, lesson));
      }
      let allWritten = true;
      for (const writeMemory of memoryWrites) {
        try {
          allWritten = (await writeMemory()) && allWritten;
        } catch {
          allWritten = false;
        }
      }
      emit(allWritten
        ? { type: "gbrain.memory_written", topic }
        : { type: "gbrain.offline", reason: "memory_write_failed", diagnostic: getGbrainDiagnostic() });

      // Cache first lesson for quick replay
      responseCache.set(cacheKey, { lesson: lessons[0], nodes: newNodes, edges: newEdges });

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
