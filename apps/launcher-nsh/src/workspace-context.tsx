import { context } from "nsh";
import type { JSX } from "nsh";

/**
 * The session workspace root: the boundary for reading a local transcript image
 * and for resolving a relative path before a native reveal.
 */
export const WorkspaceContext = context<string | undefined>(undefined);

export function WorkspaceProvider(props: { path?: string; children?: JSX.Element }) {
  return <WorkspaceContext.Provider value={props.path}>{props.children}</WorkspaceContext.Provider>;
}

export function useWorkspaceRoot(): string | undefined {
  return WorkspaceContext();
}