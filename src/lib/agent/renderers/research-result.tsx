import { Linking, Pressable, View } from 'react-native';

import { Badge, Card, Text } from '@/components/ui';
import { CaveatList, ChipList, CheckList, Gauge } from './fields';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';

type ResearchOutput = {
  answer_markdown?: string;
  key_findings?: string[];
  sources?: { n?: number; title?: string; url?: string }[];
  confidence?: number;
  suggested_followups?: string[];
  missing_information?: string[];
};

/**
 * Tailored renderer for the research agent's ResearchOutput. Renders the answer
 * as markdown, plus key findings, tappable sources and a confidence badge.
 */
export function ResearchResult({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <JsonBlock value={value} />;
  const out = value as ResearchOutput;

  return (
    <Card className="gap-3">
      <View className="flex-row items-center gap-2">
        <Badge label="research" tone="info" />
        <View className="flex-1" />
        {typeof out.confidence === 'number' ? <Gauge value={out.confidence} /> : null}
      </View>

      {out.answer_markdown ? <Markdown value={out.answer_markdown} /> : null}

      {out.key_findings && out.key_findings.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Key findings</Text>
          <CheckList items={out.key_findings} />
        </View>
      ) : null}

      {/* Was dropped entirely — what the run could NOT establish is as much a part of a
          research answer as what it could. */}
      {out.missing_information && out.missing_information.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Missing information</Text>
          <CaveatList items={out.missing_information} />
        </View>
      ) : null}

      {out.sources && out.sources.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Sources</Text>
          {out.sources.map((s, i) => (
            <Pressable key={i} onPress={() => s.url && Linking.openURL(s.url)} className="active:opacity-70">
              <Text variant="muted" className="text-frosting-500">
                [{s.n ?? i + 1}] {s.title ?? s.url}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {out.suggested_followups && out.suggested_followups.length > 0 ? (
        <View className="gap-1">
          <Text variant="label">Follow-ups</Text>
          <ChipList items={out.suggested_followups} />
        </View>
      ) : null}

      {!out.answer_markdown && !out.key_findings ? <JsonBlock value={value} /> : null}
    </Card>
  );
}
