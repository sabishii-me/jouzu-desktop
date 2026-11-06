/**
 * The in-app channel for "Quote" on an image artifact: the artifacts panel
 * dispatches `jouzu:use-artifact` with the artifact path, and the chat
 * workspace attaches it. Replaces the baseline's window CustomEvent.
 */
export const artifactBus = new EventTarget();

export function quoteArtifact(path: string): void {
  artifactBus.dispatchEvent(new CustomEvent("jouzu:use-artifact", { detail: path }));
}

export function onQuoteArtifact(handler: (path: string) => void): () => void {
  const listener = (event: Event) => {
    const path = (event as CustomEvent<string>).detail;
    if (typeof path === "string" && path) handler(path);
  };
  artifactBus.addEventListener("jouzu:use-artifact", listener);
  return () => artifactBus.removeEventListener("jouzu:use-artifact", listener);
}