import { callAgentLLM } from "../llm";
import type { SSEEvent, Lesson, GraphNode, GraphEdge } from "../types";
import { GraphOutputSchema } from "./schemas";
import { GRAPH_SYSTEM_PROMPT } from "./prompts";
import { CACHED_GRAPH_NODES, CACHED_GRAPH_EDGES } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;

export interface GraphAgentResult {
  newNodes: GraphNode[];
  newEdges: GraphEdge[];
}

export async function graphAgent(
  topic: string,
  lesson: Lesson,
  existingNodeIds: string[],
  emit: EmitFn
): Promise<GraphAgentResult> {
  try {
    const result = await callAgentLLM(
      GraphOutputSchema,
      GRAPH_SYSTEM_PROMPT,
      `Current topic: ${topic}\nLesson title: ${lesson.title}\nExisting nodes: [${existingNodeIds.join(", ")}]\n\nSuggest related topics for the knowledge graph.`
    );

    const nodes: GraphNode[] = result.newNodes.map((n, i) => ({
      ...n,
      position: radialPosition(i, result.newNodes.length),
    }));

    const edges: GraphEdge[] = result.newEdges;

    for (const node of nodes) {
      emit({ type: "graph.node_added", node });
    }
    for (const edge of edges) {
      emit({ type: "graph.edge_added", edge });
    }

    return { newNodes: nodes, newEdges: edges };
  } catch {
    return fallbackToCache(topic, emit);
  }
}

function fallbackToCache(topic: string, emit: EmitFn): GraphAgentResult {
  const normalized = topic.trim().toLowerCase();
  const nodes = CACHED_GRAPH_NODES[normalized] ?? CACHED_GRAPH_NODES.derivatives;
  const edges = CACHED_GRAPH_EDGES[normalized] ?? CACHED_GRAPH_EDGES.derivatives;

  for (const node of nodes) {
    emit({ type: "graph.node_added", node });
  }
  for (const edge of edges) {
    emit({ type: "graph.edge_added", edge });
  }

  return { newNodes: nodes, newEdges: edges };
}

function radialPosition(index: number, total: number): { x: number; y: number } {
  const angleStep = (2 * Math.PI) / total;
  const angle = angleStep * index - Math.PI / 2;
  return {
    x: Math.round(180 * Math.cos(angle)),
    y: Math.round(180 * Math.sin(angle)),
  };
}
