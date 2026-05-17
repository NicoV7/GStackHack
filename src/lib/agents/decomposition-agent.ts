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

  if (process.env.ENABLE_LLM_DECOMPOSITION !== "true") {
    return emitResult(templateDecomposition(topic, profile, sources), emit);
  }

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
      return emitResult(templateDecomposition(topic, profile, sources), emit);
    }

    return emitResult(boundPlans(parsed.data), emit);
  } catch {
    return emitResult(templateDecomposition(topic, profile, sources), emit);
  }
}

function emitResult(result: DecompositionResult, emit: EmitFn): DecompositionResult {
  for (const plan of result.plans) {
    emit({ type: "decomposition.plan_created", plan });
  }
  emit({ type: "decomposition.complete", count: result.plans.length });
  return result;
}

function templateDecomposition(topic: string, profile: LearnerProfile, sources: Source[] = []): DecompositionResult {
  const visualStyle = profile.visualPreference === "graphs" ? "graph" : "diagram";
  const relatedTopics = relatedTopicsFor(topic, sources);

  if (relatedTopics.length > 0) {
    return {
      plans: relatedTopics.map((item, index) => ({
        subTopic: item.topic,
        focus: item.focus,
        visualStyle: item.visualStyle || (index === 0 ? visualStyle : "diagram"),
        prerequisiteOf: relatedTopics[index + 1]?.topic || null,
      })),
    };
  }

  return {
    plans: [
      {
        subTopic: `${topic} - Core idea`,
        focus: `The one mental model that makes ${topic} click`,
        visualStyle,
        prerequisiteOf: `${topic} - Worked example`,
      },
      {
        subTopic: `${topic} - Worked example`,
        focus: `Apply ${topic} to one concrete example`,
        visualStyle: "example",
        prerequisiteOf: `${topic} - Common mistake`,
      },
      {
        subTopic: `${topic} - Common mistake`,
        focus: `The misconception most learners hit with ${topic}`,
        visualStyle: "diagram",
        prerequisiteOf: null,
      },
    ],
  };
}

function boundPlans(result: DecompositionResult): DecompositionResult {
  return { plans: result.plans.slice(0, 4) };
}

function relatedTopicsFor(topic: string, sources: Source[]): Array<{
  topic: string;
  focus: string;
  visualStyle?: "graph" | "diagram" | "animation" | "example";
}> {
  const haystack = [
    topic,
    ...sources.flatMap((source) => [source.title, source.excerpt]),
  ].join(" ").toLowerCase();

  for (const preset of RELATED_TOPIC_PRESETS) {
    if (preset.keywords.some((keyword) => haystack.includes(keyword))) {
      return preset.topics;
    }
  }

  return sourceDerivedTopics(topic, sources);
}

const RELATED_TOPIC_PRESETS: Array<{
  keywords: string[];
  topics: Array<{
    topic: string;
    focus: string;
    visualStyle?: "graph" | "diagram" | "animation" | "example";
  }>;
}> = [
  {
    keywords: ["calculus", "derivative", "differentiation"],
    topics: [
      { topic: "Limits", focus: "How functions behave as inputs approach a point", visualStyle: "graph" },
      { topic: "Derivatives", focus: "Instantaneous rate of change and tangent slope", visualStyle: "graph" },
      { topic: "Chain Rule", focus: "Differentiating composite functions", visualStyle: "diagram" },
      { topic: "Product Rule", focus: "Differentiating two multiplied functions", visualStyle: "example" },
    ],
  },
  {
    keywords: ["neural network", "neural networks", "deep learning"],
    topics: [
      { topic: "Perceptrons", focus: "How weighted inputs become a prediction", visualStyle: "diagram" },
      { topic: "Activation Functions", focus: "Why nonlinear layers let networks model complex patterns", visualStyle: "graph" },
      { topic: "Backpropagation", focus: "How errors flow backward to update weights", visualStyle: "animation" },
      { topic: "Overfitting", focus: "Why a model can memorize instead of generalize", visualStyle: "example" },
    ],
  },
  {
    keywords: ["probability", "statistics"],
    topics: [
      { topic: "Sample Space", focus: "The complete set of possible outcomes", visualStyle: "diagram" },
      { topic: "Conditional Probability", focus: "How new information changes likelihood", visualStyle: "diagram" },
      { topic: "Bayes Rule", focus: "Updating beliefs from evidence", visualStyle: "example" },
      { topic: "Expected Value", focus: "The long-run average of uncertain outcomes", visualStyle: "graph" },
    ],
  },
  {
    keywords: ["vector", "vectors", "linear algebra"],
    topics: [
      { topic: "Magnitude and Direction", focus: "Reading a vector as size plus orientation", visualStyle: "diagram" },
      { topic: "Vector Components", focus: "Breaking motion into x and y parts", visualStyle: "diagram" },
      { topic: "Dot Product", focus: "Measuring alignment between two vectors", visualStyle: "graph" },
      { topic: "Basis Vectors", focus: "Changing the coordinate system used to describe space", visualStyle: "animation" },
    ],
  },
  {
    keywords: ["machine learning", "ml model", "classification", "regression"],
    topics: [
      { topic: "Training Data", focus: "Examples that teach the model what patterns matter", visualStyle: "diagram" },
      { topic: "Loss Functions", focus: "A score for how wrong a model is", visualStyle: "graph" },
      { topic: "Gradient Descent", focus: "Iteratively moving parameters toward lower loss", visualStyle: "animation" },
      { topic: "Generalization", focus: "Performing well on examples the model has not seen", visualStyle: "example" },
    ],
  },
];

function sourceDerivedTopics(topic: string, sources: Source[]): Array<{
  topic: string;
  focus: string;
  visualStyle: "diagram" | "example";
}> {
  const candidates = sources
    .map((source) => cleanSourceTitle(source.title))
    .filter((title) => title.length > 0)
    .filter((title) => !sameTopic(title, topic));

  return Array.from(new Set(candidates)).slice(0, 4).map((title, index) => ({
    topic: title,
    focus: `Connect ${topic} to ${title}`,
    visualStyle: index === 1 ? "example" : "diagram",
  }));
}

function cleanSourceTitle(title: string): string {
  return title
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(tutorial|explained|introduction|complete guide|beginner'?s guide|examples?)\b/gi, "")
    .replace(/[|:–—-]\s*(youtube|khan academy|geeksforgeeks|coursera|medium).*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

function sameTopic(candidate: string, topic: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalize(candidate) === normalize(topic);
}
