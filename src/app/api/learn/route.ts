import { createSSEStream, sseResponse } from "@/lib/sse";
import { browserAgent } from "@/lib/agents/browser-agent";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import { graphAgent } from "@/lib/agents/graph-agent";
import { decompositionAgent } from "@/lib/agents/decomposition-agent";
import { visualizationAgent } from "@/lib/agents/visualization-agent";
import { getProfile, putResearch, putLesson } from "@/lib/gbrain";
import type { Lesson, GraphNode, GraphEdge } from "@/lib/types";

const responseCache = new Map<
  string,
  { lesson: Lesson; nodes: GraphNode[]; edges: GraphEdge[] }
>();

export async function POST(req: Request) {
  const { topic, sessionId = "anonymous" } = (await req.json()) as { topic: string; sessionId?: string };
  const normalizedTopic = topic.trim().toLowerCase();
  const topicId = normalizedTopic.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const { readable, emit, close } = createSSEStream();

  (async () => {
    const start = Date.now();

    try {
      // Cache replay
      const cached = responseCache.get(normalizedTopic);
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

      // ① Read learner profile
      const profile = await getProfile(sessionId);
      if (profile.weakAreas.length > 0 || profile.completedTopics.length > 0) {
        emit({ type: "gbrain.context_loaded", sessionId });
      }

      // ② Browser Agent
      const sources = await browserAgent(topic, emit);

      // ③ Persist research (fire-and-forget)
      putResearch(sessionId, topic, sources).catch(() => {});

      // ④ Decomposition Agent
      const { plans } = await decompositionAgent(topic, sources, profile, emit);
      const effectivePlans = plans.length > 0 ? plans : [{ subTopic: topic, focus: topic, visualStyle: "diagram" as const, prerequisiteOf: null }];

      // ⑤ Fan-out Lesson Agents
      const lessonResults = await Promise.allSettled(
        effectivePlans.map((plan) => lessonAgent(plan.subTopic, sources, emit))
      );
      const lessons = lessonResults
        .filter((r): r is PromiseFulfilledResult<Lesson> => r.status === "fulfilled")
        .map((r) => r.value);

      if (lessons.length === 0) throw new Error("All lesson agents failed");

      // ⑥ Parallel: Visualization Agent + Graph Agent
      const existingNodeIds = [topicId];
      const parallelResults = await Promise.allSettled([
        ...lessons.map((l) => visualizationAgent(l, emit)),
        graphAgent(topic, lessons[0], existingNodeIds, emit),
      ]);

      // Extract graph result (last item)
      const graphResult = parallelResults[parallelResults.length - 1];
      const { newNodes, newEdges } = graphResult.status === "fulfilled"
        ? graphResult.value as { newNodes: GraphNode[]; newEdges: GraphEdge[] }
        : { newNodes: [] as GraphNode[], newEdges: [] as GraphEdge[] };

      // ⑦ Persist lessons (fire-and-forget)
      for (const lesson of lessons) {
        const subId = lesson.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        putLesson(sessionId, topic, subId, lesson).catch(() => {});
      }

      // Cache first lesson for quick replay
      responseCache.set(normalizedTopic, { lesson: lessons[0], nodes: newNodes, edges: newEdges });

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
