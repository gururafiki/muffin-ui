import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, Chip, Collapsible, Field, Screen, Text } from '@/components/ui';
import { AccountCard } from '@/features/account/account-card';
import { reinitAuth } from '@/lib/auth/store';
import {
  DEFAULT_SETTINGS,
  useSettings,
  type LlmProvider,
  type ResearchMode,
} from '@/lib/settings/store';

const PROVIDERS: LlmProvider[] = ['openrouter', 'openai', 'anthropic'];
const RESEARCH_MODES: Exclude<ResearchMode, ''>[] = ['speed', 'balanced', 'quality'];

export default function SettingsScreen() {
  const settings = useSettings();
  const [saved, setSaved] = useState(false);

  const update = (patch: Parameters<typeof settings.setMany>[0]) => {
    settings.setMany(patch);
    setSaved(true);
  };

  return (
    <Screen>
      <Text variant="title" className="pt-4">
        Settings
      </Text>
      <Text variant="muted">Bring your own keys. Stored on this device only.</Text>

      <AccountCard />

      <Card className="mt-4 gap-3">
        <Text variant="heading">Connection</Text>
        <Field
          label="API URL"
          autoCapitalize="none"
          value={settings.apiUrl}
          onChangeText={(v) => update({ apiUrl: v })}
          hint="LangGraph server. Web uses the same-origin /api proxy by default."
        />
        <Field
          label="Auth token (optional)"
          autoCapitalize="none"
          secureTextEntry
          value={settings.authToken}
          onChangeText={(v) => update({ authToken: v })}
          hint="Bearer / Cloudflare Access service token."
        />
        <Field
          label="User ID (optional)"
          autoCapitalize="none"
          value={settings.userId}
          onChangeText={(v) => update({ userId: v })}
          hint="Used for per-user memory isolation. Signing in overrides this."
        />
        <Field
          label="Supabase URL"
          autoCapitalize="none"
          value={settings.supabaseUrl}
          onChangeText={(v) => {
            update({ supabaseUrl: v });
            reinitAuth();
          }}
          hint="Web uses the same-origin /supabase proxy by default; native needs the full URL."
        />
        <Field
          label="Supabase anon key"
          autoCapitalize="none"
          secureTextEntry
          value={settings.supabaseAnonKey}
          onChangeText={(v) => {
            update({ supabaseAnonKey: v });
            reinitAuth();
          }}
          hint="Public client key. Leave blank to use this deployment's default."
        />
      </Card>

      <Card className="mt-4 gap-3">
        <Text variant="heading">LLM provider</Text>
        <View className="flex-row flex-wrap gap-2">
          {PROVIDERS.map((p) => (
            <Chip
              key={p}
              label={p}
              active={settings.llmProvider === p}
              onPress={() => update({ llmProvider: p })}
            />
          ))}
        </View>
        <Field
          label="Model (optional)"
          autoCapitalize="none"
          placeholder="openai/gpt-oss-120b"
          value={settings.model}
          onChangeText={(v) => update({ model: v })}
        />
      </Card>

      <Card className="mt-4 gap-3">
        <Text variant="heading">API keys</Text>
        <Field
          label="OpenRouter key"
          autoCapitalize="none"
          secureTextEntry
          value={settings.openrouterApiKey}
          onChangeText={(v) => update({ openrouterApiKey: v })}
        />
        <Field
          label="OpenAI key"
          autoCapitalize="none"
          secureTextEntry
          value={settings.openaiApiKey}
          onChangeText={(v) => update({ openaiApiKey: v })}
        />
        <Field
          label="Anthropic key"
          autoCapitalize="none"
          secureTextEntry
          value={settings.anthropicApiKey}
          onChangeText={(v) => update({ anthropicApiKey: v })}
        />
        <Field
          label="OpenBB token"
          autoCapitalize="none"
          secureTextEntry
          value={settings.openbbApiKey}
          onChangeText={(v) => update({ openbbApiKey: v })}
        />
      </Card>

      <Collapsible title="Advanced configuration" icon="settings" className="mt-4">
        <Card tone="muted" className="gap-3">
          <Text variant="heading">Model roles</Text>
          <Text variant="muted">
            Per-role model chains — comma-separated (primary first, then fallbacks). Blank uses the
            server default.
          </Text>
          <Field
            label="Orchestrator models"
            autoCapitalize="none"
            placeholder="openai/gpt-oss-120b, anthropic/claude-3-5-sonnet"
            value={settings.orchestratorModels}
            onChangeText={(v) => update({ orchestratorModels: v })}
          />
          <Field
            label="Collector models"
            autoCapitalize="none"
            value={settings.collectorModels}
            onChangeText={(v) => update({ collectorModels: v })}
          />
          <Field
            label="Reasoner models"
            autoCapitalize="none"
            value={settings.reasonerModels}
            onChangeText={(v) => update({ reasonerModels: v })}
          />
          <Field
            label="Summariser model"
            autoCapitalize="none"
            placeholder="openai/gpt-4o-mini"
            value={settings.summariserModel}
            onChangeText={(v) => update({ summariserModel: v })}
          />
          <Field
            label="Temperature"
            keyboardType="decimal-pad"
            placeholder="0.1"
            value={settings.temperature}
            onChangeText={(v) => update({ temperature: v })}
          />
        </Card>

        <Card tone="muted" className="mt-3 gap-3">
          <Text variant="heading">MCP servers</Text>
          <Field
            label="OpenBB MCP URL"
            autoCapitalize="none"
            placeholder="http://127.0.0.1:8001/mcp"
            value={settings.openbbMcpUrl}
            onChangeText={(v) => update({ openbbMcpUrl: v })}
          />
          <Field
            label="Firecrawl MCP URL"
            autoCapitalize="none"
            placeholder="http://127.0.0.1:3000/mcp"
            value={settings.firecrawlMcpUrl}
            onChangeText={(v) => update({ firecrawlMcpUrl: v })}
          />
        </Card>

        <Card tone="muted" className="mt-3 gap-3">
          <Text variant="heading">Research</Text>
          <Text variant="label">Default mode</Text>
          <View className="flex-row flex-wrap gap-2">
            {RESEARCH_MODES.map((m) => (
              <Chip
                key={m}
                label={m}
                active={settings.researchDefaultMode === m}
                onPress={() =>
                  update({ researchDefaultMode: settings.researchDefaultMode === m ? '' : m })
                }
              />
            ))}
          </View>
          <Field
            label="Rerank threshold"
            keyboardType="decimal-pad"
            placeholder="0.5"
            value={settings.rerankThreshold}
            onChangeText={(v) => update({ rerankThreshold: v })}
          />
          <Field
            label="Max search results"
            keyboardType="number-pad"
            placeholder="8"
            value={settings.maxSearchResults}
            onChangeText={(v) => update({ maxSearchResults: v })}
          />
        </Card>

        <Card tone="muted" className="mt-3 gap-3">
          <Text variant="heading">Store access</Text>
          <Field
            label="Allowed namespaces"
            autoCapitalize="none"
            placeholder="memories, tool_lessons"
            hint="Comma-separated namespace prefixes. Blank = unrestricted."
            value={settings.storeAllowedNamespaces}
            onChangeText={(v) => update({ storeAllowedNamespaces: v })}
          />
        </Card>
      </Collapsible>

      <View className="mt-4 flex-row items-center gap-3">
        <Button
          title="Reset to defaults"
          variant="secondary"
          onPress={() => {
            settings.reset();
            settings.setMany(DEFAULT_SETTINGS);
            setSaved(false);
          }}
        />
        {saved ? <Text variant="muted">Saved ✓</Text> : null}
      </View>
    </Screen>
  );
}
