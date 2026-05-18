import { callAgentLLM } from "../llm";
import type { Source } from "../types";
import { DeepDiveSchema, type DeepDiveOutput } from "./schemas";
import { DEEP_DIVE_SYSTEM_PROMPT } from "./prompts";

export async function deepDiveAgent(
  topic: string,
  sources: Source[]
): Promise<DeepDiveOutput> {
  if (process.env.FAST_LOCAL_DEMO === "true") {
    return fallbackDeepDive(topic, sources);
  }

  const sourcesText = sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}\nURL: ${s.url}`)
    .join("\n\n");

  const userMessage = sources.length > 0
    ? `Create a deep-dive lesson about: ${topic}\n\nWeb research sources:\n${sourcesText}`
    : `Create a deep-dive lesson about: ${topic}`;

  try {
    return await callAgentLLM(
      DeepDiveSchema,
      DEEP_DIVE_SYSTEM_PROMPT,
      userMessage
    );
  } catch {
    return fallbackDeepDive(topic, sources);
  }
}

function fallbackDeepDive(topic: string, sources: Source[]): DeepDiveOutput {
  const cleanTopic = topic.trim() || "This concept";
  const sourceFrame = sources[0]?.excerpt
    ? ` A useful source frames it this way: ${sources[0].excerpt.slice(0, 180)}`
    : "";

  return {
    title: `${cleanTopic} Deep Dive`,
    sections: [
      {
        type: "explanation",
        content: `${cleanTopic} is easiest to learn by separating the core idea from the steps around it.${sourceFrame}\n\nStart with the simplest case, name the relationship you see, then test that relationship against a concrete example.`,
      },
      {
        type: "mermaid",
        content: [
          "flowchart TD",
          "  A[Start with the question] --> B[Identify the core relationship]",
          "  B --> C[Work one concrete example]",
          "  C --> D[Check the misconception]",
        ].join("\n"),
      },
      {
        type: "workedExample",
        content: `1. State what ${cleanTopic} is trying to explain.\n2. Pick one small example.\n3. Connect each step back to the main relationship.\n4. Check whether the answer changes if the example changes.`,
      },
    ],
  };
}
