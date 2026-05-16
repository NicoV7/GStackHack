import Anthropic from "@anthropic-ai/sdk";
import type { SSEEvent, Question } from "../types";
import { RewireOutputSchema } from "./schemas";
import { REWIRE_SYSTEM_PROMPT } from "./prompts";

type EmitFn = (event: SSEEvent) => void;

const client = new Anthropic();

export interface RewireInput {
  wrongAnswer: string;
  question: Question;
  currentTopic: string;
  existingNodes: string[];
}

export async function rewireAgent(input: RewireInput, emit: EmitFn) {
  const correctOption = input.question.options.find((o) => o.correct);

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 512,
      system: REWIRE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Topic: ${input.currentTopic}
Question: ${input.question.text}
Their answer: ${input.wrongAnswer}
Correct answer: ${correctOption?.label ?? "unknown"}
Hint: ${input.question.prerequisiteTopic ?? "none"}
Existing nodes: [${input.existingNodes.join(", ")}]`,
        },
      ],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const jsonStr = text.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const parsed = RewireOutputSchema.safeParse(JSON.parse(jsonStr));

    if (!parsed.success) {
      return fallbackRewire(input, emit);
    }

    const prereqId = parsed.data.prerequisiteTopic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");

    emit({
      type: "graph.prerequisite_suggested",
      node: {
        id: prereqId,
        topic: parsed.data.prerequisiteTopic,
        status: "prerequisite-suggested",
        position: { x: 0, y: -180 },
      },
      reason: parsed.data.reason,
    });

    const topicId = input.currentTopic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    emit({
      type: "graph.edge_added",
      edge: {
        id: `e-${prereqId}-${topicId}`,
        source: prereqId,
        target: topicId,
        type: "prerequisite",
      },
    });
  } catch {
    fallbackRewire(input, emit);
  }
}

function fallbackRewire(input: RewireInput, emit: EmitFn) {
  const prereqTopic = input.question.prerequisiteTopic || "Foundations";
  const prereqId = prereqTopic.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const topicId = input.currentTopic.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  emit({
    type: "graph.prerequisite_suggested",
    node: {
      id: prereqId,
      topic: prereqTopic,
      status: "prerequisite-suggested",
      position: { x: 0, y: -180 },
    },
    reason: `Based on the question hint: ${prereqTopic}`,
  });

  emit({
    type: "graph.edge_added",
    edge: {
      id: `e-${prereqId}-${topicId}`,
      source: prereqId,
      target: topicId,
      type: "prerequisite",
    },
  });
}
