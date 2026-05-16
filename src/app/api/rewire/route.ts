import { createSSEStream, sseResponse } from "@/lib/sse";
import { rewireAgent } from "@/lib/agents/rewire-agent";
import type { Question } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    wrongAnswer: string;
    question: Question;
    currentTopic: string;
    existingNodes: string[];
    sessionId?: string;
  };
  const _sessionId = body.sessionId || "anonymous";

  const { readable, emit, close } = createSSEStream();

  (async () => {
    try {
      await rewireAgent(body, emit);
      emit({ type: "pipeline.complete", totalMs: 0 });
    } catch (err) {
      emit({ type: "pipeline.error", error: String(err) });
    } finally {
      close();
    }
  })();

  return sseResponse(readable);
}
