import { createSSEStream, sseResponse } from "@/lib/sse";
import { rewireAgent } from "@/lib/agents/rewire-agent";
import { addWeakArea, putConceptMemory, safeSessionId } from "@/lib/gbrain";
import type { Question, SSEEvent } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    wrongAnswer: string;
    question: Question;
    currentTopic: string;
    existingNodes: string[];
    sessionId?: string;
  };
  const sessionId = safeSessionId(body.sessionId || "anonymous");

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
        const prerequisite: string = prerequisiteTopic;
        const writes = [
          () => putConceptMemory(
            sessionId,
            body.currentTopic,
            `Misconception detected: answered "${body.wrongAnswer}" for question about ${body.currentTopic}. Prerequisite needed: ${prerequisite}`
          ),
          () => putConceptMemory(
            sessionId,
            prerequisite,
            `Suggested as a prerequisite for ${body.currentTopic} after the learner answered "${body.wrongAnswer}".`
          ),
          () => addWeakArea(sessionId, prerequisite),
        ];
        let allWritten = true;
        for (const writeMemory of writes) {
          try {
            allWritten = (await writeMemory()) && allWritten;
          } catch {
            allWritten = false;
          }
        }
        emit(allWritten
          ? { type: "gbrain.memory_written", topic: body.currentTopic }
          : { type: "gbrain.offline", reason: "misconception_write_failed" });
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
