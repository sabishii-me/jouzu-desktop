import { createContext, useContext, type ReactNode } from "react";

/** The open session's workspace, so transcript paths can be resolved natively. */
const WorkspaceContext = createContext<string | undefined>(undefined);

export function WorkspaceProvider({ path, children }: { path?: string; children: ReactNode }) {
  return <WorkspaceContext.Provider value={path}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspaceRoot(): string | undefined {
  return useContext(WorkspaceContext);
}