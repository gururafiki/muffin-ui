import { Fragment } from 'react';
import { ScrollView, useColorScheme, View } from 'react-native';

import { Text } from '@/components/ui';
import { palette } from '@/theme/colors';

/**
 * Lightweight, dependency-free syntax highlighter. A single tokeniser scans for
 * comments, strings, numbers, and a generic keyword set shared across JS/TS/
 * Python/JSON/shell — enough to make fenced code readable in chat without
 * pulling in a heavy (and RN-incompatible) highlighter library.
 */
const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'import', 'from',
  'export', 'default', 'class', 'extends', 'new', 'await', 'async', 'try', 'catch', 'finally',
  'throw', 'def', 'lambda', 'elif', 'and', 'or', 'not', 'in', 'is', 'with', 'as', 'pass', 'yield',
  'true', 'false', 'null', 'none', 'undefined', 'self', 'this', 'public', 'private', 'static',
  'void', 'int', 'str', 'bool', 'float', 'type', 'interface', 'enum',
]);

type Tok = { t: string; k: 'kw' | 'str' | 'num' | 'com' | 'txt' };

// Order matters: comments and strings first so their contents aren't re-tokenised.
const SCAN = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d[\d._]*\b)|([A-Za-z_]\w*)|(\s+|[^\w\s])/g;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  for (const m of src.matchAll(SCAN)) {
    if (m[1] != null) out.push({ t: m[1], k: 'com' });
    else if (m[2] != null) out.push({ t: m[2], k: 'str' });
    else if (m[3] != null) out.push({ t: m[3], k: 'num' });
    else if (m[4] != null) out.push({ t: m[4], k: KEYWORDS.has(m[4].toLowerCase()) ? 'kw' : 'txt' });
    else out.push({ t: m[5] ?? '', k: 'txt' });
  }
  return out;
}

export function CodeBlock({ text, language }: { text: string; language?: string }) {
  const dark = useColorScheme() === 'dark';
  const colors: Record<Tok['k'], string> = {
    kw: dark ? palette.frosting[300] : palette.frosting[600],
    str: dark ? palette.leaf[400] : palette.leaf[600],
    num: dark ? palette.butter[400] : palette.butter[600],
    com: dark ? palette.night.textMuted : '#9A8BB0',
    txt: dark ? palette.night.text : palette.ink,
  };
  const tokens = tokenize(text.replace(/\n$/, ''));

  return (
    <View className="my-1 overflow-hidden rounded-crumb border border-frosting-200 bg-frosting-50 dark:border-night-border dark:bg-night-surface-muted">
      {language ? (
        <View className="border-b border-frosting-100 px-3 py-1 dark:border-night-border">
          <Text variant="muted" className="text-[10px] uppercase tracking-wide">{language}</Text>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 10 }}>
        <Text variant="mono" className="text-xs" style={{ lineHeight: 18 }}>
          {tokens.map((tok, i) => (
            <Fragment key={i}>
              <Text variant="mono" className="text-xs" style={{ color: colors[tok.k], lineHeight: 18 }}>
                {tok.t}
              </Text>
            </Fragment>
          ))}
        </Text>
      </ScrollView>
    </View>
  );
}
