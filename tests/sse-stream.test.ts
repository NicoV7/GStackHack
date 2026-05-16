import { describe, it, expect } from "vitest";
import { createSSEStream } from "@/lib/sse";

describe("SSE Stream", () => {
  it("emits events in SSE format and closes cleanly", async () => {
    const { readable, emit, close } = createSSEStream();
    const reader = readable.getReader();
    const decoder = new TextDecoder();

    emit({ type: "browser.searching", query: "test" });
    emit({ type: "pipeline.complete", totalMs: 100 });
    close();

    let output = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }

    expect(output).toContain('data: {"type":"browser.searching","query":"test"}');
    expect(output).toContain('data: {"type":"pipeline.complete","totalMs":100}');
    // Each event should end with double newline
    const events = output.split("\n\n").filter(Boolean);
    expect(events.length).toBe(2);
  });
});
