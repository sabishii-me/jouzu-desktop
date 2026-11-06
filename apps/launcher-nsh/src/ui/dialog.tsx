import { Overlay, View, Text } from "nsh";
import type { JSX } from "nsh";
import { cn } from "../lib";

/**
 * The launcher's modal dialog on a root Overlay: a backdrop that closes it
 * and a centered panel. The baseline compound API is flattened — content,
 * title and description are children of Dialog itself.
 */
export function Dialog(props: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  modal?: boolean;
  children?: JSX.Element;
}) {
  return (
    <If when={props.open}>
      <Overlay
        style={{ position: "fixed", left: 0, top: 0, right: 0, bottom: 0 }}
        onCancel={() => props.onOpenChange?.(false)}
      >
        <View
          class="flex-1 items-center justify-center bg-black/50 p-4"
          onPress={() => props.onOpenChange?.(false)}
        >
          <View
            class={cn("max-h-full w-full max-w-3xl flex-col gap-4 rounded-2xl border border-border bg-background p-6 shadow-xl", props.className)}
            onPress={() => { /* presses inside the panel do not close it */ }}
          >
            {props.children}
          </View>
        </View>
      </Overlay>
    </If>
  );
}

export function DialogTitle(props: { className?: string; children?: JSX.Element }) {
  return <Text class={cn("text-lg font-semibold", props.className)}>{props.children}</Text>;
}

export function DialogDescription(props: { className?: string; children?: JSX.Element }) {
  return <Text class={cn("text-sm text-muted-foreground", props.className)}>{props.children}</Text>;
}