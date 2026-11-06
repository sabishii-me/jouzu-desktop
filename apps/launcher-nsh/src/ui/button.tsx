import { Text } from "nsh";
import { Button as BaseButton } from "nsh/base";
import { cn } from "../lib";
import type { JSX } from "nsh";

const VARIANTS: Record<string, string> = {
  default: "bg-primary text-primary-foreground hover:opacity-90",
  outline: "border border-border bg-background hover:bg-muted",
  ghost: "hover:bg-muted",
  destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
};

export interface ButtonProps {
  className?: string;
  variant?: "default" | "outline" | "ghost" | "destructive";
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  /** The baseline aria-label; NSH calls it accessibilityLabel. */
  "aria-label"?: string;
  children?: JSX.Element;
}

/**
 * The launcher's button. Keeps the baseline call shape (className, onClick);
 * a plain string child is wrapped in Text because NSH text lives in text
 * elements. Props are read where used so they follow signals.
 */
export function Button(props: ButtonProps) {
  return (
    <BaseButton
      class={cn(
        "flex-row items-center justify-center gap-2 rounded-md px-4 py-2 min-h-10 text-sm font-medium disabled:opacity-50 active:opacity-80",
        VARIANTS[props.variant ?? "default"] ?? VARIANTS.default,
        props.className,
      )}
      disabled={props.disabled}
      onPress={() => props.onClick?.()}
      accessibilityLabel={props["aria-label"] ?? props.title ?? null}
    >
      {typeof props.children === "string" ? <Text class="text-sm font-medium">{props.children}</Text> : props.children}
    </BaseButton>
  );
}

/** A text label inside a button or row, the port of a bare <span> caption. */
export function ButtonLabel(props: { class?: string; children?: JSX.Element }) {
  return <Text class={cn("text-sm font-medium", props.class)}>{props.children}</Text>;
}