/**
 * Unified LLM provider — cascading fallback: Ollama > Anthropic > Gemini.
 * Each provider is tried in order; failures fall through to the next.
 */

import { z } from "zod";

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

export async function llmChat(
  system: string,
  userMessage: string
): Promise<string> {
  const errors: string[] = [];

  // Ollama first (free, local or tunneled)
  if (OLLAMA_BASE) {
    try {
      return await ollamaChat(system, userMessage);
    } catch (e) {
      errors.push(`Ollama: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Anthropic second
  if (ANTHROPIC_KEY) {
    try {
      return await anthropicChat(system, userMessage);
    } catch (e) {
      errors.push(`Anthropic: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Gemini last
  if (GEMINI_KEY) {
    try {
      return await geminiChat(system, userMessage);
    } catch (e) {
      errors.push(`Gemini: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  throw new Error(`All LLM providers failed: ${errors.join(" | ")}`);
}

async function anthropicChat(system: string, userMessage: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
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
}

async function geminiChat(system: string, userMessage: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Gemini error: ${res.status} ${errorText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

async function ollamaChat(system: string, userMessage: string): Promise<string> {
  // /no_think disables qwen3 reasoning mode — avoids wasting tokens on internal monologue
  const systemWithNoThink = `/no_think\n${system}`;
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: systemWithNoThink },
        { role: "user", content: userMessage },
      ],
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: 2048,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json();
  return data.message?.content ?? "";
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
