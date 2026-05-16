import { describe, it, expect, vi, beforeEach } from "vitest";
import { visualizationAgent } from "@/lib/agents/visualization-agent";
import type { SSEEvent, Lesson } from "@/lib/types";

vi.mock("@/lib/llm", () => ({
  llmChat: vi.fn(),
}));

import { llmChat } from "@/lib/llm";
const mockLlmChat = vi.mocked(llmChat);

describe("Visualization Agent", () => {
  let events: SSEEvent[];
  const emit = (event: SSEEvent) => events.push(event);

  const lesson: Lesson = {
    title: "Derivatives",
    content: "A derivative measures the rate of change.",
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
    sources: [
      { title: "Khan Academy", url: "https://khan.org", excerpt: "Learn derivatives", relevance: 0.9 },
    ],
  };

  beforeEach(() => {
    events = [];
    vi.clearAllMocks();
  });

  it("happy path — valid JSON response returns VisualizationResult", async () => {
    const validResponse = JSON.stringify({
      type: "svg",
      spec: "<svg>...</svg>",
      description: "Graph of derivative",
      interactiveHint: "Drag the point",
    });
    mockLlmChat.mockResolvedValue(validResponse);

    const result = await visualizationAgent(lesson, emit);

    expect(result.type).toBe("svg");
    expect(result.spec).toBe("<svg>...</svg>");
    expect(result.description).toBe("Graph of derivative");
    expect(result.interactiveHint).toBe("Drag the point");
  });

  it("LLM failure — falls back to lesson.visualization field", async () => {
    mockLlmChat.mockRejectedValue(new Error("LLM unavailable"));

    const result = await visualizationAgent(lesson, emit);

    expect(result.type).toBe("diagram");
    expect(result.spec).toBe("A curve with tangent line");
    expect(result.description).toBe("A curve with tangent line");
    expect(result.interactiveHint).toBeNull();
  });

  it("emits visualization.started and visualization.complete events", async () => {
    const validResponse = JSON.stringify({
      type: "svg",
      spec: "<svg>...</svg>",
      description: "Graph of derivative",
      interactiveHint: null,
    });
    mockLlmChat.mockResolvedValue(validResponse);

    await visualizationAgent(lesson, emit);

    expect(events[0].type).toBe("visualization.started");
    expect(events[0]).toHaveProperty("topic", "Derivatives");
    expect(events[1].type).toBe("visualization.complete");
    expect(events[1]).toHaveProperty("visualization");
  });
});
