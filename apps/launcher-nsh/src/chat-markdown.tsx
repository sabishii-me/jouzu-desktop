import { View, Text, signal } from "nsh";
import { TextView } from "nsh/base";
import { invoke } from "./host/invoke";
import { MessageImage } from "./message-image";

/**
 * The transcript's markdown. NSH's TextView renders CommonMark + GFM natively
 * (tables, task lists, code blocks with a built-in copy action), so the
 * react-markdown pipeline collapses into one component. The link policy is
 * the baseline's: only ordinary http(s) URLs without credentials open.
 */
export function ChatMarkdown(props: { text: string; streaming?: boolean }) {
  const error = signal<string | null>(null);

  const openLink = (href: string) => {
    let safe: string | undefined;
    try {
      const url = new URL(href);
      if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) safe = url.href;
    } catch { /* Leave the link inert. */ }
    if (!safe) {
      error.set("This link cannot be opened externally.");
      return;
    }
    void invoke("open_external_url", { url: safe }).catch(() => error.set("Could not open link."));
  };

  return (
    <View class="flex-col text-left">
      <TextView
        markdown={props.text}
        selectable
        links="report"
        options={{ streaming: props.streaming === true }}
        class="text-sm"
        classes={{ link: "text-primary underline" }}
        codeBlockActions={[{ id: "copy", label: "Copy code" }]}
        onLinkPress={event => openLink(event.url)}
        renderImage={image => <MessageImage kind="markdown" source={image.src} alt={image.alt ?? ""} />}
      />
      <If when={error()}>
        <Text class="text-sm text-destructive">{error()}</Text>
      </If>
    </View>
  );
}