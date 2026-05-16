import { createSSEStream, sseResponse } from "@/lib/sse";
import { browserAgent } from "@/lib/agents/browser-agent";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import { graphAgent } from "@/lib/agents/graph-agent";
import type { Lesson, GraphNode, GraphEdge } from "@/lib/types";

// In-memory response cache — avoids re-calling APIs for the same topic
const responseCache = new Map<
  string,
  { lesson: Lesson; nodes: GraphNode[]; edges: GraphEdge[] }
>();

export async function POST(req: Request) {
  const { topic } = (await req.json()) as { topic: string };
  const normalizedTopic = topic.trim().toLowerCase();
  const topicId = normalizedTopic.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const { readable, emit, close } = createSSEStream();

  (async () => {
    const start = Date.now();

    try {
      // Check cache first
      const cached = responseCache.get(normalizedTopic);
      if (cached) {
        emit({ type: "browser.searching", query: `${topic} (cached)` });
        for (const source of cached.lesson.sources) {
          emit({ type: "browser.source_found", source });
        }
        emit({ type: "lesson.writing", topic });
        if (cached.lesson.visualization) {
          emit({ type: "lesson.visualization", description: cached.lesson.visualization });
        }
        emit({ type: "lesson.quiz_generated", lesson: cached.lesson });
        for (const node of cached.nodes) {
          emit({ type: "graph.node_added", node });
        }
        for (const edge of cached.edges) {
          emit({ type: "graph.edge_added", edge });
        }
        emit({ type: "pipeline.complete", totalMs: Date.now() - start });
        return;
      }

      // --- Stage 1: Browser Agent (Tavily search) ---
      const sources = await browserAgent(topic, emit);

      // --- Stage 2: Lesson Agent (Claude) ---
      const lesson = await lessonAgent(topic, sources, emit);

      // --- Stage 3: Graph Agent (Claude) ---
      const existingNodeIds = [topicId];
      const { newNodes, newEdges } = await graphAgent(
        topic,
        lesson,
        existingNodeIds,
        emit
      );

      // Cache the result
      responseCache.set(normalizedTopic, {
        lesson,
        nodes: newNodes,
        edges: newEdges,
      });

      emit({ type: "pipeline.complete", totalMs: Date.now() - start });
    } catch (err) {
      emit({ type: "pipeline.error", error: String(err) });
    } finally {
      close();
    }
  })();

  return sseResponse(readable);
}
