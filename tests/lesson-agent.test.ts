import { beforeEach, describe, expect, it, vi } from "vitest";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import type { SSEEvent, Source } from "@/lib/types";

vi.mock("@/lib/llm", () => ({
  callAgentLLM: vi.fn(),
}));

import { callAgentLLM } from "@/lib/llm";
const mockCallAgentLLM = vi.mocked(callAgentLLM);

describe("lessonAgent", () => {
  const sources: Source[] = [
    { title: "Source", url: "https://example.com", excerpt: "Source excerpt", relevance: 0.8 },
  ];
  let events: SSEEvent[];

  beforeEach(() => {
    events = [];
    mockCallAgentLLM.mockReset();
  });

  it("passes pathway context into LLM lesson generation", async () => {
    mockCallAgentLLM.mockResolvedValue({
      title: "Limits",
      content: "Limits prepare students for derivatives.",
      visualization: "Secant line becoming tangent",
      quiz: [
        {
          id: "q1",
          text: "Why limits?",
          options: [
            { label: "Instant change", correct: true },
            { label: "Area", correct: false },
            { label: "Volume", correct: false },
            { label: "Counting", correct: false },
          ],
          prerequisiteTopic: "Average rate of change",
        },
      ],
    });

    await lessonAgent("Limits", sources, (event) => events.push(event), "limits", {
      focus: "Foundation for derivatives",
      visualStyle: "graph",
      prerequisiteOf: "Power Rule",
      nextTopic: "Power Rule",
    });

    expect(mockCallAgentLLM.mock.calls[0][2]).toContain("Pathway role: Foundation for derivatives");
    expect(mockCallAgentLLM.mock.calls[0][2]).toContain("This lesson is a prerequisite for: Power Rule");
    expect(events).toContainEqual(expect.objectContaining({ type: "lesson.quiz_generated", nodeId: "limits" }));
  });

  it("fallback lessons stay specific to the extracted pathway topic", async () => {
    mockCallAgentLLM.mockRejectedValue(new Error("offline"));

    const lesson = await lessonAgent("Derivatives - Foundations", sources, (event) => events.push(event), "derivatives-foundations", {
      focus: "Core concepts and definitions",
      visualStyle: "diagram",
      prerequisiteOf: "Derivatives - Applications",
      nextTopic: "Derivatives - Applications",
    });

    expect(lesson.title).toBe("Derivatives - Foundations");
    expect(lesson.content).toMatch(/core concepts and definitions/i);
    expect(lesson.content).toContain("Derivatives - Applications");
    expect(lesson.title).not.toBe("What is a Derivative?");
  });

  it("fallback lessons clean raw tutorial phrasing instead of using an is-about wrapper", async () => {
    mockCallAgentLLM.mockRejectedValue(new Error("offline"));

    const lesson = await lessonAgent(
      "Exponent Rule",
      [{ title: "Exponent Rules Lesson", url: "https://example.com/exponents", excerpt: "Step by Step tutorial on the rules of exponents.", relevance: 0.8 }],
      (event) => events.push(event),
      "exponent-rule",
      {
        focus: "step by Step tutorial on the rules of exponents",
        visualStyle: "diagram",
        prerequisiteOf: null,
      }
    );

    expect(lesson.content).toContain("Exponent Rule:");
    expect(lesson.content).not.toMatch(/Exponent Rule is about/i);
  });

  it("fallback lessons extract topic-specific focus when branch sources share a sentence", async () => {
    mockCallAgentLLM.mockRejectedValue(new Error("offline"));
    const sharedFocus = "definition of a derivative as well as to perform basic integration techniques to calculate the area under the curve";

    const integration = await lessonAgent("Integration", sources, (event) => events.push(event), "integration", {
      focus: sharedFocus,
      visualStyle: "diagram",
      prerequisiteOf: "Area Under Curve",
      nextTopic: "Area Under Curve",
    });
    const area = await lessonAgent("Area Under Curve", sources, (event) => events.push(event), "area-under-curve", {
      focus: sharedFocus,
      visualStyle: "diagram",
      prerequisiteOf: null,
      previousTopic: "Integration",
    });

    expect(integration.content).not.toBe(area.content);
    expect(integration.content).toContain("basic integration techniques");
    expect(area.content).toContain("area under the curve");
  });

  it("fallback quizzes are topic-specific instead of repeating a generic template", async () => {
    mockCallAgentLLM.mockRejectedValue(new Error("offline"));

    const chainRule = await lessonAgent("Chain Rule", sources, (event) => events.push(event), "chain-rule");
    const productRule = await lessonAgent("Product Rule", sources, (event) => events.push(event), "product-rule");

    expect(chainRule.quiz[0].text).toContain("Chain Rule");
    expect(productRule.quiz[0].text).toContain("Product Rule");
    expect(chainRule.quiz[0].text).not.toBe(productRule.quiz[0].text);
    expect(chainRule.quiz[0].text).not.toMatch(/key idea|core principle/i);
    expect(chainRule.quiz[0].options.map((option) => option.label)).not.toContain("Understanding the core principle");
    expect(chainRule.quiz[0].prerequisiteTopic).toBeTruthy();
    expect(productRule.quiz[0].prerequisiteTopic).toBeTruthy();
  });

  it("falls back to cache when LLM content exceeds schema max length", async () => {
    // Simulate callAgentLLM throwing (as it would when Zod .max(600) rejects)
    mockCallAgentLLM.mockRejectedValue(new Error("String must contain at most 600 character(s)"));

    const lesson = await lessonAgent("Limits", sources, (event) => events.push(event), "limits");

    // Fallback produces bite-sized content (under 600 chars)
    expect(lesson.content.length).toBeLessThan(600);
    expect(lesson.title).toBe("Limits: The Zoom-In Idea");
    expect(events).toContainEqual(expect.objectContaining({ type: "lesson.quiz_generated", nodeId: "limits" }));
  });
});
