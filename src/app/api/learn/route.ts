import { createSSEStream, sseResponse } from "@/lib/sse";
import { browserAgent } from "@/lib/agents/browser-agent";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import { graphAgent } from "@/lib/agents/graph-agent";
import { decompositionAgent } from "@/lib/agents/decomposition-agent";
import { buildLessonPathway, buildRelatedNodeEdges, slugTopic, type ExistingLessonNode } from "@/lib/lesson-pathway";
import type { Lesson, GraphNode, GraphEdge } from "@/lib/types";

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

export async function POST(req: Request) {
  const { topic, nodeId, mode, existingNodes = [] } = (await req.json()) as {
    topic: string;
    nodeId?: string;
    mode?: "full" | "single";
    existingNodes?: ExistingLessonNode[];
  };
  const normalizedTopic = topic.trim().toLowerCase();
  const topicId = slugTopic(normalizedTopic);

  const { readable, emit, close } = createSSEStream();

  (async () => {
    const start = Date.now();

    try {
      emit({ type: "browser.searching", query: `Starting pipeline for "${topic}"` });

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

      // ② Browser Agent (Tavily search)
      const sources = await browserAgent(topic, emit);

      // Single-lesson mode: skip decomposition, generate one lesson directly
      if (mode === "single") {
        const lesson = await lessonAgent(topic, sources, emit, nodeId);
        emit({ type: "pipeline.complete", totalMs: Date.now() - start });
        return;
      }

      // ④ Decomposition Agent
      const { plans } = await decompositionAgent(topic, sources, DEFAULT_PROFILE, emit);
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
        gbrainContext: [],
      })) {
        emit({ type: "graph.edge_added", edge, source: "related" });
      }

      // ⑤ Sequential Lesson Agents
      const planContext = effectivePlans.map((plan, index) => ({
        focus: plan.focus,
        visualStyle: plan.visualStyle,
        prerequisiteOf: plan.prerequisiteOf,
        previousTopic: effectivePlans[index - 1]?.subTopic,
        nextTopic: effectivePlans[index + 1]?.subTopic || plan.prerequisiteOf || undefined,
      }));

      const lessons: Lesson[] = [];
      for (let i = 0; i < effectivePlans.length; i++) {
        const targetNode = existingById.get(planNodeIds[i]);
        if (targetNode?.hasLesson) continue;
        try {
          const lesson = await lessonAgent(effectivePlans[i].subTopic, sources, emit, planNodeIds[i], planContext[i]);
          lessons.push(lesson);
        } catch {
          // Lesson failed — skip it, continue with next
        }
      }

      if (lessons.length === 0) {
        throw new Error("All lesson agents failed");
      }

      // ⑥ Graph Agent (suggest related nodes)
      const existingNodeIds = [topicId, ...planNodeIds];
      let newNodes: GraphNode[] = [];
      let newEdges: GraphEdge[] = [];
      try {
        const graphResult = await graphAgent(topic, lessons[0], existingNodeIds, emit);
        newNodes = graphResult.newNodes;
        newEdges = graphResult.newEdges;
      } catch {
        // Graph agent failed — not critical
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
