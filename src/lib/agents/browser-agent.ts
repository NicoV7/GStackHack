import type { SSEEvent, Source } from "../types";
import { SourceSchema } from "./schemas";
import { CACHED_SOURCES } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;

export async function browserAgent(topic: string, emit: EmitFn): Promise<Source[]> {
  const query = `${topic} explanation tutorial examples`;
  emit({ type: "browser.searching", query });

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    // Fall back to demo cache when no API key
    return fallbackToCache(topic, emit);
  }

  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: 5,
        search_depth: "basic",
        include_answer: false,
      }),
    });

    if (!res.ok) {
      return fallbackToCache(topic, emit);
    }

    const data = await res.json();
    const sources: Source[] = [];

    for (const result of data.results ?? []) {
      const source: Source = {
        title: result.title ?? "Untitled",
        url: result.url ?? "",
        excerpt: (result.content ?? "").slice(0, 300),
        relevance: result.score ?? 0.5,
      };

      // Validate with Zod — skip malformed results
      const parsed = SourceSchema.safeParse(source);
      if (parsed.success) {
        sources.push(parsed.data);
        emit({ type: "browser.source_found", source: parsed.data });
      }
    }

    if (sources.length === 0) {
      return fallbackToCache(topic, emit);
    }

    return sources;
  } catch {
    return fallbackToCache(topic, emit);
  }
}

function fallbackToCache(topic: string, emit: EmitFn): Source[] {
  const normalized = topic.trim().toLowerCase();
  const sources = CACHED_SOURCES[normalized] ?? CACHED_SOURCES.derivatives;

  for (const source of sources) {
    emit({ type: "browser.source_found", source });
  }

  return sources;
}
