import { llmChat } from "../llm";
import type { SSEEvent, Source, Lesson } from "../types";
import { LessonSchema } from "./schemas";
import { LESSON_SYSTEM_PROMPT } from "./prompts";
import { CACHED_LESSONS } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;

export async function lessonAgent(
  topic: string,
  sources: Source[],
  emit: EmitFn
): Promise<Lesson> {
  emit({ type: "lesson.writing", topic });

  try {
    const sourcesText = sources
      .map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}\nURL: ${s.url}`)
      .join("\n\n");

    const text = await llmChat(
      LESSON_SYSTEM_PROMPT,
      `Create a lesson about: ${topic}\n\nWeb research sources:\n${sourcesText}`
    );

    // Strip markdown fences and thinking tags if present
    const jsonStr = text
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/^```(?:json)?\n?/m, "")
      .replace(/\n?```$/m, "")
      .trim();
    const parsed = LessonSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      return fallbackToCache(topic, sources, emit);
    }

    const lesson: Lesson = { ...parsed.data, sources };

    if (lesson.visualization) {
      emit({ type: "lesson.visualization", description: lesson.visualization });
    }
    emit({ type: "lesson.quiz_generated", lesson });

    return lesson;
  } catch {
    return fallbackToCache(topic, sources, emit);
  }
}

function fallbackToCache(topic: string, sources: Source[], emit: EmitFn): Lesson {
  const normalized = topic.trim().toLowerCase();
  const cached = CACHED_LESSONS[normalized] ?? CACHED_LESSONS.derivatives;
  const lesson: Lesson = { ...cached, sources };

  if (lesson.visualization) {
    emit({ type: "lesson.visualization", description: lesson.visualization });
  }
  emit({ type: "lesson.quiz_generated", lesson });

  return lesson;
}
