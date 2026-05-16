import { callAgentLLM } from "../llm";
import type { Source } from "../types";
import { DeepDiveSchema, type DeepDiveOutput } from "./schemas";
import { DEEP_DIVE_SYSTEM_PROMPT } from "./prompts";

export async function deepDiveAgent(
  topic: string,
  sources: Source[]
): Promise<DeepDiveOutput> {
  const sourcesText = sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}\nURL: ${s.url}`)
    .join("\n\n");

  const userMessage = sources.length > 0
    ? `Create a deep-dive lesson about: ${topic}\n\nWeb research sources:\n${sourcesText}`
    : `Create a deep-dive lesson about: ${topic}`;

  const result = await callAgentLLM(
    DeepDiveSchema,
    DEEP_DIVE_SYSTEM_PROMPT,
    userMessage
  );

  return result;
}
