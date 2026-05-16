import { llmChat } from "../llm";
import type { SSEEvent, Source } from "../types";
import { DecompositionOutputSchema } from "./schemas";
import { DECOMPOSITION_SYSTEM_PROMPT } from "./prompts";

type EmitFn = (event: SSEEvent) => void;

export interface LearnerProfile {
  languageLevel: "beginner" | "intermediate" | "advanced";
  visualPreference: "graphs" | "diagrams" | "animations" | "examples";
  weakAreas: string[];
  completedTopics: string[];
}

export interface LessonPlan {
  subTopic: string;
  focus: string;
  visualStyle: "graph" | "diagram" | "animation" | "example";
  prerequisiteOf: string | null;
}

export interface DecompositionResult {
  plans: LessonPlan[];
}

export async function decompositionAgent(
  topic: string,
  sources: Source[],
  profile: LearnerProfile,
  emit: EmitFn
): Promise<DecompositionResult> {
  emit({ type: "decomposition.started", topic });

  try {
    const sourcesText = sources
      .map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}`)
      .join("\n\n");

    const prompt = DECOMPOSITION_SYSTEM_PROMPT
      .replace("{languageLevel}", profile.languageLevel)
      .replace("{visualPreference}", profile.visualPreference)
      .replace("{weakAreas}", profile.weakAreas.join(", ") || "none");

    const text = await llmChat(
      prompt,
      `Decompose this topic into micro-lessons: ${topic}\n\nSources:\n${sourcesText}`
    );

    const jsonStr = text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/^```(?:json)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
    const parsed = DecompositionOutputSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      return emitResult(fallbackDecomposition(topic), emit);
    }

    return emitResult(parsed.data, emit);
  } catch {
    return emitResult(fallbackDecomposition(topic), emit);
  }
}

function emitResult(result: DecompositionResult, emit: EmitFn): DecompositionResult {
  for (const plan of result.plans) {
    emit({ type: "decomposition.plan_created", plan });
  }
  emit({ type: "decomposition.complete", count: result.plans.length });
  return result;
}

function fallbackDecomposition(topic: string): DecompositionResult {
  return {
    plans: [
      { subTopic: `${topic} - Foundations`, focus: "Core concepts and definitions", visualStyle: "diagram", prerequisiteOf: `${topic} - Applications` },
      { subTopic: `${topic} - Applications`, focus: "Practical examples and usage", visualStyle: "example", prerequisiteOf: null },
    ],
  };
}
