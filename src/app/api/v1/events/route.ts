import { getActiveUser } from "@/lib/db/session";
import { subscribeUserEvents } from "@/lib/realtime/bus";
import { startBackgroundWorkers } from "@/lib/workers/scheduler";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  startBackgroundWorkers();
  const user = await getActiveUser();
  if (!user) {
    return new Response("Onboarding required", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream already closed
        }
      };

      send("connected", {
        user_id: user.id,
        current_day: user.current_day,
        current_slot: user.current_slot,
      });

      const unsubscribe = subscribeUserEvents(user.id, (envelope) => {
        send(envelope.event, envelope.data);
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 20000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
