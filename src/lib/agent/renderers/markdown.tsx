import { Fragment, useState, type ReactNode } from 'react';
import { Pressable, useColorScheme } from 'react-native';
import { Renderer, useMarkdown } from 'react-native-marked';

import { Text } from '@/components/ui';
import { BOUND, sliceAtBoundary } from '@/lib/agent/bound-text';
import { palette } from '@/theme/colors';
import { CodeBlock } from './code-block';

/** Bakery-themed renderer: route fenced code blocks through a highlighted block. */
class AppRenderer extends Renderer {
  code(text: string, language?: string): ReactNode {
    return <CodeBlock key={this.getKey()} text={text} language={language} />;
  }
}

const renderer = new AppRenderer();

/**
 * Render a markdown string with the app's theme (headings, lists, code, links).
 *
 * Bounded by DEFAULT — every caller is protected without having to remember,
 * which is the point: the ad-hoc caps this replaced guarded 3 of ~33 call sites
 * and the debate turns that took the app down were not among them. Pass
 * `bound={false}` only for authored copy whose length you control.
 */
export function Markdown({ value, bound = true }: { value: string; bound?: boolean }) {
  const [limit, setLimit] = useState(BOUND);
  const dark = useColorScheme() === 'dark';
  const text = dark ? palette.night.text : palette.ink;
  const codeBg = dark ? palette.night.surfaceMuted : palette.frosting[50];
  const border = dark ? palette.night.border : palette.frosting[200];
  const link = dark ? palette.frosting[300] : palette.frosting[600];

  // react-native-marked doesn't interpret inline HTML; models often emit <br>
  // (notably inside table cells) — turn them into spaces so they don't show raw.
  const cleaned = (value ?? '').replace(/<br\s*\/?>/gi, ' ');
  const over = bound && cleaned.length > limit;
  // Only the visible slice is parsed — the rest never becomes elements at all.
  const elements = useMarkdown(over ? sliceAtBoundary(cleaned, limit) : cleaned, {
    colorScheme: dark ? 'dark' : 'light',
    renderer,
    styles: {
      text: { color: text, fontFamily: 'Nunito_400Regular', fontSize: 15 },
      paragraph: { paddingVertical: 4, marginTop: 0, marginBottom: 0 },
      strong: { color: text, fontFamily: 'Nunito_700Bold' },
      em: { color: text, fontStyle: 'italic' },
      link: { color: link, textDecorationLine: 'underline' },
      blockquote: { borderLeftColor: border, borderLeftWidth: 3, paddingLeft: 10, opacity: 0.9 },
      h1: { color: text, fontFamily: 'Baloo2_700Bold', fontSize: 22, marginTop: 8 },
      h2: { color: text, fontFamily: 'Baloo2_700Bold', fontSize: 19, marginTop: 6 },
      h3: { color: text, fontFamily: 'Baloo2_600SemiBold', fontSize: 17, marginTop: 4 },
      h4: { color: text, fontFamily: 'Baloo2_600SemiBold', fontSize: 15 },
      li: { color: text, fontFamily: 'Nunito_400Regular', fontSize: 15 },
      codespan: {
        color: dark ? palette.frosting[300] : palette.frosting[700],
        backgroundColor: codeBg,
        fontFamily: 'monospace',
        fontSize: 13,
      },
      hr: { backgroundColor: border },
    },
  });

  return (
    <Fragment>
      {elements}
      {over ? (
        <Pressable
          onPress={() => setLimit((n) => n + BOUND)}
          accessibilityRole="button"
          accessibilityLabel={`Show more, ${Math.round(limit / 1000)} of ${Math.round(cleaned.length / 1000)} thousand characters shown`}
          className="self-start py-1 active:opacity-70">
          <Text variant="muted" className="text-[11px] text-frosting-500">
            {`Show more — ${Math.round(limit / 1000)}k of ${Math.round(cleaned.length / 1000)}k shown`}
          </Text>
        </Pressable>
      ) : null}
    </Fragment>
  );
}
