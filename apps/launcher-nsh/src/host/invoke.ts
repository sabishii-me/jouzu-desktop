import { Backend } from "jouzu-desktop/native";

/**
 * The invoke shim: the same call shape the Tauri frontend always used. The
 * backend answers a JSON envelope so structured errors (image read failures)
 * arrive as objects, exactly as Tauri delivered them.
 */
export async function invoke<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const raw = await Backend.invoke(command, JSON.stringify(args));
  const envelope = JSON.parse(raw) as { ok: boolean; value?: T; error?: unknown };
  if (envelope.ok) return envelope.value as T;
  throw envelope.error;
}

/** The NSH app is always the desktop host; kept so ported call sites read the same. */
export function isTauri(): boolean {
  return true;
}

/** Error text the way the baseline UI showed it (string errors or Error objects). */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}