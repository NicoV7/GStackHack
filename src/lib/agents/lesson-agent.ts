import { callAgentLLM } from "../llm";
import type { SSEEvent, Source, Lesson } from "../types";
import { LessonSchema } from "./schemas";
import { LESSON_SYSTEM_PROMPT } from "./prompts";
import { CACHED_LESSONS } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;

export async function lessonAgent(
  topic: string,
  sources: Source[],
  emit: EmitFn,
  nodeId?: string
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
    emit({ type: "lesson.quiz_generated", lesson, nodeId });

    return lesson;
  } catch {
    return fallbackToCache(topic, sources, emit, nodeId);
  }
}

function fallbackToCache(topic: string, sources: Source[], emit: EmitFn, nodeId?: string): Lesson {
  const normalized = topic.trim().toLowerCase();
  const cached =
    CACHED_LESSONS[normalized] ??
    (normalized.includes("limits") ? CACHED_LESSONS.limits : undefined) ??
    (normalized.includes("derivative") ? CACHED_LESSONS.derivatives : undefined);

  const lesson: Lesson = cached
    ? { ...cached, sources }
    : {
        title: topic,
        content: `An overview of ${topic}. ${sources[0]?.excerpt || "Explore this topic through the knowledge graph."}`,
        quiz: [{
          id: `q-${normalized.replace(/[^a-z0-9]+/g, "-")}`,
          text: `What is the key idea behind ${topic}?`,
          options: [
            { label: "Understanding the core principle", correct: true },
            { label: "Memorizing formulas", correct: false },
            { label: "Skipping to applications", correct: false },
          ],
        }],
        sources,
      };

  if (lesson.visualization) {
    emit({ type: "lesson.visualization", description: lesson.visualization });
  }
  emit({ type: "lesson.quiz_generated", lesson, nodeId });

  return lesson;
}
