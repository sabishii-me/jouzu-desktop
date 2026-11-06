import { Progress as BaseProgress } from "nsh/base";
import { cn } from "../lib";

/** The launcher's progress bar; null/undefined value means indeterminate. */
export function Progress(props: { className?: string; value?: number | null }) {
  return (
    <BaseProgress
      class={cn("w-full", props.className)}
      value={props.value ?? undefined}
      indeterminate={props.value == null}
      trackClass="h-2 w-full overflow-hidden rounded-full bg-primary/20"
      indicatorClass={cn("h-full bg-primary", props.value == null ? "w-1/3 animate-pulse" : "")}
    />
  );
}