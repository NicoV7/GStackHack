import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decompositionAgent } from "@/lib/agents/decomposition-agent";
import type { SSEEvent, Source } from "@/lib/types";
import type { LearnerProfile } from "@/lib/agents/decomposition-agent";

vi.mock("@/lib/llm", () => ({
  llmChat: vi.fn(),
}));

import { llmChat } from "@/lib/llm";
const mockLlmChat = vi.mocked(llmChat);

describe("Decomposition Agent", () => {
  let events: SSEEvent[];
  const emit = (event: SSEEvent) => events.push(event);

  const sources: Source[] = [
    { title: "Khan Academy", url: "https://khan.org", excerpt: "Learn derivatives", relevance: 0.9 },
  ];

  const profile: LearnerProfile = {
    languageLevel: "beginner",
    visualPreference: "graphs",
    weakAreas: ["algebra"],
    completedTopics: [],
  };

  beforeEach(() => {
    events = [];
    mockLlmChat.mockReset();
    vi.stubEnv("ENABLE_LLM_DECOMPOSITION", "true");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("happy path — returns plans and emits correct SSE events", async () => {
    const validResponse = JSON.stringify({
      plans: [
        { subTopic: "Limits", focus: "Foundation of derivatives", visualStyle: "graph", prerequisiteOf: "Power Rule" },
        { subTopic: "Power Rule", focus: "Basic differentiation", visualStyle: "example", prerequisiteOf: null },
      ],
    });
    mockLlmChat.mockResolvedValue(validResponse);

    const result = await decompositionAgent("Derivatives", sources, profile, emit);

    expect(result.plans).toHaveLength(2);
    expect(result.plans[0].subTopic).toBe("Limits");
    expect(result.plans[1].subTopic).toBe("Power Rule");
  });

  it("invalid JSON — falls back to the bounded template decomposition", async () => {
    mockLlmChat.mockResolvedValue("this is not json at all {{{{");

    const result = await decompositionAgent("Derivatives", sources, profile, emit);

    expect(result.plans).toHaveLength(3);
    expect(result.plans.map((plan) => plan.subTopic)).toEqual([
      "Derivatives - Core idea",
      "Derivatives - Worked example",
      "Derivatives - Common mistake",
    ]);
  });

  it("over-wide decompositions fall back to the bounded demo-speed pathway", async () => {
    mockLlmChat.mockResolvedValue(JSON.stringify({
      plans: Array.from({ length: 5 }, (_, index) => ({
        subTopic: `Branch ${index + 1}`,
        focus: `Focus ${index + 1}`,
        visualStyle: "diagram",
        prerequisiteOf: index < 4 ? `Branch ${index + 2}` : null,
      })),
    }));

    const result = await decompositionAgent("Derivatives", sources, profile, emit);

    expect(result.plans).toHaveLength(3);
    expect(result.plans.map((plan) => plan.subTopic)).toEqual([
      "Derivatives - Core idea",
      "Derivatives - Worked example",
      "Derivatives - Common mistake",
    ]);
    expect(events.at(-1)).toEqual({ type: "decomposition.complete", count: 3 });
  });

  it("emits SSE events in order: decomposition.started → plan_created (per plan) → decomposition.complete", async () => {
    const validResponse = JSON.stringify({
      plans: [
        { subTopic: "Limits", focus: "Foundation of derivatives", visualStyle: "graph", prerequisiteOf: "Power Rule" },
        { subTopic: "Power Rule", focus: "Basic differentiation", visualStyle: "example", prerequisiteOf: null },
      ],
    });
    mockLlmChat.mockResolvedValue(validResponse);

    await decompositionAgent("Derivatives", sources, profile, emit);

    expect(events[0].type).toBe("decomposition.started");
    expect(events[1].type).toBe("decomposition.plan_created");
    expect(events[2].type).toBe("decomposition.plan_created");
    expect(events[3].type).toBe("decomposition.complete");
    expect(events[3]).toHaveProperty("count", 2);
  });
});
