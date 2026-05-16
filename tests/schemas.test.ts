import { describe, it, expect } from "vitest";
import { LessonSchema, GraphOutputSchema, RewireOutputSchema, SourceSchema } from "@/lib/agents/schemas";

describe("Zod Schemas", () => {
  it("validates a well-formed lesson", () => {
    const lesson = {
      title: "Derivatives",
      content: "A derivative measures change.",
      visualization: "A curve with tangent line",
      quiz: [
        {
          id: "q1",
          text: "What is a derivative?",
          options: [
            { label: "Rate of change", correct: true },
            { label: "Area under curve", correct: false },
          ],
          prerequisiteTopic: "Limits",
        },
      ],
    };
    const result = LessonSchema.safeParse(lesson);
    expect(result.success).toBe(true);
  });

  it("rejects a lesson missing required fields", () => {
    const bad = { title: "Test" }; // missing content + quiz
    const result = LessonSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("validates a well-formed graph output", () => {
    const graph = {
      newNodes: [{ id: "power-rule", topic: "Power Rule", status: "locked" }],
      newEdges: [{ id: "e1", source: "derivatives", target: "power-rule", type: "branch" }],
      suggestedPrerequisites: [{ id: "limits", topic: "Limits", status: "locked" }],
    };
    const result = GraphOutputSchema.safeParse(graph);
    expect(result.success).toBe(true);
  });

  it("validates a well-formed rewire output", () => {
    const rewire = { prerequisiteTopic: "Limits", reason: "Missing limit understanding" };
    const result = RewireOutputSchema.safeParse(rewire);
    expect(result.success).toBe(true);
  });

  it("validates a well-formed source", () => {
    const source = { title: "Khan Academy", url: "https://khan.org", excerpt: "Learn math", relevance: 0.9 };
    const result = SourceSchema.safeParse(source);
    expect(result.success).toBe(true);
  });

  it("rejects source with out-of-range relevance", () => {
    const source = { title: "Test", url: "https://test.com", excerpt: "Test", relevance: 1.5 };
    const result = SourceSchema.safeParse(source);
    expect(result.success).toBe(false);
  });

  it("rejects lesson content exceeding 600 characters", () => {
    const longContent = "a".repeat(601);
    const result = LessonSchema.safeParse({
      title: "Test",
      content: longContent,
      quiz: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts lesson content under 600 characters", () => {
    const shortContent = "A short lesson about limits. They describe what happens as you approach a value.";
    const result = LessonSchema.safeParse({
      title: "Test",
      content: shortContent,
      quiz: [],
    });
    expect(result.success).toBe(true);
  });
});
