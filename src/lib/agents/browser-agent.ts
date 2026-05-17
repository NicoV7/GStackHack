import type { SSEEvent, Source } from "../types";
import { SourceSchema } from "./schemas";
import { CACHED_SOURCES } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;
const DEFAULT_BROWSER_SEARCH_TIMEOUT_MS = process.env.FAST_LOCAL_DEMO === "true" ? 1500 : 5000;

export async function browserAgent(topic: string, emit: EmitFn): Promise<Source[]> {
  const query = `${topic} explanation tutorial examples`;
  emit({ type: "browser.searching", query });

  const apiKey = process.env.TAVILY_API_KEY;
  if (process.env.FAST_LOCAL_DEMO === "true" || !apiKey) {
    // Fall back to demo cache when no API key
    return fallbackToCache(topic, emit);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), browserSearchTimeoutMs());
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

function browserSearchTimeoutMs(): number {
  const value = Number(process.env.BROWSER_SEARCH_TIMEOUT_MS || DEFAULT_BROWSER_SEARCH_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BROWSER_SEARCH_TIMEOUT_MS;
}

function fallbackToCache(topic: string, emit: EmitFn): Source[] {
  const normalized = topic.trim().toLowerCase();
  const sources = CACHED_SOURCES[normalized]
    ?? (normalized.includes("integral") || normalized.includes("integration") ? CACHED_SOURCES.integration : undefined)
    ?? CACHED_SOURCES.derivatives;

  for (const source of sources) {
    emit({ type: "browser.source_found", source });
  }

  return sources;
}
