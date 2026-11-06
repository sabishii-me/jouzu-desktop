import { Storage } from "nsh";

/**
 * A synchronous localStorage-shaped facade over NSH's async Storage. The
 * entries are loaded once before the app mounts; writes go through in order
 * (NSH guarantees a read after a write sees it) while the cache answers at
 * once, so the ported preference and draft code stays synchronous.
 */
const cache = new Map<string, string>();

export async function loadStorage(): Promise<void> {
  const keys = await Storage.keys();
  for (const key of keys) {
    const value = await Storage.getItem(key);
    if (value !== null) cache.set(key, value);
  }
}

export const localStorage = {
  getItem(key: string): string | null {
    return cache.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    cache.set(key, String(value));
    void Storage.setItem(key, String(value)).catch(error => console.error("storage write failed", error));
  },
  removeItem(key: string): void {
    cache.delete(key);
    void Storage.removeItem(key).catch(error => console.error("storage remove failed", error));
  },
};