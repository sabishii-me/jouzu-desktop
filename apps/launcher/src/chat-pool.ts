import { ChatConnection } from "./chat-connection";
import type { WireObject } from "./chat-projection";

interface Slot {
  client: ChatConnection;
  path: string;
  ready: Promise<void>;
}

/**
 * Keeps blank runtimes warm so opening a session or starting a new one does not
 * pay the spawn cost. A slot is only ever leased to one view at a time: the
 * pool removes it from the idle set before handing it out, and the caller closes
 * it when the view goes away. Different workspaces keep different slots, which
 * matches the native one-runtime-per-workspace ownership guard.
 */
export class ChatPool {
  private slots = new Map<ChatConnection, Slot>();
  private idle = new Set<ChatConnection>();
  private disposed = false;

  constructor(private readonly target = 4) {}

  /** Warm blank runtimes for `path` until the idle target is met. */
  async warm(path: string): Promise<void> {
    while (!this.disposed && this.idle.size < this.target) {
      const client = new ChatConnection(() => {}, () => {});
      const slot: Slot = { client, path, ready: client.start(path, true, `slot:${crypto.randomUUID()}`) };
      this.slots.set(client, slot);
      try {
        await slot.ready;
        if (this.disposed) { void client.close(); return; }
        this.idle.add(client);
      } catch {
        this.slots.delete(client);
        void client.close();
        return;
      }
    }
  }

  /** Take a warm runtime for `path`; switch it to `sessionPath` when one is given. */
  async lease(path: string, sessionPath?: string, dialog?: (request: WireObject) => void, fresh = true): Promise<ChatConnection> {
    let client: ChatConnection | undefined;
    if (fresh) for (const candidate of this.idle) {
      if (this.slots.get(candidate)?.path === path) { client = candidate; break; }
    }
    if (client) {
      this.idle.delete(client);
      this.slots.delete(client);
      if (dialog) client.setDialogHandler(dialog);
      if (sessionPath) await client.resumeSession(sessionPath);
    } else {
      client = new ChatConnection(() => {}, dialog ?? (() => {}));
      await client.start(path, fresh && !sessionPath, fresh ? undefined : path);
      if (sessionPath) await client.resumeSession(sessionPath);
    }
    void this.warm(path).catch(() => {});
    return client;
  }

  dispose(): void {
    this.disposed = true;
    for (const client of this.slots.keys()) void client.close();
    this.slots.clear();
    this.idle.clear();
  }
}

/** One pool per window: the legacy single-view workspace leases a runtime from it. */
export const chatPool = new ChatPool(4);
