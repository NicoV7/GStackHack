import { createSSEStream, sseResponse } from "@/lib/sse";
import { rewireAgent } from "@/lib/agents/rewire-agent";
import { putConceptMemory } from "@/lib/gbrain";
import type { Question, SSEEvent } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    wrongAnswer: string;
    question: Question;
    currentTopic: string;
    existingNodes: string[];
    sessionId?: string;
  };
  const sessionId = body.sessionId || "anonymous";

  const { readable, emit, close } = createSSEStream();

  (async () => {
    try {
      let prerequisiteTopic: string | null = null;

      const wrappedEmit = (event: SSEEvent) => {
        if (event.type === "graph.prerequisite_suggested") {
          prerequisiteTopic = (event as { node?: { topic?: string } }).node?.topic || null;
        }
        emit(event);
      };

      await rewireAgent(body, wrappedEmit);

      // Write misconception to GBrain
      if (prerequisiteTopic) {
        putConceptMemory(sessionId, body.currentTopic,
          `Misconception detected: answered "${body.wrongAnswer}" for question about ${body.currentTopic}. Prerequisite needed: ${prerequisiteTopic}`
        ).catch(() => {});
        emit({ type: "gbrain.memory_written", topic: body.currentTopic });
      }

      emit({ type: "pipeline.complete", totalMs: 0 });
    } catch (err) {
      emit({ type: "pipeline.error", error: String(err) });
    } finally {
      close();
    }
  })();

  return sseResponse(readable);
}
