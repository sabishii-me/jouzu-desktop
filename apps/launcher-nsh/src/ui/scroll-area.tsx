import { Scroll } from "nsh";
import type { JSX, ScrollRef } from "nsh";
import { cn } from "../lib";

/** The launcher's scroll container; NSH draws the platform's own scroll bar. */
export function ScrollArea(props: {
  className?: string;
  horizontal?: boolean;
  children?: JSX.Element;
  ref?: ScrollRef | ((ref: ScrollRef) => void);
}) {
  return (
    <Scroll class={cn("flex-col", props.className)} horizontal={props.horizontal} ref={props.ref}>
      {props.children}
    </Scroll>
  );
}