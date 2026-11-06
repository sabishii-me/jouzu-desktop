import { Text, View } from "nsh";
import type { JSX } from "nsh";
import { cn } from "../lib";

interface CardPartProps {
  className?: string;
  children?: JSX.Element;
}

export function Card(props: CardPartProps) {
  return <View class={cn("flex-col gap-4 rounded-xl border border-border bg-card py-5 text-card-foreground", props.className)}>{props.children}</View>;
}

export function CardHeader(props: CardPartProps) {
  return <View class={cn("flex-col gap-1.5 px-5", props.className)}>{props.children}</View>;
}

export function CardTitle(props: CardPartProps) {
  return <Text class={cn("text-base font-semibold leading-none text-card-foreground", props.className)}>{props.children}</Text>;
}

export function CardDescription(props: CardPartProps) {
  return <Text class={cn("text-sm text-muted-foreground", props.className)}>{props.children}</Text>;
}

export function CardContent(props: CardPartProps) {
  return <View class={cn("flex-col px-5", props.className)}>{props.children}</View>;
}