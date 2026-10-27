import { invoke } from "@tauri-apps/api/core";
import { ChatConnection } from "./chat-connection";
import type { WireObject } from "./chat-projection";

interface Slot {
  client: ChatConnection;
  scratch: string;
}

/**
 * Warm slots are blank runtimes started in a private scratch directory. They never
 * attach the real workspace's session branch, so they cannot contend with the
 * visible runtime for Flow ownership. Leasing a session runs switch_session, which
 * releases the scratch branch and acquires the target's. New sessions cold-start
 * in the real workspace because a scratch runtime's cwd is its scratch directory.
 */
export class ChatPool {
  private slots = new Map<ChatConnection, Slot>();
  private idle = new Set<ChatConnection>();
  private entries = new Map<string, ChatConnection>();
  private disposed = false;

  constructor(private readonly target = 4, private readonly maxSessions = 30) {}

  async warm(): Promise<void> {
    while (!this.disposed && this.idle.size < this.target) {
      const scratch = await invoke<string>("chat_scratch_dir");
      const client = new ChatConnection(() => {}, () => {});
      this.slots.set(client, { client, scratch });
      try {
        await client.start(scratch, true, `slot:${crypto.randomUUID()}`);
        if (this.disposed) { void client.close(); return; }
        this.idle.add(client);
      } catch {
        this.slots.delete(client);
        void client.close();
        return;
      }
    }
  }

  /** Take a warm runtime for `path`; a session target switches it across cwd. */
  async lease(path: string, sessionPath?: string, dialog?: (request: WireObject) => void, fresh = true): Promise<ChatConnection> {
    let client: ChatConnection | undefined;
    if (sessionPath) {
      for (const candidate of this.idle) { client = candidate; break; }
    }
    if (client) {
      this.idle.delete(client);
      this.slots.delete(client);
      if (dialog) client.setDialogHandler(dialog);
      await client.resumeSession(sessionPath!);
    } else {
      client = new ChatConnection(() => {}, dialog ?? (() => {}));
      await client.start(path, fresh && !sessionPath, `slot:${crypto.randomUUID()}`);
      if (sessionPath) await client.resumeSession(sessionPath);
    }
    void this.warm().catch(() => {});
    return client;
  }

  /** A live session client kept across view switches; LRU-bounded by maxSessions. */
  async enter(path: string, sessionPath: string, dialog?: (request: WireObject) => void): Promise<ChatConnection> {
    const cached = this.entries.get(sessionPath);
    if (cached && !cached.isDisposed()) {
      this.entries.delete(sessionPath);
      this.entries.set(sessionPath, cached);
      return cached;
    }
    if (cached) this.entries.delete(sessionPath);
    const client = await this.lease(path, sessionPath, dialog, false);
    this.entries.set(sessionPath, client);
    while (this.entries.size > this.maxSessions) {
      const oldest = this.entries.keys().next().value as string;
      const evicted = this.entries.get(oldest);
      this.entries.delete(oldest);
      void evicted?.close();
    }
    return client;
  }

  /** Keep an existing client under its session path so switching back is instant. */
  remember(sessionPath: string, client: ChatConnection): void {
    this.entries.set(sessionPath, client);
    while (this.entries.size > this.maxSessions) {
      const oldest = this.entries.keys().next().value as string;
      const evicted = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (evicted && evicted !== client) void evicted.close();
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const client of this.slots.keys()) void client.close();
    this.slots.clear();
    this.idle.clear();
  }
}

/** One pool per window: the workspace view leases a runtime from it. */
export const chatPool = new ChatPool(4);