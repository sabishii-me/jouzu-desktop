import { createContext, useContext } from "react";

/** The session workspace root: the boundary for reading a local transcript image. */
export const WorkspaceContext = createContext<string | undefined>(undefined);

export function useWorkspaceRoot(): string | undefined {
  return useContext(WorkspaceContext);
}
