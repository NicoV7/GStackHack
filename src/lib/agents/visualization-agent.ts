import { llmChat } from "../llm";
import type { SSEEvent, Lesson } from "../types";
import { VisualizationOutputSchema } from "./schemas";
import { VISUALIZATION_SYSTEM_PROMPT } from "./prompts";

type EmitFn = (event: SSEEvent) => void;

export interface VisualizationResult {
  type: "svg" | "diagram" | "graph" | "animation";
  spec: string;
  description: string;
  interactiveHint: string | null;
}

export async function visualizationAgent(
  lesson: Lesson,
  emit: EmitFn
): Promise<VisualizationResult> {
  emit({ type: "visualization.started", topic: lesson.title });

  try {
    const text = await llmChat(
      VISUALIZATION_SYSTEM_PROMPT,
      `Create a visualization for this lesson:\nTitle: ${lesson.title}\nContent: ${lesson.content}`
    );

    const jsonStr = text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/^```(?:json)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
    const parsed = VisualizationOutputSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      const result = fallbackVisualization(lesson);
      emit({ type: "visualization.complete", visualization: result });
      return result;
    }

    const result: VisualizationResult = parsed.data;
    emit({ type: "visualization.complete", visualization: result });
    return result;
  } catch {
    const result = fallbackVisualization(lesson);
    emit({ type: "visualization.complete", visualization: result });
    return result;
  }
}

function fallbackVisualization(lesson: Lesson): VisualizationResult {
  return {
    type: "diagram",
    spec: lesson.visualization || "Simple concept diagram",
    description: lesson.visualization || `Diagram illustrating ${lesson.title}`,
    interactiveHint: null,
  };
}
