import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";

// Mock global fetch to intercept the actual HTTP call made by llmChat
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { callAgentLLM } from "@/lib/llm";

const TestSchema = z.object({ name: z.string(), value: z.number() });

function mockOllamaResponse(content: string) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ message: { content } }),
    text: async () => content,
  });
}

describe("callAgentLLM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure no Gemini key so it uses Ollama path
    delete process.env.GEMINI_API_KEY;
  });

  it("valid JSON — returns parsed and validated object", async () => {
    mockOllamaResponse(JSON.stringify({ name: "test", value: 42 }));

    const result = await callAgentLLM(TestSchema, "system", "user");

    expect(result).toEqual({ name: "test", value: 42 });
  });

  it("JSON wrapped in thinking tags — strips tags and parses", async () => {
    mockOllamaResponse(
      `<think>Let me think about this...</think>${JSON.stringify({ name: "thought", value: 7 })}`
    );

    const result = await callAgentLLM(TestSchema, "system", "user");

    expect(result).toEqual({ name: "thought", value: 7 });
  });

  it("JSON wrapped in ```json fences — strips fences and parses", async () => {
    mockOllamaResponse('```json\n{"name":"fenced","value":99}\n```');

    const result = await callAgentLLM(TestSchema, "system", "user");

    expect(result).toEqual({ name: "fenced", value: 99 });
  });

  it("invalid JSON — throws", async () => {
    mockOllamaResponse("this is not json");

    await expect(callAgentLLM(TestSchema, "system", "user")).rejects.toThrow();
  });

  it("valid JSON but fails Zod schema — throws", async () => {
    mockOllamaResponse(JSON.stringify({ name: 123, value: "wrong" }));

    await expect(callAgentLLM(TestSchema, "system", "user")).rejects.toThrow();
  });
});
