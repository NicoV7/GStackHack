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
    {
      title: "Calculus 1 Review",
      url: "https://example.com/calculus-review",
      excerpt: "Limits in calculus explain what a function approaches. The definition of a derivative uses shrinking average change.",
      relevance: 0.9,
    },
    {
      title: "Understand Calculus",
      url: "https://example.com/understand-calculus",
      excerpt: "Basic integration techniques calculate area under the curve. Differential calculus studies change and integral calculus studies accumulation.",
      relevance: 0.8,
    },
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

    expect(result.plans).toHaveLength(4);
    const topics = result.plans.map((plan) => plan.subTopic).join(" ");
    expect(topics).toMatch(/limit/i);
    expect(topics).toMatch(/derivative/i);
    expect(topics).toMatch(/integration|integral|area/i);
    expect(result.plans.map((plan) => plan.subTopic)).not.toContain("Curve");
    expect(result.plans.every((plan) => !/[.!?]$/.test(plan.subTopic))).toBe(true);
    expect(topics).not.toMatch(/khan|academy|youtube|explanation/i);
  });

  it("local fallback expands broad searches into related topic nodes", async () => {
    vi.stubEnv("ENABLE_LLM_DECOMPOSITION", "false");

    const result = await decompositionAgent("calculus", sources, profile, emit);

    const topics = result.plans.map((plan) => plan.subTopic).join(" ");
    expect(topics).toMatch(/limit/i);
    expect(topics).toMatch(/derivative/i);
    expect(topics).toMatch(/integration|integral|area/i);
    expect(result.plans.map((plan) => plan.subTopic)).not.toContain("Curve");
    expect(result.plans.every((plan) => !/[.!?]$/.test(plan.subTopic))).toBe(true);
    expect(result.plans.some((plan) => /core idea|worked example|common mistake/i.test(plan.subTopic))).toBe(false);
  });

  it("does not turn integration source verbs or channel titles into related topic nodes", async () => {
    vi.stubEnv("ENABLE_LLM_DECOMPOSITION", "false");
    const integrationSources: Source[] = [
      {
        title: "Integration - Basic Introduction, Practice Problems",
        url: "https://example.com/integration",
        excerpt: "Integration means finding antiderivatives or indefinite integrals using basic integration rules. Definite integrals calculate area under the curve and accumulated change.",
        relevance: 0.95,
      },
      {
        title: "Integral Calculus Examples - The Organic Chemistry Tutor",
        url: "https://example.com/integral-calculus",
        excerpt: "Integral calculus connects accumulation, antiderivatives, definite integrals, and the area under a curve.",
        relevance: 0.86,
      },
    ];

    const result = await decompositionAgent("integration", integrationSources, profile, emit);
    const topics = result.plans.map((plan) => plan.subTopic);

    expect(topics).not.toContain("Using");
    expect(topics.join(" ")).not.toMatch(/organic chemistry|practice problems|basic introduction/i);
    expect(topics.join(" ")).toMatch(/antiderivative|indefinite|definite|area/i);
  });

  it("falls back to source-derived related topics when LLM returns too many plans", async () => {
    mockLlmChat.mockResolvedValue(JSON.stringify({
      plans: Array.from({ length: 5 }, (_, index) => ({
        subTopic: `Branch ${index + 1}`,
        focus: `Focus ${index + 1}`,
        visualStyle: "diagram",
        prerequisiteOf: index < 4 ? `Branch ${index + 2}` : null,
      })),
    }));

    const result = await decompositionAgent("Quantum Mechanics", sources, profile, emit);

    expect(result.plans).toHaveLength(4);
    expect(result.plans.map((plan) => plan.subTopic).join(" ")).toMatch(/limit|derivative|integration|integral|area/i);
    expect(events.at(-1)).toEqual({ type: "decomposition.complete", count: 4 });
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
