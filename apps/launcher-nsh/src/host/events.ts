import { Events } from "jouzu-desktop/native";

type Handler = (event: { payload: unknown }) => void;
const listeners = new Map<string, Set<Handler>>();
let pumping = false;

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const raw = await Events.wait();
      const batch = JSON.parse(raw) as { event: string; payload: unknown }[];
      for (const item of batch) {
        const handlers = listeners.get(item.event);
        if (!handlers) continue;
        for (const handler of [...handlers]) {
          try {
            handler({ payload: item.payload });
          } catch (error) {
            console.error(`event handler for ${item.event} failed`, error);
          }
        }
      }
    }
  } catch (error) {
    console.error("event pump failed", error);
    pumping = false;
  }
}

/**
 * The listen shim over the backend event bus. Returns an unsubscribe function,
 * like @tauri-apps/api/event did (there it was a promise of one).
 */
export function listen<T = unknown>(event: string, handler: (event: { payload: T }) => void): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(handler as Handler);
  void pump();
  return () => {
    set.delete(handler as Handler);
  };
}