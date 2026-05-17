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
        subTopic: `${titleCaseTopic(topic)} Foundations`,
        focus: `Define ${topic} using the clearest source-backed explanation`,
        visualStyle,
        prerequisiteOf: `${titleCaseTopic(topic)} Examples`,
      },
      {
        subTopic: `${titleCaseTopic(topic)} Examples`,
        focus: `Apply ${topic} to one concrete case from the sources`,
        visualStyle: "example",
        prerequisiteOf: `${titleCaseTopic(topic)} Misconceptions`,
      },
      {
        subTopic: `${titleCaseTopic(topic)} Misconceptions`,
        focus: `Separate the useful mental model from a common misconception about ${topic}`,
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
  return sourceDerivedTopics(topic, sources);
}

function sourceDerivedTopics(topic: string, sources: Source[]): Array<{
  topic: string;
  focus: string;
  visualStyle: "diagram" | "example";
}> {
  const scored = new Map<string, { score: number; focus: string; count: number }>();
  const addCandidate = (candidate: string, focus: string, score: number) => {
    const clean = cleanCandidate(candidate, topic);
    if (!isUsefulCandidate(clean, topic)) return;
    const existing = scored.get(clean);
    if (existing) {
      scored.set(clean, {
        score: existing.score + score + 2,
        focus: existing.focus.length >= focus.length ? existing.focus : focus,
        count: existing.count + 1,
      });
    } else {
      scored.set(clean, { score, focus, count: 1 });
    }
  };

  for (const source of sources) {
    for (const phrase of extractConceptPhrases(source.excerpt)) {
      const focus = focusForCandidate(phrase, source.excerpt, topic);
      addCandidate(phrase, focus, conceptScore(phrase, source.relevance));
    }
  }

  const ranked = Array.from(scored.entries())
    .sort((a, b) => (b[1].score + b[1].count) - (a[1].score + a[1].count))
  const selected: typeof ranked = [];
  const groups = new Set<string>();
  for (const item of ranked) {
    const group = conceptGroup(item[0]);
    if (groups.has(group)) continue;
    groups.add(group);
    selected.push(item);
    if (selected.length === 4) break;
  }
  const top = selected.length >= 3 ? selected : ranked.slice(0, 4);

  if (top.length >= 3) {
    return top.map(([candidate, meta], index) => ({
      topic: candidate,
      focus: meta.focus || `Explain how ${candidate} relates to ${topic}`,
      visualStyle: index === 1 ? "example" : "diagram",
    }));
  }

  const fallback = ["Foundations", "Examples", "Patterns", "Misconceptions"].map((label, index) => ({
    topic: `${titleCaseTopic(topic)} ${label}`,
    focus: fallbackFocusFor(label, topic),
    visualStyle: index === 1 ? "example" as const : "diagram" as const,
  }));
  return [
    ...top.map(([candidate, meta], index) => ({
      topic: candidate,
      focus: meta.focus || `Explain how ${candidate} relates to ${topic}`,
      visualStyle: index === 1 ? "example" as const : "diagram" as const,
    })),
    ...fallback,
  ].slice(0, 4);
}

