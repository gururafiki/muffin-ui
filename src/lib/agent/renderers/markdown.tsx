import { Fragment, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { Renderer, useMarkdown } from 'react-native-marked';

import { palette } from '@/theme/colors';
import { CodeBlock } from './code-block';

/** Bakery-themed renderer: route fenced code blocks through a highlighted block. */
class AppRenderer extends Renderer {
  code(text: string, language?: string): ReactNode {
    return <CodeBlock key={this.getKey()} text={text} language={language} />;
  }
}

const renderer = new AppRenderer();

/** Render a markdown string with the app's theme (headings, lists, code, links). */
export function Markdown({ value }: { value: string }) {
  const dark = useColorScheme() === 'dark';
  const text = dark ? palette.night.text : palette.ink;
  const codeBg = dark ? palette.night.surfaceMuted : palette.frosting[50];
  const border = dark ? palette.night.border : palette.frosting[200];
  const link = dark ? palette.frosting[300] : palette.frosting[600];

  // react-native-marked doesn't interpret inline HTML; models often emit <br>
  // (notably inside table cells) — turn them into spaces so they don't show raw.
  const cleaned = (value ?? '').replace(/<br\s*\/?>/gi, ' ');
  const elements = useMarkdown(cleaned, {
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

  return <Fragment>{elements}</Fragment>;
}
