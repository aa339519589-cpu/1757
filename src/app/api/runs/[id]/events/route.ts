import { getRun } from "@/server/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let previous = "";
      try {
        while (!request.signal.aborted) {
          const run = getRun(id);
          if (!run) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "Run not found" })}\n\n`));
            break;
          }
          const snapshot = JSON.stringify(run);
          if (snapshot !== previous) {
            controller.enqueue(encoder.encode(`event: run\ndata: ${snapshot}\n\n`));
            previous = snapshot;
          }
          if (["succeeded", "failed", "cancelled"].includes(run.status)) break;
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
      } finally {
        try { controller.close(); } catch { /* client disconnected */ }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
