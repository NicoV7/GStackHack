import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

type GraphStateLike = {
  container: { clientWidth: number; clientHeight: number } | null;
  canvas: { style: Record<string, string> } | null;
  svgEdges: null;
  nodesContainer: null;
  _cachedPositions: Map<string, { x: number; y: number }>;
  addRootNode: (id: string, topic: string, lesson: unknown) => void;
  addNode: (node: { id: string; topic: string; status: string }) => void;
  addEdge: (edge: { id: string; source: string; target: string; type: string }) => void;
  setActive: (id: string) => void;
};

function loadGraphState(): GraphStateLike {
  const source = readFileSync(join(process.cwd(), "public/graph.js"), "utf8");
  const context = vm.createContext({
    setTimeout,
    clearTimeout,
    Map,
    Set,
    Math,
  });
  vm.runInContext(`${source}\nglobalThis.__GraphState = GraphState;`, context);
  return (context as typeof context & { __GraphState: GraphStateLike }).__GraphState;
}

describe("GraphState render scheduling", () => {
  it("does not collapse branch nodes when a fast lesson activates a node before layout renders", () => {
    vi.useFakeTimers();
    const graph = loadGraphState();
    graph.container = { clientWidth: 1000, clientHeight: 800 };
    graph.canvas = { style: {} };
    graph.svgEdges = null;
    graph.nodesContainer = null;

    graph.addRootNode("neural-networks", "Neural networks", null);
    graph.addNode({ id: "neural-networks-core", topic: "Core idea", status: "locked" });
    graph.addNode({ id: "neural-networks-example", topic: "Worked example", status: "locked" });
    graph.addEdge({
      id: "e-neural-networks-neural-networks-core",
      source: "neural-networks",
      target: "neural-networks-core",
      type: "branch",
    });
    graph.addEdge({
      id: "e-neural-networks-core-neural-networks-example",
      source: "neural-networks-core",
      target: "neural-networks-example",
      type: "prerequisite",
    });

    graph.setActive("neural-networks-core");
    vi.advanceTimersByTime(20);

    expect(graph._cachedPositions.size).toBe(3);
    expect(graph._cachedPositions.get("neural-networks")).toEqual({ x: 0, y: 0 });
    expect(graph._cachedPositions.get("neural-networks-core")).not.toEqual({ x: 0, y: 0 });
    expect(graph._cachedPositions.get("neural-networks-example")).not.toEqual({ x: 0, y: 0 });

    vi.useRealTimers();
  });
});
