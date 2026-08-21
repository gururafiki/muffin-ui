/**
 * What the company is: a description, its size, where it is, and how it moves with the market.
 *
 * These fields came back on every `equity/profile` call this pipeline has ever made and were
 * discarded. This is the section that reads them — and until something read them, nothing could be
 * wrong with them.
 *
 * THE DESCRIPTION IS COLLAPSED BY DEFAULT. A stock page's job is the numbers; a four-hundred-word
 * business summary above them buries the thing the page is for. Collapsed, it is one line of
 * context and an affordance.
 */
import { Linking, Pressable, View } from 'react-native';

import { Card, Collapsible, Text } from '@/components/ui';

import { useSecurityProfile } from './api/use-security-profile';

/** 1,595,000 reads as noise; "1.6M employees" reads as a fact about the company. */
function formatEmployees(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return n.toLocaleString('en-US');
}

/**
 * Beta needs a sentence, not just a number. "1.45" means nothing to most readers; "more volatile
 * than the market" is the fact it encodes.
 */
function betaLabel(beta: number): string {
  if (beta <= 0) return 'moves against the market';
  if (beta < 0.8) return 'less volatile than the market';
  if (beta <= 1.2) return 'moves with the market';
  return 'more volatile than the market';
}

export function CompanyProfile({ securityId }: { securityId: string | null | undefined }) {
  const { profile, loading, empty } = useSecurityProfile(securityId);

  // NOTHING AT ALL RENDERS NOTHING. The backlog is ~12,000 deep, so most securities have no profile
  // yet and an empty card headed "About" would read as a broken page rather than as a queue.
  if (loading || empty || !profile) return null;

  const facts: string[] = [];
  if (profile.employees) facts.push(`${formatEmployees(profile.employees)} employees`);
  if (profile.location) facts.push(profile.location);

  return (
    <>
      <View className="mt-5">
        <Text variant="label">About</Text>
      </View>
      <Card tone="muted" className="mt-2 gap-2">
        {facts.length > 0 ? <Text variant="muted">{facts.join(' · ')}</Text> : null}

        {profile.beta !== null ? (
          <View className="flex-row items-baseline justify-between">
            <Text variant="muted">{`Beta ${profile.beta.toFixed(2)}`}</Text>
            <Text variant="muted">{betaLabel(profile.beta)}</Text>
          </View>
        ) : null}

        {profile.description ? (
          <Collapsible title="Business summary">
            <Text className="text-ink-muted">{profile.description}</Text>
          </Collapsible>
        ) : null}

        {profile.website ? (
          <Pressable
            onPress={() => Linking.openURL(profile.website as string)}
            accessibilityRole="link"
            accessibilityLabel={profile.website}
          >
            <Text variant="muted">{profile.website.replace(/^https?:\/\//, '')}</Text>
          </Pressable>
        ) : null}
      </Card>
    </>
  );
}
