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
  return synthesizeLessonContent(topic, focus || sourceFrame);
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
    .replace(/\b(the\s+)?organic\s+chemistry\s+tutor\b/gi, "")
    .replace(/\b(basic\s+)?introduction\b/gi, "")
    .replace(/\bpractice\s+problems?\b/gi, "")
    .replace(/\bexamples?\b/gi, "")
    .replace(/^because\s+it\s+is\s+like\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/[|:–—-]+/g, " ")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .sort((a, b) => focusPartScore(b, topic) - focusPartScore(a, topic))[0]
    ?.replace(/\s+/g, " ")
    .trim()
    || "";
  return cleanLeadingConnector(focusWindowForTopic(cleaned, topic) || cleaned);
}

function synthesizeLessonContent(topic: string, focus: string): string {
  const first = synthesizeLessonSentence(topic, focus);
  const second = synthesizeFollowupSentence(topic, focus);
  return `${first} ${second}`;
}

function synthesizeLessonSentence(topic: string, focus: string): string {
  const cleaned = cleanLeadingConnector(focus).replace(/[.!?]+$/g, "");
  const topicLower = topic.toLowerCase();
  const lower = `${topic} ${cleaned}`.toLowerCase();

  if (/area\s+under\s+(the\s+)?curve/.test(lower)) {
    return `${topic}: Connect the graph to an accumulated amount by measuring the area under the curve.`;
  }
  if (topicLower.includes("indefinite")) {
    return `${topic}: Describe a family of antiderivatives before any start and end bounds are applied.`;
  }
  if (/antiderivative/.test(lower) && !/^integrals?$/.test(topicLower)) {
    return `${topic}: Work backward from a rate of change to a function whose derivative matches it.`;
  }
  if (/definite integral/.test(lower) && topicLower.includes("definite")) {
    return `${topic}: Use the bounds to turn many small changes into one accumulated total.`;
  }
  if (/^integrals?$/.test(topicLower)) {
    return `${topic}: Represent accumulated change as one mathematical object you can evaluate or compare.`;
  }
  if (/integral calculus|integration|integral/.test(lower)) {
    return `${topic}: Add small pieces together to measure a total change, not just a value at one point.`;
  }
  if (/derivative|differential|rate of change|slope/.test(lower)) {
    return `${topic}: Measure how fast one quantity changes as another quantity moves.`;
  }
  if (/limit|approach/.test(lower)) {
    return `${topic}: Track what a value approaches as the input gets close to a target.`;
  }

  return `${topic}: ${sentenceCase(cleaned)}.`;
}

function synthesizeFollowupSentence(topic: string, focus: string): string {
  const topicLower = topic.toLowerCase();
  const lower = `${topic} ${focus}`.toLowerCase();

  if (/area\s+under\s+(the\s+)?curve/.test(lower)) {
    return "A wider region means more accumulation, even if the curve never gives a single dramatic value.";
  }
  if (topicLower.includes("indefinite")) {
    return "Because there are no bounds, the result keeps a constant term that represents many possible starting heights.";
  }
  if (/antiderivative/.test(lower) && !/^integrals?$/.test(topicLower)) {
    return "You can check an antiderivative by differentiating it and seeing whether you recover the expression you started with.";
  }
  if (/definite integral/.test(lower) && topicLower.includes("definite")) {
    return "The lower and upper bounds tell you where the accumulation starts and stops, so the answer is one contextual total.";
  }
  if (/^integrals?$/.test(topicLower)) {
    return "That object can model area, distance, cost, or any total built from many tiny contributions.";
  }
  if (/integral calculus|integration|integral/.test(lower)) {
    return "Think of each tiny slice as a small contribution; integration collects those slices into one result.";
  }
  if (/derivative|differential|rate of change|slope/.test(lower)) {
    return "On a graph, that change shows up as the slope of the line that best matches the curve right there.";
  }
  if (/limit|approach/.test(lower)) {
    return "The exact value at the target can be less important than the pattern the function follows nearby.";
  }

  return "The key is to name the relationship, then test it against one concrete example.";
}

function focusPartScore(part: string, topic: string): number {
  const text = part.toLowerCase();
  const topicTokens = topic.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 3);
  let score = topicTokens.filter((token) => text.includes(token)).length * 2;
  if (/area|curve|accumulat|change|rate|slope|antiderivative|indefinite|definite|integral|derivative|limit/.test(text)) score += 4;
  if (/organic chemistry|practice problems|examples?|introduction|tutorial|youtube|video/.test(text)) score -= 6;
  return score;
}

function cleanLeadingConnector(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/^because\s+it\s+is\s+like\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
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
