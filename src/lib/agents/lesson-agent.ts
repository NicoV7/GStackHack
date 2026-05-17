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
        content: fallbackContent(topic, sources, plan),
        visualization: `A ${plan?.visualStyle || "diagram"} showing the key relationship in ${topic}.`,
        quiz: [fallbackQuiz(topic, normalized, plan)],
        sources,
      };

  if (lesson.visualization) {
    emit({ type: "lesson.visualization", description: lesson.visualization });
  }
  emit({ type: "lesson.quiz_generated", lesson, nodeId });

  return lesson;
}

function fallbackContent(topic: string, sources: Source[], plan?: LessonPlanContext): string {
  const focus = plan?.focus ? cleanLessonFocus(plan.focus, topic) : "";
  const source = bestSourceForTopic(topic, sources);
  const sourceFrame = cleanSourceExcerpt(source?.excerpt || "");
  const first = focus
    ? `${topic}: ${sentenceCase(focus)}.`
    : sourceFrame
      ? `${topic}: ${sourceFrame}.`
      : `${topic} needs one clear definition before the graph can branch.`;
  const second = plan?.nextTopic
    ? `Use this card to connect ${topic} to ${plan.nextTopic}; the next node should feel like a continuation, not a new subject.`
    : focus
      ? `Use the visual to connect that relationship before branching into related cards.`
    : source?.title
      ? `The strongest source signal came from "${cleanSourceTitle(source.title)}", so this card starts there.`
      : `The useful move is to name the relationship, then test it with one quick example.`;

  return [first, second].join("\n\n");
}

function fallbackQuiz(topic: string, normalized: string, plan?: LessonPlanContext) {
  const focus = plan?.focus || `the main relationship in ${topic}`;
  const nextTopic = plan?.nextTopic || plan?.prerequisiteOf;
  const mode = plan?.visualStyle || "diagram";
  const templates = [
    `Which statement best captures ${topic}?`,
    `What should this ${mode} make clear about ${topic}?`,
    `What does ${topic} help you decide or explain?`,
    `Which move would show that you understand ${topic}?`,
  ];

  return {
    id: `q-${normalized.replace(/[^a-z0-9]+/g, "-")}`,
    text: templates[hashString(normalized) % templates.length],
    options: [
      { label: focus, correct: true },
      {
        label: nextTopic
          ? `Jump straight to ${nextTopic} before understanding this step`
          : "Memorize the vocabulary without connecting it to the model",
        correct: false,
      },
      { label: "Ignore the relationship and only copy the final answer", correct: false },
    ],
    prerequisiteTopic: plan?.previousTopic || inferPrerequisiteTopic(normalized),
  };
}

function inferPrerequisiteTopic(normalized: string): string {
  if (normalized.includes("calculus")) return "Functions";
  if (normalized.includes("neural")) return "Weighted Inputs";
  if (normalized.includes("probability")) return "Sample Space";
  if (normalized.includes("vector")) return "Coordinate Plane";
  if (normalized.includes("yc") || normalized.includes("startup")) return "User Problem";
  return "Foundations";
}

function cleanSourceExcerpt(excerpt: string): string {
  const cleaned = excerpt
    .replace(/\s+/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^#+\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\bstep\s+by\s+step\s+tutorial\s+on\s+/gi, "")
    .replace(/\bthis\s+(video|tutorial|lesson)\s+(shows|explains|covers)\s+/gi, "")
    .trim()
  const sentence = cleaned
    .split(/[.!?]/)
    .map((part) => part.trim().replace(/^#+\s*/, ""))
    .filter((part) => !/love\/hate|agony of math education|thanks for|subscribers|views/i.test(part))
    .find((part) => part.length > 35)
    || cleaned.split(/[.!?]/)[0]?.trim().replace(/^#+\s*/, "")
    || "";
  return sentence.slice(0, 180);
}

function cleanLessonFocus(value: string, topic: string): string {
  const cleaned = trimSentence(value)
    .replace(/\bstep\s+by\s+step\s+tutorial\s+on\s+/gi, "")
    .replace(/\bthis\s+(video|tutorial|lesson)\s+(shows|explains|covers)\s+/gi, "")
    .replace(/^because\s+it\s+is\s+like\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleanLeadingConnector(focusWindowForTopic(cleaned, topic) || cleaned);
}

function focusWindowForTopic(focus: string, topic: string): string {
  const topicTokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  if (topicTokens.length === 0) return "";

  const words = focus.split(/\s+/).filter(Boolean);
  const normalizedWords = words.map((word) => word.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  const index = normalizedWords.findIndex((word) => topicTokens.some((token) => (
    word === token || word.includes(token) || (word.length > 4 && token.includes(word))
  )));
  if (index < 0) return "";

  const start = Math.max(0, index - 3);
  const end = Math.min(words.length, index + 9);
  return words.slice(start, end).join(" ").replace(/^[,;:\s]+|[,;:\s]+$/g, "");
}

function cleanLeadingConnector(value: string): string {
  return value
    .replace(/^because\s+it\s+is\s+like\s+/i, "")
    .replace(/^to\s+/i, "")
    .trim();
}

function bestSourceForTopic(topic: string, sources: Source[]): Source | undefined {
  const tokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  return sources
    .map((source) => ({
      source,
      score: tokens.filter((token) => `${source.title} ${source.excerpt}`.toLowerCase().includes(token)).length,
    }))
    .sort((a, b) => b.score - a.score)[0]?.source || sources[0];
}

function cleanSourceTitle(title: string): string {
  return title
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(tutorial|explained|introduction|complete guide|beginner'?s guide|examples?|latest|video|videos?)\b/gi, "")
    .replace(/[|:–—-]\s*(youtube|khan academy|geeksforgeeks|coursera|medium).*$/i, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

function trimSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
}

function sentenceCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
