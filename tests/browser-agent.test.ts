import { describe, it, expect, vi, beforeEach } from "vitest";
import { browserAgent } from "@/lib/agents/browser-agent";
import type { SSEEvent } from "@/lib/types";

describe("Browser Agent", () => {
  let events: SSEEvent[];
  const emit = (event: SSEEvent) => events.push(event);

  beforeEach(() => {
    events = [];
    // Clear TAVILY_API_KEY to test fallback path
    delete process.env.TAVILY_API_KEY;
  });

  it("falls back to demo cache when no API key is set", async () => {
    const sources = await browserAgent("derivatives", emit);

    expect(sources.length).toBeGreaterThan(0);
    expect(events[0].type).toBe("browser.searching");
    // Should have source_found events from cache
    const sourceEvents = events.filter((e) => e.type === "browser.source_found");
    expect(sourceEvents.length).toBeGreaterThan(0);
  });

  it("returns cached sources for unknown topics", async () => {
    const sources = await browserAgent("unknown_topic_xyz", emit);
    // Should fall back to derivatives cache
    expect(sources.length).toBeGreaterThan(0);
    expect(sources[0].title).toContain("Khan Academy");
  });
});
