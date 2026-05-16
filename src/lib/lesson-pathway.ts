import type { GraphEdge, GraphNode } from "./types";
import type { LessonPlan } from "./agents/decomposition-agent";

export interface ExistingLessonNode {
  id: string;
  topic: string;
  hasLesson?: boolean;
}

export function slugTopic(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function buildLessonPathway(topicId: string, plans: LessonPlan[]): {
  nodeIds: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodeIds = plans.map((plan) => slugTopic(plan.subTopic));
  const idByTopic = new Map(plans.map((plan, index) => [slugTopic(plan.subTopic), nodeIds[index]]));
  const nodes = plans.map((plan, index) => ({
    id: nodeIds[index],
    topic: plan.subTopic,
    status: "locked" as const,
    position: pathPosition(index, plans.length),
  }));
  const edges: GraphEdge[] = [];
  const addEdge = (edge: GraphEdge) => {
    if (!edges.some((existing) => existing.id === edge.id)) edges.push(edge);
  };

  if (plans.length === 0) return { nodeIds, nodes, edges };

  addEdge({
    id: `e-${topicId}-${nodeIds[0]}`,
    source: topicId,
    target: nodeIds[0],
    type: "branch",
  });

  plans.forEach((plan, index) => {
    const source = nodeIds[index];
    const declaredTarget = plan.prerequisiteOf ? idByTopic.get(slugTopic(plan.prerequisiteOf)) : null;

    if (declaredTarget && declaredTarget !== source) {
      addEdge({
        id: `e-${source}-${declaredTarget}`,
        source,
        target: declaredTarget,
        type: "prerequisite",
      });
      return;
    }

    const next = nodeIds[index + 1];
    if (next) {
      addEdge({
        id: `e-${source}-${next}`,
        source,
        target: next,
        type: "prerequisite",
      });
    }
  });

  return { nodeIds, nodes, edges };
}

export function buildRelatedNodeEdges(args: {
  topicId: string;
  topic: string;
  pathwayNodes: GraphNode[];
  existingNodes: ExistingLessonNode[];
  gbrainContext: string[];
}): GraphEdge[] {
  const context = args.gbrainContext.join("\n").toLowerCase();
  const targets = [
    { id: args.topicId, topic: args.topic },
    ...args.pathwayNodes.map((node) => ({ id: node.id, topic: node.topic })),
  ];
  const targetIds = new Set(targets.map((target) => target.id));
  const edges: GraphEdge[] = [];

  for (const existing of args.existingNodes) {
    if (targetIds.has(existing.id)) continue;
    const ranked = targets
      .map((target) => ({
        target,
        score: relationScore(existing.topic, target.topic, context),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best) continue;
    edges.push({
      id: `e-related-${existing.id}-${best.target.id}`,
      source: existing.id,
      target: best.target.id,
      type: "suggested",
    });
  }

  return edges.slice(0, 6);
}

function pathPosition(index: number, total: number): { x: number; y: number } {
  if (total <= 1) return { x: 0, y: 150 };
  const spacing = 170;
  return {
    x: Math.round((index - (total - 1) / 2) * spacing),
    y: 150,
  };
}

function relationScore(existingTopic: string, targetTopic: string, context: string): number {
  const existing = existingTopic.toLowerCase();
  const target = targetTopic.toLowerCase();
  const existingTokens = contentTokens(existing);
  const targetTokens = contentTokens(target);
  const overlap = existingTokens.filter((token) => targetTokens.includes(token)).length;
  let score = overlap * 2;

  if (existing.includes(target) || target.includes(existing)) score += 4;
  if (context.includes(existing)) score += 3;
  if (existingTokens.some((token) => context.includes(token))) score += 1;

  return score;
}

function contentTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3)
    .filter((token) => !["lesson", "topic", "rule", "basic"].includes(token));
}
