/**
 * The class-name helper. The baseline merged Tailwind classes with tw-merge;
 * NSH applies classes in order and later utilities win, so a plain join keeps
 * the call sites unchanged.
 */
export function cn(...inputs: (string | false | null | undefined)[]): string {
  return inputs.filter(Boolean).join(" ");
}