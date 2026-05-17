import { callAgentLLM } from "../llm";
import type { SSEEvent, Source, Lesson } from "../types";
import { LessonSchema } from "./schemas";
import { LESSON_SYSTEM_PROMPT } from "./prompts";
import { CACHED_LESSONS } from "../demo-cache";

type EmitFn = (event: SSEEvent) => void;

export interface LessonPlanContext {
  focus: string;
  visualStyle: "graph" | "diagram" | "animation" | "example";
  prerequisiteOf: string | null;
  previousTopic?: string;
  nextTopic?: string;
}

export async function lessonAgent(
  topic: string,
  sources: Source[],
  emit: EmitFn,
  nodeId?: string,
  plan?: LessonPlanContext
): Promise<Lesson> {
  emit({ type: "lesson.writing", topic });

  if (process.env.FAST_LOCAL_DEMO === "true") {
    return fallbackToCache(topic, sources, emit, nodeId, plan);
  }

  try {
    const sourcesText = sources
      .map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}\nURL: ${s.url}`)
      .join("\n\n");
    const pathwayText = plan
      ? [
          `Pathway role: ${plan.focus}`,
          `Preferred visual format: ${plan.visualStyle}`,
          plan.previousTopic ? `Previous lesson: ${plan.previousTopic}` : null,
          plan.nextTopic ? `Next lesson: ${plan.nextTopic}` : null,
          plan.prerequisiteOf ? `This lesson is a prerequisite for: ${plan.prerequisiteOf}` : null,
        ].filter(Boolean).join("\n")
      : "Pathway role: root lesson";

    const result = await callAgentLLM(
      LessonSchema,
      LESSON_SYSTEM_PROMPT,
      `Create a lesson about: ${topic}\n\n${pathwayText}\n\nWeb research sources:\n${sourcesText}`
    );

    const lesson: Lesson = { ...result, sources };

    if (lesson.visualization) {
      emit({ type: "lesson.visualization", description: lesson.visualization });
    }
    emit({ type: "lesson.quiz_generated", lesson, nodeId });

    return lesson;
  } catch {
    return fallbackToCache(topic, sources, emit, nodeId, plan);
  }
}

function fallbackToCache(
  topic: string,
  sources: Source[],
  emit: EmitFn,
  nodeId?: string,
  plan?: LessonPlanContext
): Lesson {
  const normalized = topic.trim().toLowerCase();
  const cached =
    CACHED_LESSONS[normalized] ??
    (normalized.includes("limits") ? CACHED_LESSONS.limits : undefined);

  const lesson: Lesson = cached
    ? { ...cached, sources }
    : {
        title: topic,
        content: [
          plan?.focus || `A focused micro-lesson on ${topic}.`,
          plan?.nextTopic
            ? `This card prepares you for ${plan.nextTopic}, so notice the pattern before moving forward.`
            : sources[0]?.excerpt || "Explore this topic through the knowledge graph.",
        ].join("\n\n"),
        visualization: `A ${plan?.visualStyle || "diagram"} showing the key relationship in ${topic}.`,
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
