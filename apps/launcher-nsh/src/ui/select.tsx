import { View, Text } from "nsh";
import { Select as BaseSelect } from "nsh/base";
import { cn } from "../lib";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value?: string | null;
  onValueChange?: (value: string) => void;
  items: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  "aria-label"?: string;
}

/**
 * The launcher's select. The baseline's compound radix API becomes one
 * component with `items`; ported call sites pass
 * `items={[{ value, label }]}` instead of SelectItem children.
 */
export function Select(props: SelectProps) {
  return (
    <BaseSelect
      items={props.items.map(item => ({ value: item.value, title: item.label }))}
      value={props.value ?? null}
      disabled={props.disabled}
      searchable={props.searchable}
      searchPlaceholder={props.searchPlaceholder ?? null}
      accessibilityLabel={props["aria-label"] ?? null}
      popupClass="rounded-md border border-border bg-popover p-1 shadow-lg"
      itemClass="rounded-sm px-2 py-1.5 text-sm text-popover-foreground focus:bg-accent selected:bg-accent"
      onChange={event => {
        if (event.value != null) props.onValueChange?.(event.value);
      }}
      trigger={
        <View
          class={cn(
            "h-9 w-full flex-row items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-sm disabled:opacity-50 dark:bg-input/30",
            props.className,
          )}
        >
          <Text class={cn("min-w-0 flex-1 truncate text-sm", props.value ? "text-foreground" : "text-muted-foreground")}>
            {props.items.find(item => item.value === props.value)?.label ?? props.placeholder ?? ""}
          </Text>
          <Text class="text-xs text-muted-foreground">▾</Text>
        </View>
      }
    />
  );
}