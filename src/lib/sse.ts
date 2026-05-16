import type { SSEEvent } from "./types";

export function createSSEStream() {
  let controller: ReadableStreamDefaultController | null = null;
  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    start(c) {
      controller = c;
    },
  });

  function emit(event: SSEEvent) {
    if (!controller) return;
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  function close() {
    if (!controller) return;
    controller.close();
    controller = null;
  }

  return { readable, emit, close };
}

export function sseResponse(readable: ReadableStream) {
  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
