import { describe, expect, it, vi, beforeEach } from "vitest";
import { deepDiveAgent } from "@/lib/agents/deep-dive-agent";

vi.mock("@/lib/llm", () => ({
  callAgentLLM: vi.fn(),
}));

import { callAgentLLM } from "@/lib/llm";
const mockCallAgentLLM = vi.mocked(callAgentLLM);

describe("deepDiveAgent", () => {
  beforeEach(() => {
    mockCallAgentLLM.mockReset();
  });

  it("returns structured deep dive with sections", async () => {
    const mockResult = {
      title: "Understanding Limits",
      sections: [
        { type: "explanation", content: "Limits describe what happens as you approach a value." },
        { type: "mermaid", content: "flowchart TD\n  A[Input] --> B[Approaches value]\n  B --> C[Limit exists]" },
        { type: "workedExample", content: "Step 1: Evaluate lim(x→2) of x²\nStep 2: Substitute: 2² = 4\nAnswer: 4" },
      ],
    };
    mockCallAgentLLM.mockResolvedValue(mockResult);

    const sources = [{ title: "Calc 101", url: "https://example.com", excerpt: "Limits intro", relevance: 0.9 }];
    const result = await deepDiveAgent("Limits", sources);

    expect(result.title).toBe("Understanding Limits");
    expect(result.sections).toHaveLength(3);
    expect(result.sections[0].type).toBe("explanation");
    expect(result.sections[1].type).toBe("mermaid");
  });

  it("throws when LLM fails (caller handles error)", async () => {
    mockCallAgentLLM.mockRejectedValue(new Error("LLM timeout"));

    await expect(deepDiveAgent("Limits", [])).rejects.toThrow("LLM timeout");
  });

  it("passes topic and sources to callAgentLLM", async () => {
    mockCallAgentLLM.mockResolvedValue({ title: "Test", sections: [{ type: "explanation", content: "x" }, { type: "mermaid", content: "y" }] });

    const sources = [{ title: "Source 1", url: "https://a.com", excerpt: "excerpt", relevance: 0.8 }];
    await deepDiveAgent("Derivatives", sources);

    expect(mockCallAgentLLM.mock.calls[0][2]).toContain("Derivatives");
    expect(mockCallAgentLLM.mock.calls[0][2]).toContain("Source 1");
    expect(mockCallAgentLLM.mock.calls[0][2]).toContain("excerpt");
  });
});
