import { Switch as BaseSwitch } from "nsh/base";
import { cn } from "../lib";

export interface SwitchProps {
  className?: string;
  id?: string;
  checked?: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  "aria-label"?: string;
}

export function Switch(props: SwitchProps) {
  return (
    <BaseSwitch
      class={cn("", props.className)}
      checked={props.checked}
      disabled={props.disabled}
      accessibilityLabel={props["aria-label"] ?? null}
      onChange={event => props.onCheckedChange?.(event.checked)}
      trackClass="h-5 w-9 rounded-full bg-input checked:bg-primary"
      thumbClass="size-4 translate-x-0.5 rounded-full bg-background checked:translate-x-4.5"
    />
  );
}