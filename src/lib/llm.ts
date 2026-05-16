/**
 * Unified LLM provider — uses Gemini (cloud) or Ollama (local) based on env vars.
 * Priority: GEMINI_API_KEY > OLLAMA_URL > throw (agents catch and use demo-cache).
 */

import { z } from "zod";

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash";
const OLLAMA_BASE = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";

export async function llmChat(
  system: string,
  userMessage: string
): Promise<string> {
  if (GEMINI_KEY) {
    return geminiChat(system, userMessage);
  }
  return ollamaChat(system, userMessage);
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
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: system },
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
