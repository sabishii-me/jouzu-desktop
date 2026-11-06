import { computed, effect, signal } from "nsh";
import type { Accessor, Signal } from "nsh";
import { invoke, errorText } from "./host/invoke";
import { listen } from "./host/events";
import { createUpdateSchedule, startUpdateChecks } from "./update-schedule";
import { logEvent } from "./log-event";

/**
 * The signal port of useJouzuUpdate. `enabled` replaces the baseline
 * `configured` boolean: it is read at call time and tracked by the schedule
 * effect, so a configuration that arrives after the first render is picked up
 * (the baseline needed a runRef for the same reason). The progress-event
 * subscription lives for the store's lifetime, which is the app session, as
 * the baseline hook's was (it lived as long as App stayed mounted).
 */
export interface JouzuUpdateStore {
  /** The backend's phase names pass through unchanged (preparing, verifying, ... included). */
  phase: Signal<string>;
  busy: Accessor<boolean>;
  progress: Signal<number | undefined>;
  version: Signal<string | null>;
  error: Signal<string | null>;
  notes: Signal<string | null>;
  notesSource: Signal<string | null>;
  check: () => Promise<void>;
  install: () => Promise<void>;
}

export function createJouzuUpdate(enabled: () => boolean, onInstalled: () => void): JouzuUpdateStore {
  const version = signal<string | null>(null);
  const notes = signal<string | null>(null);
  const notesSource = signal<string | null>(null);
  const phase = signal("idle");
  const error = signal<string | null>(null);
  const progress = signal<number | undefined>(undefined);
  let lock = false;
  listen<{ phase: string; downloaded?: number; total?: number }>("jouzu-update-progress", ({ payload }) => {
    if (!lock) return;
    phase.set(payload.phase);
    progress.set(payload.total ? (payload.downloaded ?? 0) / payload.total * 100 : undefined);
  });
  // A silent check runs on its own schedule and must not move the interface while it asks.
  async function run(action: "check" | "install", silent = false) {
    if (!enabled() || lock) return;
    lock = true;
    if (!silent) { error.set(null); phase.set(action === "check" ? "checking" : "downloading"); }
    try {
      const result = await invoke<{ version: string; available: boolean; notes?: string; notesSource?: string }>("jouzu_update", { action, version: action === "install" ? version() : null });
      if (action === "check") {
        version.set(result.available ? result.version : null);
        notes.set(result.notes ?? null);
        notesSource.set(result.notesSource ?? null);
        phase.set(result.available ? "available" : "current");
      } else {
        version.set(null);
        phase.set("complete");
        onInstalled();
      }
    } catch (e) {
      logEvent(`jouzu update check failed error=${String(e)}`);
      if (!silent) { error.set(errorText(e)); phase.set("error"); }
    } finally { lock = false; }
  }
  const schedule = createUpdateSchedule(silent => { void run("check", silent); });
  // The schedule starts when the configuration arrives and stops if it goes away,
  // as the baseline's [configured] effect did.
  effect(() => {
    if (!enabled()) return;
    return startUpdateChecks(schedule);
  });
  const busy = computed(() => !["idle", "available", "current", "complete", "error"].includes(phase()));
  return { version, notes, notesSource, phase, error, progress, busy, check: () => run("check"), install: () => run("install") };
}
