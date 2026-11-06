import { View } from "nsh";
import { cn } from "../lib";

/**
 * The launcher's dotted sign: cyan dots on the left, purple on the right.
 * The baseline traveled a bump along the row; here the dots pulse in place
 * with staggered animation, which NSH runs natively.
 */
export function JouzuLoader(props: { className?: string; small?: boolean }) {
  return (
    <View class={cn("flex-row items-center", props.small ? "gap-1" : "gap-2", props.className)}>
      <View class={cn(props.small ? "size-1.5" : "size-2.5", "rounded-full bg-[#22d3ee] animate-pulse")} />
      <View class={cn(props.small ? "size-1.5" : "size-2.5", "rounded-full bg-[#39c8e8] animate-pulse")} style={{ animationDelay: "150ms" }} />
      <View class={cn(props.small ? "size-1.5" : "size-2.5", "rounded-full bg-[#ae92c9] animate-pulse")} style={{ animationDelay: "300ms" }} />
      <View class={cn(props.small ? "size-1.5" : "size-2.5", "rounded-full bg-[#c588c2] animate-pulse")} style={{ animationDelay: "450ms" }} />
    </View>
  );
}