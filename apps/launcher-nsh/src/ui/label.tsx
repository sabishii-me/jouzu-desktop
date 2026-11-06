import { Text } from "nsh";
import type { JSX } from "nsh";
import { cn } from "../lib";

export function Label(props: { className?: string; htmlFor?: string; children?: JSX.Element }) {
  return <Text class={cn("text-sm font-medium", props.className)}>{props.children}</Text>;
}