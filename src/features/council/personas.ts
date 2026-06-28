/**
 * The 13 investor personas in the council graph (muffin-agent
 * personas_council). Slugs match `agent_id` in the streamed `persona_signals`.
 * Metadata (accent icon + one-line style) is UI flavour to give each avatar
 * personality — it does not affect the agent.
 */
import type { IconName } from '@/components/icons';

export interface PersonaMeta {
  slug: string;
  name: string;
  icon: IconName;
  style: string;
}

export const COUNCIL_PERSONAS: PersonaMeta[] = [
  { slug: 'warren_buffett', name: 'Warren Buffett', icon: 'persona-buffett', style: 'Quality at a fair price' },
  { slug: 'ben_graham', name: 'Ben Graham', icon: 'persona-graham', style: 'Margin of safety' },
  { slug: 'cathie_wood', name: 'Cathie Wood', icon: 'persona-wood', style: 'Disruptive innovation' },
  { slug: 'charlie_munger', name: 'Charlie Munger', icon: 'persona-munger', style: 'Mental models, moats' },
  { slug: 'bill_ackman', name: 'Bill Ackman', icon: 'persona-ackman', style: 'Concentrated activism' },
  { slug: 'michael_burry', name: 'Michael Burry', icon: 'persona-burry', style: 'Deep-value contrarian' },
  { slug: 'mohnish_pabrai', name: 'Mohnish Pabrai', icon: 'persona-pabrai', style: 'Heads I win, tails…' },
  { slug: 'nassim_taleb', name: 'Nassim Taleb', icon: 'persona-taleb', style: 'Antifragile, tail risk' },
  { slug: 'peter_lynch', name: 'Peter Lynch', icon: 'persona-lynch', style: 'Buy what you know' },
  { slug: 'phil_fisher', name: 'Phil Fisher', icon: 'persona-fisher', style: 'Scuttlebutt growth' },
  { slug: 'rakesh_jhunjhunwala', name: 'Rakesh Jhunjhunwala', icon: 'persona-jhunjhunwala', style: 'India growth bull' },
  { slug: 'stanley_druckenmiller', name: 'Stan Druckenmiller', icon: 'persona-druckenmiller', style: 'Macro, liquidity' },
  { slug: 'aswath_damodaran', name: 'Aswath Damodaran', icon: 'persona-damodaran', style: 'Valuation, story→numbers' },
];

const BY_SLUG = new Map(COUNCIL_PERSONAS.map((p) => [p.slug, p]));

export const prettyPersona = (slug: string): string =>
  BY_SLUG.get(slug)?.name ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Normalise a streamed agent_id to a known persona slug, if possible. */
export function normalizeSlug(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return BY_SLUG.has(s) ? s : s;
}

export const getPersonaMeta = (slug: string): PersonaMeta | undefined => BY_SLUG.get(slug);
