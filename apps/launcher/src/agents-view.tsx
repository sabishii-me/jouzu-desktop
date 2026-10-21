import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "./components/ui/button";

interface AgentRole {
  id: string;
  description: string;
  model: string;
  instructions: string;
  placement: "main" | "child" | "both";
  judging: boolean;
  tools: string[];
  thinking: string;
  timeoutSeconds: number;
  maxTurns: number;
}
interface AgentRolesResponse {
  roles: AgentRole[];
  maxConcurrent: number;
  workspaceWriters: string;
  revision: string;
  error?: string;
}

/** Read-only projection of the runtime's effective agent roles. */
export function AgentsView() {
  const [data, setData] = useState<AgentRolesResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const next = await invoke<AgentRolesResponse>("control_request", { request: { action: "agent-roles" } });
      if (next.error) setError(next.error);
      else setData(next);
    } catch (failure) { setError(String(failure).replace(/^Error:\s*/u, "")); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);

  return <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8">
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center gap-2">
        <Bot className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Agents</h2>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">read only</span>
        <Button variant="ghost" className="ml-auto size-7 p-0" aria-label="Refresh agents" title="Refresh agents" disabled={loading} onClick={() => void load()}><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></Button>
      </div>
      {loading && !data && <div className="flex items-center gap-2 py-8 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />Loading agents…</div>}
      {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      {data && <>
        <p className="mb-3 text-xs text-muted-foreground">Concurrency {data.maxConcurrent} · Child writers {data.workspaceWriters}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.roles.map(role => <article key={role.id} className="rounded-xl border border-border bg-card p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">{role.id}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>
              </div>
              <span className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{role.placement}</span>
            </div>
            <dl className="mt-3 grid grid-cols-[5.5rem_1fr] gap-x-2 gap-y-1 text-[11px]">
              <dt className="text-muted-foreground">Model</dt><dd className="truncate font-mono">{role.model}</dd>
              <dt className="text-muted-foreground">Thinking</dt><dd>{role.thinking}</dd>
              <dt className="text-muted-foreground">Limits</dt><dd>{role.timeoutSeconds}s · {role.maxTurns} turns</dd>
              <dt className="text-muted-foreground">Tools</dt><dd className="truncate" title={role.tools.join(", ")}>{role.tools.length} enabled</dd>
              {role.judging && <><dt className="text-muted-foreground">Mode</dt><dd>review only</dd></>}
            </dl>
          </article>)}
        </div>
      </>}
    </div>
  </div>;
}
