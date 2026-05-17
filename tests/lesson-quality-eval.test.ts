/**
 * Lesson generation quality eval — hits REAL local Ollama.
 *
 * Run manually:
 *   RUN_EVALS=1 npm test -- tests/lesson-quality-eval.test.ts
 *
 * Skipped in CI (no Ollama available).
 */

import { describe, it, expect } from "vitest";
import { callAgentLLM } from "@/lib/llm";
import { LessonSchema } from "@/lib/agents/schemas";
import { LESSON_SYSTEM_PROMPT } from "@/lib/agents/prompts";

// Point at local Ollama with qwen3:8b for the eval
process.env.OLLAMA_URL = "http://localhost:11434";
process.env.OLLAMA_MODEL = "qwen3:8b";
// Give the model plenty of time — 60s timeout for the HTTP call itself
process.env.LLM_TIMEOUT_MS = "60000";

const shouldRun = !!process.env.RUN_EVALS;

const describeEval = shouldRun ? describe : describe.skip;

describeEval("Lesson quality eval (real Ollama)", () => {
  const userPrompt =
    'Generate a lesson about "The Chain Rule" for a calculus student.';

  let lesson: Awaited<ReturnType<typeof callAgentLLM<typeof LessonSchema._type>>>;

  // Fetch the lesson once and share across assertions
  it("JSON validity — callAgentLLM returns a valid LessonSchema object", async () => {
    lesson = await callAgentLLM(LessonSchema, LESSON_SYSTEM_PROMPT, userPrompt);

    // If we got here, JSON parsed and Zod validated successfully
    expect(lesson).toBeDefined();
    expect(lesson.title).toBeTypeOf("string");
    expect(lesson.content).toBeTypeOf("string");
    expect(Array.isArray(lesson.quiz)).toBe(true);
  }, 90_000);

  it("Content length — between 50 and 600 characters", () => {
    expect(lesson).toBeDefined();
    expect(lesson.content.length).toBeGreaterThan(50);
    expect(lesson.content.length).toBeLessThanOrEqual(600);
  }, 90_000);

  it("Has quiz — at least 1 question with options", () => {
    expect(lesson).toBeDefined();
    expect(lesson.quiz.length).toBeGreaterThanOrEqual(1);

    const q = lesson.quiz[0];
    expect(q.text).toBeTypeOf("string");
    expect(q.text.length).toBeGreaterThan(5);
    expect(q.options.length).toBeGreaterThanOrEqual(2);

    // At least one correct option
    const hasCorrect = q.options.some((o) => o.correct === true);
    expect(hasCorrect).toBe(true);
  }, 90_000);

  it("Not raw source text — no URLs, subscriber counts, or YouTube metadata", () => {
    expect(lesson).toBeDefined();
    const text = `${lesson.title} ${lesson.content}`;

    // Should not contain raw URLs
    expect(text).not.toMatch(/https?:\/\/[^\s]+/);
    // Should not mention subscriber/view counts
    expect(text.toLowerCase()).not.toMatch(/subscribers?/);
    expect(text.toLowerCase()).not.toMatch(/\d+\s*views/);
    // Should not contain YouTube metadata artifacts
    expect(text.toLowerCase()).not.toMatch(/youtube/);
    expect(text.toLowerCase()).not.toMatch(/watch\?v=/);
  }, 90_000);
});
