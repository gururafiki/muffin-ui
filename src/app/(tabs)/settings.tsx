/**
 * Settings — schema-driven: `SECTIONS` describes every field/chip-row once and
 * the small renderers below walk it. Each field subscribes to just its own
 * store key, so typing in one field re-renders that field, not the screen.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Collapsible, Field, Screen, Text } from '@/components/ui';
import { AccountCard } from '@/features/account/account-card';
import { reinitAuth } from '@/lib/auth/store';
import { useSettings, type Settings } from '@/lib/settings/store';

type SettingKey = keyof Settings;

type ItemDef =
  | {
      kind: 'field';
      key: SettingKey;
      label: string;
      hint?: string;
      placeholder?: string;
      secure?: boolean;
      keyboard?: 'decimal-pad' | 'number-pad';
      /** Side effect after a change (e.g. rebuild the supabase client). */
      onChanged?: () => void;
    }
  | {
      kind: 'chips';
      key: SettingKey;
      label?: string;
      options: readonly string[];
      /** Extra leading chip that sets the empty value (e.g. "Server default"). */
      clearLabel?: string;
      /** Tapping the active chip clears back to the empty value. */
      toggleOff?: boolean;
    }
  | { kind: 'note'; text: string };

type SectionDef = { title: string; items: ItemDef[] };

const CONNECTION: SectionDef = {
  title: 'Connection',
  items: [
    { kind: 'field', key: 'apiUrl', label: 'API URL', hint: 'LangGraph server. Web uses the same-origin /api proxy by default.' },
    { kind: 'field', key: 'authToken', label: 'Auth token (optional)', secure: true, hint: 'Bearer / Cloudflare Access service token.' },
    { kind: 'field', key: 'userId', label: 'User ID (optional)', hint: 'Used for per-user memory isolation. Signing in overrides this.' },
    { kind: 'field', key: 'supabaseUrl', label: 'Supabase URL', onChanged: reinitAuth, hint: 'Web uses the same-origin /supabase proxy by default; native needs the full URL.' },
    { kind: 'field', key: 'supabaseAnonKey', label: 'Supabase anon key', secure: true, onChanged: reinitAuth, hint: "Public client key. Leave blank to use this deployment's default." },
  ],
};

const PROVIDER: SectionDef = {
  title: 'LLM provider',
  items: [
    { kind: 'chips', key: 'llmProvider', options: ['ollama', 'openrouter', 'openai', 'anthropic'], clearLabel: 'Server default' },
    { kind: 'note', text: '“Server default” uses this deployment’s configured model chain (e.g. Ollama Cloud → OpenRouter). Pick a provider to override it with your own key.' },
    { kind: 'field', key: 'model', label: 'Model (optional)', placeholder: 'openai/gpt-oss-120b' },
  ],
};

const KEYS: SectionDef = {
  title: 'API keys',
  items: [
    { kind: 'field', key: 'ollamaApiKey', label: 'Ollama Cloud key', secure: true },
    { kind: 'field', key: 'openrouterApiKey', label: 'OpenRouter key', secure: true },
    { kind: 'field', key: 'openaiApiKey', label: 'OpenAI key', secure: true },
    { kind: 'field', key: 'anthropicApiKey', label: 'Anthropic key', secure: true },
    { kind: 'field', key: 'openbbApiKey', label: 'OpenBB token', secure: true },
  ],
};

/** The "Advanced configuration" collapsible — one muted card per section. */
const ADVANCED: SectionDef[] = [
  {
    title: 'Model roles',
    items: [
      { kind: 'note', text: 'Per-role model chains — comma-separated (primary first, then fallbacks). Blank uses the server default.' },
      { kind: 'field', key: 'orchestratorModels', label: 'Orchestrator models', placeholder: 'openai/gpt-oss-120b, anthropic/claude-3-5-sonnet' },
      { kind: 'field', key: 'collectorModels', label: 'Collector models' },
      { kind: 'field', key: 'reasonerModels', label: 'Reasoner models' },
      { kind: 'field', key: 'summariserModel', label: 'Summariser model', placeholder: 'openai/gpt-4o-mini' },
      { kind: 'field', key: 'temperature', label: 'Temperature', keyboard: 'decimal-pad', placeholder: '0.1' },
      { kind: 'chips', key: 'toolLessonsMode', label: 'Tool lessons', options: ['read_and_record', 'read_only', 'off'], toggleOff: true },
    ],
  },
  {
    title: 'MCP servers',
    items: [
      { kind: 'field', key: 'openbbMcpUrl', label: 'OpenBB MCP URL', placeholder: 'http://127.0.0.1:8001/mcp' },
      { kind: 'field', key: 'firecrawlMcpUrl', label: 'Firecrawl MCP URL', placeholder: 'http://127.0.0.1:3000/mcp' },
    ],
  },
  {
    title: 'Research',
    items: [
      { kind: 'chips', key: 'researchDefaultMode', label: 'Default mode', options: ['speed', 'balanced', 'quality'], toggleOff: true },
      { kind: 'field', key: 'rerankThreshold', label: 'Rerank threshold', keyboard: 'decimal-pad', placeholder: '0.5' },
      { kind: 'field', key: 'maxSearchResults', label: 'Max search results', keyboard: 'number-pad', placeholder: '8' },
    ],
  },
  {
    title: 'Store access',
    items: [
      { kind: 'field', key: 'storeAllowedNamespaces', label: 'Allowed namespaces', placeholder: 'memories, tool_lessons', hint: 'Comma-separated namespace prefixes. Blank = unrestricted.' },
    ],
  },
];