function cleanSourceTitle(title: string): string {
  return title
    .replace(/\[[^\]]+\]/g, "")
    .replace(/\b(tutorial|explained|introduction|complete guide|beginner'?s guide|examples?|latest|video|videos?)\b/gi, "")
    .replace(/[|:–—-]\s*(youtube|khan academy|geeksforgeeks|coursera|medium).*$/i, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+[|:–—-]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join(" ");
}

function cleanCandidate(value: string, topic: string): string {
  if (/area\s+under\s+(the\s+)?curve/i.test(value)) return "Area Under Curve";

  const topicTokens = new Set(topic.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  const words = value
    .replace(/\b(youtube|video|tutorial|guide|explained|explanation|introduction|examples?|latest|complete|beginner'?s|review|basic|lesson|lessons)\b/gi, "")
    .replace(/\b(how|what|why|when|where|who|your|the|and|for|with|from|into|about|made|easy|finally|understand|learn|learning|thanks|providing|explain|explains|explaining)\b/gi, "")
    .replace(/[^a-zA-Z0-9+'\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(/\s+/);
  const filtered = words.length > 1
    ? words.filter((word) => !topicTokens.has(word.toLowerCase()))
    : words;

  const clean = filtered
    .slice(0, 4)
    .map((word) => word.replace(/^[^a-zA-Z0-9+']+|[^a-zA-Z0-9+']+$/g, ""))
    .filter(Boolean)
    .map((word) => word.length <= 3 && word === word.toUpperCase()
      ? word
      : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
  return canonicalConcept(clean);
}

function extractConceptPhrases(text: string): string[] {
  const words = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-zA-Z0-9+.'\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const contentWords = words.filter((word) => !STOP_WORDS.has(word.toLowerCase()) && word.length > 2);
  const phrases = new Set<string>();

  for (let i = 0; i < contentWords.length; i += 1) {
    for (const size of [3, 2, 1]) {
      const phrase = contentWords.slice(i, i + size);
      if (phrase.length !== size) continue;
      phrases.add(phrase.join(" "));
    }
  }

  return Array.from(phrases);
}

function isUsefulCandidate(candidate: string, topic: string): boolean {
  if (candidate.length < 4 || candidate.length > 64) return false;
  if (sameTopic(candidate, topic)) return false;
  const lower = candidate.toLowerCase();
  if (lower.includes("'")) return false;
  if (/^(how|what|why|latest|everything|learn|thanks|definition|meaning)\b/i.test(candidate)) return false;
  if (["source", "excerpt", "minutes", "subscribers", "views", "explanation", "math is", "made easy", "ever hear", "organic chemistry"].some((word) => lower.includes(word))) return false;
  if (GENERIC_WORDS.has(lower)) return false;
  if (candidate.split(/\s+/).every((word) => GENERIC_WORDS.has(word.toLowerCase()))) return false;
  if (/^(use|using|practice|problem|examples?|rules?|methods?|formulas?|primary|secondary)$/i.test(candidate)) return false;
  if (/ing$/i.test(candidate) && candidate.split(/\s+/).length === 1 && !CONCEPT_HINTS.some((hint) => lower.includes(hint))) return false;
  return candidate.split(/\s+/).some((word) => word.length > 4 || word === word.toUpperCase());
}

function canonicalConcept(candidate: string): string {
  const lower = candidate.toLowerCase();
  if (/area\s+under\s+(the\s+)?curve/.test(lower)) return "Area Under Curve";
  if (lower === "indefinite definite") return "Indefinite Integrals";
  if (lower === "indefinite") return "Indefinite Integrals";
  if (lower === "definite") return "Definite Integrals";
  if (lower.includes("antiderivative") && lower.includes("indefinite")) return "Indefinite Integrals";
  if (lower.includes("indefinite") && lower.includes("integral")) return "Indefinite Integrals";
  if (lower.includes("definite") && lower.includes("integral")) return "Definite Integrals";
  if (lower.includes("antiderivative")) return "Antiderivatives";
  if (lower === "limit") return "Limits";
  if (lower === "derivative" || lower === "differential") return "Derivatives";
  if (lower === "integral") return "Integrals";
  if (lower === "integration") return "Integration";
  return candidate;
}

function conceptGroup(candidate: string): string {
  const lower = candidate.toLowerCase();
  if (lower.includes("area") && lower.includes("curve")) return "area-under-curve";
  if (lower.includes("limit")) return "limits";
  if (lower.includes("derivative") || lower.includes("differential")) return "derivatives";
  if (lower.includes("antiderivative")) return "antiderivatives";
  if (lower.includes("indefinite")) return "indefinite-integrals";
  if (lower.includes("definite")) return "definite-integrals";
  if (lower.includes("integral") || lower.includes("integration")) return "integrals";
  return lower.split(/\s+/)[0] || lower;
}

function sameTopic(candidate: string, topic: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalize(candidate) === normalize(topic);
}

function cleanExcerpt(excerpt: string): string {
  const cleaned = excerpt
    .replace(/\s+/g, " ")
    .replace(/^#+\s*/, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[[^\]]+\]\([^)]+\)/g, "")
    .trim();
  const sentence = cleaned
    .split(/[.!?]/)
    .map((part) => part.trim().replace(/^#+\s*/, ""))
    .find((part) => part.length > 35)
    || cleaned.split(/[.!?]/)[0]?.trim().replace(/^#+\s*/, "")
    || "";
  return sentence.slice(0, 180);
}

function focusForCandidate(candidate: string, excerpt: string, topic: string): string {
  const clean = cleanCandidate(candidate, topic);
  const sentences = excerpt.replace(/\s+/g, " ").split(/[.!?]/).map((sentence) => sentence.trim()).filter(Boolean);
  const token = clean.toLowerCase().split(/\s+/).find((part) => part.length > 3);
  const match = token ? sentences.find((sentence) => sentence.toLowerCase().includes(token)) : undefined;
  return cleanExcerpt(match || excerpt) || `Explain how ${clean} relates to ${topic}.`;
}

function conceptScore(phrase: string, relevance: number): number {
  const words = phrase.split(/\s+/).filter(Boolean);
  const lower = phrase.toLowerCase();
  let score = relevance + words.length;
  const hasHint = CONCEPT_HINTS.some((hint) => lower.includes(hint));
  if (hasHint) score += 8;
  if (lower.includes("area") && lower.includes("curve")) score += 12;
  if (["derivative", "limit", "integration", "integral", "differential", "antiderivative", "indefinite", "definite", "accumulation"].some((hint) => lower.includes(hint))) score += 5;
  if (hasHint && words.length === 1) score += 4;
  if (words.length === 1) score -= 1;
  if (words.length > 3) score -= 2;
  return score;
}

function titleCaseTopic(topic: string): string {
  return topic
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackFocusFor(label: string, topic: string): string {
  if (label === "Foundations") return `Define ${topic} and identify the central relationship.`;
  if (label === "Examples") return `Apply ${topic} to one concrete case.`;
  if (label === "Patterns") return `Find the repeated pattern that makes ${topic} easier to recognize.`;
  return `Separate a useful mental model from a common misconception about ${topic}.`;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "from", "into", "about", "this", "that", "what", "when", "where", "which",
  "your", "you", "how", "why", "are", "was", "were", "will", "can", "has", "have", "had", "not", "but",
  "tutorial", "guide", "video", "videos", "examples", "example", "learn", "learning", "latest", "complete",
  "beginner", "introduction", "explain", "explains", "explained", "explanation", "understand", "made", "easy", "finally", "minutes", "thanks",
  "definition", "meaning", "math", "fun", "source", "course", "review", "provide", "providing", "you'll", "youll", "ever", "hear",
  "use", "uses", "using", "practice", "problems", "problem", "organic", "chemistry", "method", "methods", "formula", "formulas", "primary", "secondary",
]);

const GENERIC_WORDS = new Set([
  "calculus", "math", "source", "course", "review", "definition", "meaning", "concept", "topic", "lesson",
  "curve", "you'll", "youll", "using", "use", "uses", "practice", "problem", "problems", "examples", "example", "rules", "rule", "methods", "method", "formulas", "formula", "primary", "secondary",
]);

const CONCEPT_HINTS = [
  "rule", "model", "application", "interview", "launch", "problem", "market", "founder",
  "limit", "derivative", "integration", "integral", "differential", "antiderivative", "indefinite", "definite", "probability", "vector", "network",
  "simulation", "strategy", "character", "theme", "argument", "evidence", "area",
];
