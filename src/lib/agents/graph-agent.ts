import Anthropic from "@anthropic-ai/sdk";
import type { SSEEvent, Lesson, GraphNode, GraphEdge } from "../types";
import { GraphOutputSchema } from "./schemas";
import { GRAPH_SYSTEM_PROMPT } from "./prompts";
import { CACHED_GRAPH_NODES, CACHED_GRAPH_EDGES } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;

const client = new Anthropic();

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
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: GRAPH_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Current topic: ${topic}\nLesson title: ${lesson.title}\nExisting nodes: [${existingNodeIds.join(", ")}]\n\nSuggest related topics for the knowledge graph.`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonStr = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = GraphOutputSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      return fallbackToCache(topic, emit);
    }

    const nodes: GraphNode[] = parsed.data.newNodes.map((n, i) => ({
      ...n,
      position: radialPosition(i, parsed.data.newNodes.length),
    }));

    const edges: GraphEdge[] = parsed.data.newEdges;

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
