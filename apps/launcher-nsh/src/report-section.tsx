import { signal, Text, View } from "nsh";
import { invoke, errorText } from "./host/invoke";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Icon } from "./ui/icons";
import { messages, type Locale } from "./i18n";
import { openReport } from "./report";

/** Reporting opens the project's own issue page, which is where a report is written and sent. */
export function ReportSection(props: { locale: Locale }) {
  const t = () => messages[props.locale];
  const busy = signal(false);
  const error = signal<string | null>(null);

  async function openLogs() {
    error.set(null);
    try {
      await invoke("open_logs");
    } catch (failure) {
      error.set(errorText(failure));
    }
  }

  async function open() {
    busy.set(true);
    error.set(null);
    try {
      await openReport();
    } catch (failure) {
      error.set(errorText(failure));
    } finally {
      busy.set(false);
    }
  }

  return <Card className="border-border shadow-none">
    <CardHeader><CardTitle>{t().reportTitle}</CardTitle></CardHeader>
    <CardContent className="space-y-2">
      <View class="flex-row flex-wrap gap-2">
        <Button disabled={busy()} onClick={() => void open()}>
          <Icon name="Bug" />
          <Text class="text-sm font-medium">{t().reportAction}</Text>
          <Icon name="ExternalLink" />
        </Button>
        <Button onClick={() => void openLogs()}>{t().logsOpen}</Button>
      </View>
      <If when={error()}>
        <Text role="alert" class="text-sm text-destructive">{error()}</Text>
      </If>
    </CardContent>
  </Card>;
}
