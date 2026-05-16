import { callAgentLLM } from "../llm";
import type { SSEEvent, Question } from "../types";
import { RewireOutputSchema } from "./schemas";
import { REWIRE_SYSTEM_PROMPT } from "./prompts";

type EmitFn = (event: SSEEvent) => void;

export interface RewireInput {
  wrongAnswer: string;
  question: Question;
  currentTopic: string;
  existingNodes: string[];
}

export async function rewireAgent(input: RewireInput, emit: EmitFn) {
  const correctOption = input.question.options.find((o) => o.correct);

  try {
    const result = await callAgentLLM(
      RewireOutputSchema,
      REWIRE_SYSTEM_PROMPT,
      `Topic: ${input.currentTopic}
Question: ${input.question.text}
Their answer: ${input.wrongAnswer}
Correct answer: ${correctOption?.label ?? "unknown"}
Hint: ${input.question.prerequisiteTopic ?? "none"}
Existing nodes: [${input.existingNodes.join(", ")}]`
    );

    const prereqId = result.prerequisiteTopic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-");

    emit({
      type: "graph.prerequisite_suggested",
      node: {
        id: prereqId,
        topic: result.prerequisiteTopic,
        status: "prerequisite-suggested",
        position: { x: 0, y: -180 },
      },
      reason: result.reason,
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
