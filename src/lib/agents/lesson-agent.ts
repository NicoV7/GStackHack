import Anthropic from "@anthropic-ai/sdk";
import type { SSEEvent, Source, Lesson } from "../types";
import { LessonSchema } from "./schemas";
import { LESSON_SYSTEM_PROMPT } from "./prompts";
import { CACHED_LESSONS } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;

const client = new Anthropic();

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

    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: LESSON_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Create a lesson about: ${topic}\n\nWeb research sources:\n${sourcesText}`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";

    // Strip markdown fences if present
    const jsonStr = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
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
