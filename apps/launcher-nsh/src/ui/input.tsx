import { Input as BaseInput } from "nsh/base";
import type { InputRef } from "nsh";
import { cn } from "../lib";

/** The React-shaped change event the ported call sites read. */
export interface ChangeEvent {
  target: { value: string };
}

export interface InputProps {
  className?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (event: ChangeEvent) => void;
  onSubmit?: () => void;
  onFocus?: () => void;
  "aria-label"?: string;
  ref?: (ref: InputRef) => void;
}

/** The launcher's text input; passwords mask, numbers take the number keyboard. */
export function Input(props: InputProps) {
  return (
    <BaseInput
      class={cn(
        "h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-50 focus:border-ring dark:bg-input/30",
        props.className,
      )}
      value={props.value}
      placeholder={props.placeholder}
      masked={props.type === "password"}
      keyboardType={props.type === "number" ? "number-pad" : undefined}
      readonly={props.readOnly}
      autoFocus={props.autoFocus}
      accessibilityLabel={props["aria-label"] ?? undefined}
      onChange={event => props.onChange?.({ target: { value: event.value } })}
      onSubmit={() => props.onSubmit?.()}
      onFocus={() => props.onFocus?.()}
      ref={props.ref}
    />
  );
}