/** Write one key (all Settings values are strings / string unions). */
function setSetting(key: SettingKey, value: string) {
  // The chips constrain union-typed keys to their valid options at runtime.
  useSettings.getState().setMany({ [key]: value } as Partial<Settings>);
}

function SettingField({ def, onSaved }: { def: Extract<ItemDef, { kind: 'field' }>; onSaved: () => void }) {
  const value = useSettings((s) => s[def.key]);
  return (
    <Field
      label={def.label}
      autoCapitalize="none"
      secureTextEntry={def.secure}
      keyboardType={def.keyboard}
      placeholder={def.placeholder}
      hint={def.hint}
      value={value}
      onChangeText={(v) => {
        setSetting(def.key, v);
        def.onChanged?.();
        onSaved();
      }}
    />
  );
}

function SettingChips({ def, onSaved }: { def: Extract<ItemDef, { kind: 'chips' }>; onSaved: () => void }) {
  const value = useSettings((s) => s[def.key]);
  const pick = (v: string) => {
    setSetting(def.key, v);
    onSaved();
  };
  return (
    <View className="gap-2">
      {def.label ? <Text variant="label">{def.label}</Text> : null}
      <View className="flex-row flex-wrap gap-2">
        {def.clearLabel ? <Chip label={def.clearLabel} active={value === ''} onPress={() => pick('')} /> : null}
        {def.options.map((o) => (
          <Chip
            key={o}
            label={o.replace(/_/g, ' ')}
            active={value === o}
            onPress={() => pick(def.toggleOff && value === o ? '' : o)}
          />
        ))}
      </View>
    </View>
  );
}

function SectionItems({ items, onSaved }: { items: ItemDef[]; onSaved: () => void }) {
  return (
    <>
      {items.map((item, i) =>
        item.kind === 'field' ? (
          <SettingField key={item.key} def={item} onSaved={onSaved} />
        ) : item.kind === 'chips' ? (
          <SettingChips key={item.key} def={item} onSaved={onSaved} />
        ) : (
          <Text key={`note-${i}`} variant="label">{item.text}</Text>
        ),
      )}
    </>
  );
}

export default function SettingsScreen() {
  const [saved, setSaved] = useState(false);
  const onSaved = () => setSaved(true);

  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Settings
      </Text>
      <Text variant="muted">Bring your own keys. Stored on this device only.</Text>

      <AccountCard />

      {[CONNECTION, PROVIDER, KEYS].map((section) => (
        <Card key={section.title} className="mt-4 gap-3">
          <Text variant="heading">{section.title}</Text>
          <SectionItems items={section.items} onSaved={onSaved} />
        </Card>
      ))}

      <Collapsible title="Advanced configuration" icon="settings" className="mt-4">
        {ADVANCED.map((section, i) => (
          <Card key={section.title} tone="muted" className={i === 0 ? 'gap-3' : 'mt-3 gap-3'}>
            <Text variant="heading">{section.title}</Text>
            <SectionItems items={section.items} onSaved={onSaved} />
          </Card>
        ))}
      </Collapsible>

      <View className="mt-4 flex-row items-center gap-3">
        <Button
          title="Reset to defaults"
          variant="secondary"
          onPress={() => {
            useSettings.getState().reset();
            setSaved(false);
          }}
        />
        {saved ? <Text variant="muted">Saved ✓</Text> : null}
      </View>
    </Screen>
  );
}
