import { createSSEStream, sseResponse } from "@/lib/sse";
import { CACHED_SOURCES, CACHED_LESSONS, CACHED_GRAPH_NODES, CACHED_GRAPH_EDGES } from "@/lib/demo-cache";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: Request) {
  const { topic } = (await req.json()) as { topic: string };
  const normalizedTopic = topic.trim().toLowerCase();

  const { readable, emit, close } = createSSEStream();

  // Run the pipeline in the background so the response streams immediately
  (async () => {
    try {
      // --- Browser Agent ---
      emit({ type: "browser.searching", query: `${topic} explanation tutorial` });
      await delay(800);

      const sources = CACHED_SOURCES[normalizedTopic] ?? CACHED_SOURCES.derivatives;
      for (const source of sources) {
        emit({ type: "browser.source_found", source });
        await delay(400);
      }

      // --- Lesson Agent ---
      emit({ type: "lesson.writing", topic });
      await delay(1500);

      const lesson = CACHED_LESSONS[normalizedTopic] ?? CACHED_LESSONS.derivatives;
      emit({ type: "lesson.visualization", description: lesson.visualization });
      await delay(500);
      emit({ type: "lesson.quiz_generated", lesson });
      await delay(300);

      // --- Graph Agent ---
      const nodes = CACHED_GRAPH_NODES[normalizedTopic] ?? CACHED_GRAPH_NODES.derivatives;
      const edges = CACHED_GRAPH_EDGES[normalizedTopic] ?? CACHED_GRAPH_EDGES.derivatives;

      for (const node of nodes) {
        emit({ type: "graph.node_added", node });
        await delay(350);
      }
      for (const edge of edges) {
        emit({ type: "graph.edge_added", edge });
        await delay(150);
      }

      emit({ type: "pipeline.complete", totalMs: Date.now() });
    } catch (err) {
      emit({ type: "pipeline.error", error: String(err) });
    } finally {
      close();
    }
  })();

  return sseResponse(readable);
}
