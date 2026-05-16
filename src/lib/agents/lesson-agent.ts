import { callAgentLLM } from "../llm";
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

    const result = await callAgentLLM(
      LessonSchema,
      LESSON_SYSTEM_PROMPT,
      `Create a lesson about: ${topic}\n\nWeb research sources:\n${sourcesText}`
    );

    const lesson: Lesson = { ...result, sources };

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
