import { describe, it, expect } from "vitest";
import {
  CACHED_SOURCES,
  CACHED_LESSONS,
  CACHED_GRAPH_NODES,
  CACHED_GRAPH_EDGES,
} from "@/lib/demo-cache";

describe("Demo Cache", () => {
  it("has cached sources for derivatives", () => {
    expect(CACHED_SOURCES.derivatives).toBeDefined();
    expect(CACHED_SOURCES.derivatives.length).toBeGreaterThanOrEqual(3);
    expect(CACHED_SOURCES.derivatives[0].title).toBeTruthy();
    expect(CACHED_SOURCES.derivatives[0].url).toBeTruthy();
  });

  it("has a cached lesson for derivatives with quiz", () => {
    const lesson = CACHED_LESSONS.derivatives;
    expect(lesson).toBeDefined();
    expect(lesson.title).toBeTruthy();
    expect(lesson.content).toBeTruthy();
    expect(lesson.quiz.length).toBeGreaterThanOrEqual(2);
    expect(lesson.quiz[0].prerequisiteTopic).toBeTruthy();
  });

  it("has cached graph nodes and edges for derivatives", () => {
    expect(CACHED_GRAPH_NODES.derivatives.length).toBeGreaterThanOrEqual(3);
    expect(CACHED_GRAPH_EDGES.derivatives.length).toBeGreaterThanOrEqual(3);
    // Edges should reference existing node IDs
    const nodeIds = CACHED_GRAPH_NODES.derivatives.map((n) => n.id);
    for (const edge of CACHED_GRAPH_EDGES.derivatives) {
      expect(
        nodeIds.includes(edge.source) || edge.source === "derivatives" ||
        nodeIds.includes(edge.target) || edge.target === "derivatives"
      ).toBe(true);
    }
  });
});
