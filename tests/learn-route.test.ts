import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DecompositionResult } from "@/lib/agents/decomposition-agent";
import type { GraphAgentResult } from "@/lib/agents/graph-agent";
import type { Lesson, SSEEvent, Source } from "@/lib/types";

vi.mock("@/lib/agents/browser-agent", () => ({
  browserAgent: vi.fn(),
}));

vi.mock("@/lib/agents/decomposition-agent", () => ({
  decompositionAgent: vi.fn(),
}));

vi.mock("@/lib/agents/lesson-agent", () => ({
  lessonAgent: vi.fn(),
}));

vi.mock("@/lib/agents/graph-agent", () => ({
  graphAgent: vi.fn(),
}));

vi.mock("@/lib/gbrain", () => ({
  getGbrainDiagnostic: vi.fn(),
  getProfile: vi.fn(),
  putConceptMemory: vi.fn(),
  putLesson: vi.fn(),
  putResearch: vi.fn(),
  queryContext: vi.fn(),
  safeSessionId: vi.fn((id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anonymous"),
  touchSession: vi.fn(),
}));

import { POST } from "@/app/api/learn/route";
import { browserAgent } from "@/lib/agents/browser-agent";
import { decompositionAgent } from "@/lib/agents/decomposition-agent";
import { graphAgent } from "@/lib/agents/graph-agent";
import { lessonAgent } from "@/lib/agents/lesson-agent";
import { getGbrainDiagnostic, getProfile, putConceptMemory, putLesson, putResearch, queryContext, touchSession } from "@/lib/gbrain";

const mockBrowserAgent = vi.mocked(browserAgent);
const mockDecompositionAgent = vi.mocked(decompositionAgent);
const mockLessonAgent = vi.mocked(lessonAgent);
const mockGraphAgent = vi.mocked(graphAgent);
const mockGetGbrainDiagnostic = vi.mocked(getGbrainDiagnostic);
const mockGetProfile = vi.mocked(getProfile);
const mockPutConceptMemory = vi.mocked(putConceptMemory);
const mockPutLesson = vi.mocked(putLesson);
const mockPutResearch = vi.mocked(putResearch);
const mockQueryContext = vi.mocked(queryContext);
const mockTouchSession = vi.mocked(touchSession);

const source: Source = {
  title: "Example source",
  url: "https://example.com/lesson",
  excerpt: "A concise source for the lesson.",
  relevance: 0.8,
};

function lessonFor(topic: string, sources: Source[]): Lesson {
  return {
    title: topic,
    content: `${topic} lesson content.`,
    visualization: `${topic} sketch`,
    quiz: [
      {
        id: `q-${topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        text: `What matters in ${topic}?`,
        options: [
          { label: "The core idea", correct: true },
          { label: "Unrelated detail", correct: false },
        ],
      },
    ],
    sources,
  };
}

async function readEvents(response: Response): Promise<SSEEvent[]> {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line.replace(/^data: /, "")) as SSEEvent);
}

function request(body: unknown): Request {
  return new Request("http://localhost/api/learn", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("/api/learn", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockBrowserAgent.mockImplementation(async (_topic, emit) => {
      emit({ type: "browser.source_found", source });
      return [source];
    });

    mockLessonAgent.mockImplementation(async (topic, sources, emit, nodeId) => {
      const lesson = lessonFor(topic, sources);
      emit({ type: "lesson.quiz_generated", lesson, nodeId });
      return lesson;
    });

    mockGraphAgent.mockResolvedValue({ newNodes: [], newEdges: [] } satisfies GraphAgentResult);
    mockGetProfile.mockResolvedValue({
      languageLevel: "intermediate",
      visualPreference: "diagrams",
      weakAreas: [],
      completedTopics: [],
    });
    mockQueryContext.mockResolvedValue([]);
    mockGetGbrainDiagnostic.mockReturnValue({
      configured: false,
      mode: "cli",
      lastError: "GBrain unavailable",
    });
    mockPutConceptMemory.mockResolvedValue(false);
    mockPutLesson.mockResolvedValue(false);
    mockPutResearch.mockResolvedValue(false);
    mockTouchSession.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("skips duplicate lessons for existing pathway nodes that already have lesson content", async () => {
    mockDecompositionAgent.mockResolvedValue({
      plans: [
        { subTopic: "Limits", focus: "Foundation", visualStyle: "diagram", prerequisiteOf: "Power Rule" },
        { subTopic: "Power Rule", focus: "Rule practice", visualStyle: "example", prerequisiteOf: null },
      ],
    } satisfies DecompositionResult);

    const response = await POST(request({
      topic: "Derivative Duplicate Skip",
      existingNodes: [{ id: "limits", topic: "Limits", hasLesson: true }],
    }));
    const events = await readEvents(response);

    // Root lesson + 1 branch (Limits skipped because hasLesson: true)
    expect(mockLessonAgent).toHaveBeenCalledTimes(2);
    // First call: root lesson
    expect(mockLessonAgent).toHaveBeenCalledWith(
      "Derivative Duplicate Skip",
      [source],
      expect.any(Function),
      expect.any(String),
      expect.objectContaining({
        focus: expect.any(String),
        prerequisiteOf: null,
      })
    );
    // Second call: Power Rule (Limits skipped)
    expect(mockLessonAgent).toHaveBeenCalledWith(
      "Power Rule",
      [source],
      expect.any(Function),
      "power-rule",
      expect.objectContaining({ previousTopic: "Limits" })
    );
    expect(mockLessonAgent).not.toHaveBeenCalledWith(
      "Limits",
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
    expect(events).toContainEqual(expect.objectContaining({
      type: "lesson.quiz_generated",
      nodeId: "power-rule",
    }));
    expect(events.at(-1)?.type).toBe("pipeline.complete");
  });

  it("still completes lesson generation when GBrain is unavailable", async () => {
    mockDecompositionAgent.mockResolvedValue({
      plans: [
        { subTopic: "Vector Basics", focus: "Core concept", visualStyle: "diagram", prerequisiteOf: null },
      ],
    } satisfies DecompositionResult);

    const response = await POST(request({
      topic: "Vector GBrain Failure",
      sessionId: "demo user",
      existingNodes: [],
    }));
    const events = await readEvents(response);

    expect(mockQueryContext).toHaveBeenCalledWith("demouser", "Vector GBrain Failure");
    expect(events).toContainEqual(expect.objectContaining({
      type: "gbrain.offline",
      reason: "read_timeout_or_failed",
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "lesson.quiz_generated",
      nodeId: "vector-basics",
    }));
    const metricEvents = events.filter((event) => event.type === "pipeline.metric");
    expect(metricEvents.length).toBeGreaterThan(0);
    expect(metricEvents.every((event) => (
      typeof event.name === "string" &&
      (typeof event.value === "number" || typeof event.value === "string")
    ))).toBe(true);
    expect(events.some((event) => event.type === "pipeline.error")).toBe(false);
    expect(events.at(-1)?.type).toBe("pipeline.complete");
  });

  it("generates every pathway lesson in fast local demo mode", async () => {
    vi.stubEnv("FAST_LOCAL_DEMO", "true");
    mockDecompositionAgent.mockResolvedValue({
      plans: [
        { subTopic: "Limits", focus: "Functions approaching a value", visualStyle: "diagram", prerequisiteOf: "Derivatives" },
        { subTopic: "Derivatives", focus: "Instantaneous rate of change", visualStyle: "diagram", prerequisiteOf: "Area Under Curve" },
        { subTopic: "Area Under Curve", focus: "Accumulated change", visualStyle: "example", prerequisiteOf: null },
      ],
    } satisfies DecompositionResult);

    const response = await POST(request({
      topic: "Calculus Local Demo All Lessons",
      existingNodes: [],
    }));
    const events = await readEvents(response);

    expect(mockLessonAgent).toHaveBeenCalledTimes(4);
    expect(events.filter((event) => event.type === "lesson.quiz_generated")).toHaveLength(4);
    expect(events).toContainEqual(expect.objectContaining({ type: "lesson.quiz_generated", nodeId: "limits" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "lesson.quiz_generated", nodeId: "derivatives" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "lesson.quiz_generated", nodeId: "area-under-curve" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "pipeline.metric", name: "cards_generated_count", value: 4 }));
    expect(events.findIndex((event) => event.type === "graph.node_added")).toBeLessThan(
      events.findIndex((event) => event.type === "lesson.quiz_generated" && event.nodeId === "calculus-local-demo-all-lessons")
    );
  });
});
