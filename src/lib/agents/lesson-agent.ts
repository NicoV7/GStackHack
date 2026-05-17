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
          `${plan?.focus || topic} is a fundamental concept worth understanding deeply. It connects to many areas and builds on prior knowledge you may already have.`,
          plan?.nextTopic
            ? `This concept is a stepping stone toward ${plan.nextTopic}. Once you grasp the core idea here, the next topic will click much faster.`
            : `Take a moment to reflect on what you already know about ${topic}. Real understanding comes from connecting new ideas to familiar ones.`,
        ].join("\n\n"),
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

function fallbackQuiz(topic: string, normalized: string, plan?: LessonPlanContext) {
  const preset = fallbackQuizPreset(normalized);
  if (preset) {
    return {
      id: `q-${normalized.replace(/[^a-z0-9]+/g, "-")}`,
      ...preset,
    };
  }

  const focus = plan?.focus || `the main relationship in ${topic}`;
  const nextTopic = plan?.nextTopic || plan?.prerequisiteOf;
  const mode = plan?.visualStyle || "diagram";
  const textByMode = {
    graph: `On a graph of ${topic}, what should you pay attention to first?`,
    diagram: `Which connection best explains ${topic}?`,
    animation: `As ${topic} changes step by step, what should you watch?`,
    example: `In a worked example for ${topic}, what should you track first?`,
  };

  return {
    id: `q-${normalized.replace(/[^a-z0-9]+/g, "-")}`,
    text: textByMode[mode],
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

function fallbackQuizPreset(normalized: string) {
  if (normalized.includes("chain rule")) {
    return {
      text: "For sin(x^2), what must you multiply after differentiating the outside sine?",
      options: [
        { label: "The derivative of the inside, 2x", correct: true },
        { label: "Only the derivative of sine", correct: false },
        { label: "Only the exponent on x^2", correct: false },
      ],
      prerequisiteTopic: "Function Composition",
    };
  }

  if (normalized.includes("product rule")) {
    return {
      text: "When differentiating f(x)g(x), which structure matches the product rule?",
      options: [
        { label: "f'(x)g(x) + f(x)g'(x)", correct: true },
        { label: "f'(x)g'(x)", correct: false },
        { label: "f(x) + g(x)", correct: false },
      ],
      prerequisiteTopic: "Derivatives",
    };
  }

  if (normalized.includes("derivative")) {
    return {
      text: "What does a derivative tell you at one point on a curve?",
      options: [
        { label: "The instantaneous rate of change", correct: true },
        { label: "The total area accumulated so far", correct: false },
        { label: "The highest y-value on the graph", correct: false },
      ],
      prerequisiteTopic: "Limits",
    };
  }

  if (normalized.includes("limit")) {
    return {
      text: "In a limit, what are you studying about the input?",
      options: [
        { label: "What the function approaches near a value", correct: true },
        { label: "Only the function value exactly at that point", correct: false },
        { label: "The largest number in the expression", correct: false },
      ],
      prerequisiteTopic: "Functions",
    };
  }

  if (normalized.includes("integral")) {
    return {
      text: "What does a definite integral measure visually?",
      options: [
        { label: "Accumulated area under a curve", correct: true },
        { label: "The slope at one exact point", correct: false },
        { label: "The input where a graph crosses zero", correct: false },
      ],
      prerequisiteTopic: "Derivatives",
    };
  }

  if (normalized.includes("activation function")) {
    return {
      text: "Why do neural networks use activation functions between layers?",
      options: [
        { label: "They add nonlinearity so layers can model complex patterns", correct: true },
        { label: "They delete all negative examples from the dataset", correct: false },
        { label: "They replace training with memorized answers", correct: false },
      ],
      prerequisiteTopic: "Perceptrons",
    };
  }

  if (normalized.includes("backpropagation")) {
    return {
      text: "What is backpropagation moving backward through the network?",
      options: [
        { label: "Error signals used to update weights", correct: true },
        { label: "Raw input pixels from the dataset", correct: false },
        { label: "The final prediction without any loss", correct: false },
      ],
      prerequisiteTopic: "Loss Functions",
    };
  }

  if (normalized.includes("dot product")) {
    return {
      text: "What does the dot product reveal about two vectors?",
      options: [
        { label: "How aligned their directions are", correct: true },
        { label: "The area of a curved region", correct: false },
        { label: "The probability of an event", correct: false },
      ],
      prerequisiteTopic: "Vector Components",
    };
  }

  if (normalized.includes("conditional probability")) {
    return {
      text: "What changes in conditional probability?",
      options: [
        { label: "The likelihood after new information is known", correct: true },
        { label: "The sample space disappears completely", correct: false },
        { label: "Every outcome becomes equally likely", correct: false },
      ],
      prerequisiteTopic: "Sample Space",
    };
  }

  return null;
}

function inferPrerequisiteTopic(normalized: string): string {
  if (normalized.includes("calculus")) return "Functions";
  if (normalized.includes("neural")) return "Weighted Inputs";
  if (normalized.includes("probability")) return "Sample Space";
  if (normalized.includes("vector")) return "Coordinate Plane";
  return "Foundations";
}
