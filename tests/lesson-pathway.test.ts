import { describe, expect, it } from "vitest";
import { buildLessonPathway, buildRelatedNodeEdges } from "@/lib/lesson-pathway";
import type { LessonPlan } from "@/lib/agents/decomposition-agent";

describe("lesson pathway builder", () => {
  it("connects decomposition plans into prerequisite pathways", () => {
    const plans: LessonPlan[] = [
      { subTopic: "Limits", focus: "Foundation", visualStyle: "graph", prerequisiteOf: "Power Rule" },
      { subTopic: "Power Rule", focus: "First derivative rule", visualStyle: "example", prerequisiteOf: "Chain Rule" },
      { subTopic: "Chain Rule", focus: "Composite functions", visualStyle: "diagram", prerequisiteOf: null },
    ];

    const pathway = buildLessonPathway("derivatives", plans);

    expect(pathway.nodeIds).toEqual(["limits", "power-rule", "chain-rule"]);
    expect(pathway.edges).toEqual([
      { id: "e-derivatives-limits", source: "derivatives", target: "limits", type: "branch" },
      { id: "e-limits-power-rule", source: "limits", target: "power-rule", type: "prerequisite" },
      { id: "e-power-rule-chain-rule", source: "power-rule", target: "chain-rule", type: "prerequisite" },
    ]);
  });

  it("falls back to ordered pathway edges when prerequisiteOf is missing", () => {
    const plans: LessonPlan[] = [
      { subTopic: "Slope intuition", focus: "Meaning", visualStyle: "diagram", prerequisiteOf: null },
      { subTopic: "Derivative notation", focus: "Symbols", visualStyle: "example", prerequisiteOf: null },
    ];

    const pathway = buildLessonPathway("derivatives", plans);

    expect(pathway.edges).toContainEqual({
      id: "e-slope-intuition-derivative-notation",
      source: "slope-intuition",
      target: "derivative-notation",
      type: "prerequisite",
    });
  });

  it("connects related existing nodes to new pathway nodes from GBrain context", () => {
    const pathway = buildLessonPathway("derivatives", [
      { subTopic: "Definition of Derivatives", focus: "Meaning", visualStyle: "diagram", prerequisiteOf: "Power Rule" },
      { subTopic: "Power Rule", focus: "Rules", visualStyle: "example", prerequisiteOf: null },
    ]);

    const edges = buildRelatedNodeEdges({
      topicId: "derivatives",
      topic: "Derivatives",
      pathwayNodes: pathway.nodes,
      existingNodes: [
        { id: "limits", topic: "Limits", hasLesson: true },
        { id: "photosynthesis", topic: "Photosynthesis", hasLesson: true },
      ],
      gbrainContext: ["The learner struggled with limits before derivatives."],
    });

    expect(edges).toContainEqual({
      id: "e-related-limits-derivatives",
      source: "limits",
      target: "derivatives",
      type: "suggested",
    });
    expect(edges.some((edge) => edge.source === "photosynthesis")).toBe(false);
  });
});
