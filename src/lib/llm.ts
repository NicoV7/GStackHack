/**
 * Unified LLM provider — cascading fallback: Ollama > Anthropic.
 * Gemini is intentionally not used because the demo has no Gemini credits.
 */

import { z } from "zod";

const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const DEFAULT_OLLAMA_MODEL = "qwen3:8b";
const DEFAULT_LLM_TIMEOUT_MS = 180_000;

export async function llmChat(
  system: string,
  userMessage: string
): Promise<string> {
  const errors: string[] = [];

  // Ollama first (free, local or tunneled)
  const ollama = ollamaBase();
  if (ollama) {
    try {
      return await ollamaChat(system, userMessage);
    } catch (e) {
      errors.push(`Ollama: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Anthropic disabled — no credits remaining
  // To re-enable: uncomment and add ANTHROPIC_API_KEY to env
  // if (anthropicKey()) {
  //   try {
  //     return await anthropicChat(system, userMessage);
  //   } catch (e) {
  //     errors.push(`Anthropic: ${e instanceof Error ? e.message : String(e)}`);
  //   }
  // }

  throw new Error(`All LLM providers failed: ${errors.join(" | ")}`);
}

async function anthropicChat(system: string, userMessage: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmTimeoutMs());
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey()!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 1024,
        system,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Anthropic error: ${res.status} ${errorText}`);
    }

    const data = await res.json();
    return data.content?.[0]?.text ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

async function ollamaChat(system: string, userMessage: string): Promise<string> {
  // /no_think disables qwen3 reasoning mode — avoids wasting tokens on internal monologue
  const systemWithNoThink = `/no_think\n${system}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), llmTimeoutMs());
  try {
    const res = await fetch(`${ollamaBase()}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL,
        messages: [
          { role: "system", content: systemWithNoThink },
          { role: "user", content: userMessage },
        ],
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 512,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    return data.message?.content ?? "";
  } finally {
    clearTimeout(timeout);
  }
}

function anthropicKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined;
}

function ollamaBase(): string {
  const configured = process.env.OLLAMA_URL?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : "http://localhost:11434";
}

function llmTimeoutMs(): number {
  const value = Number(process.env.LLM_TIMEOUT_MS || DEFAULT_LLM_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_LLM_TIMEOUT_MS;
}

/**
 * Shared LLM call pattern: call → strip thinking/fences → parse JSON → validate with Zod.
 * Throws on validation failure (callers catch and use their own fallback).
 */
export async function callAgentLLM<T>(
  schema: z.ZodSchema<T>,
  systemPrompt: string,
  userMessage: string
): Promise<T> {
  const text = await llmChat(systemPrompt, userMessage);
  const jsonStr = text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/^```(?:json)?\n?/m, "")
    .replace(/\n?```$/m, "")
    .trim();
  const parsed = schema.parse(JSON.parse(jsonStr));
  return parsed;
}
