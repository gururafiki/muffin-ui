/**
 * Council member metadata — the 13 investor personas plus the 6 optional
 * specialists (muffin-agent personas_council). Slugs match `agent_id` in the
 * streamed `persona_signals`; every member emits the same AnalystSignal
 * contract, so the arena renders them uniformly. Metadata (accent icon +
 * one-line style + inner-step labels) is UI flavour — it does not affect the
 * agent.
 */
import type { IconName } from '@/components/icons';

export type MemberStep = { key: string; label: string };

export interface PersonaMeta {
  slug: string;
  name: string;
  icon: IconName;
  style: string;
  kind: 'persona' | 'specialist';
  /** Inner subgraph steps in execution order — drives the detail timeline. */
  steps: MemberStep[];
}

/** Every persona shares the same 3-node subgraph shape. */
const PERSONA_STEPS: MemberStep[] = [
  { key: 'collect_data', label: 'Collect data' },
  { key: 'compute_evidence', label: 'Compute evidence' },
  { key: 'render_verdict', label: 'Render verdict' },
];

const PERSONAS_BASE: Omit<PersonaMeta, 'kind' | 'steps'>[] = [
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

export const COUNCIL_PERSONAS: PersonaMeta[] = PERSONAS_BASE.map((p) => ({
  ...p,
  kind: 'persona',
  steps: PERSONA_STEPS,
}));

/**
 * The six optional specialists (`configurable.include_specialists` — all six
 * or none). technicals/sentiment are fully deterministic 2-node subgraphs;
 * the rest run a ReAct collect step before the deterministic compute.
 */
export const COUNCIL_SPECIALISTS: PersonaMeta[] = [
  {
    slug: 'technicals', name: 'Technicals', icon: 'specialist-technicals',
    style: '5-strategy price ensemble', kind: 'specialist',
    steps: [{ key: 'fetch_ohlcv', label: 'Fetch OHLCV' }, { key: 'compute', label: 'Compute signal' }],
  },
  {
    slug: 'sentiment', name: 'Sentiment', icon: 'specialist-sentiment',
    style: 'Insider + news mood', kind: 'specialist',
    steps: [{ key: 'fetch', label: 'Fetch insiders & news' }, { key: 'compute', label: 'Compute signal' }],
  },
  {
    slug: 'fundamentals', name: 'Fundamentals', icon: 'specialist-fundamentals',
    style: '4-dimension health vote', kind: 'specialist',
    steps: [{ key: 'collect_data', label: 'Collect data' }, { key: 'compute', label: 'Compute signal' }],
  },
  {
    slug: 'growth', name: 'Growth', icon: 'specialist-growth',
    style: 'Weighted growth score', kind: 'specialist',
    steps: [{ key: 'collect_data', label: 'Collect data' }, { key: 'compute', label: 'Compute signal' }],
  },
  {
    slug: 'valuation', name: 'Valuation', icon: 'specialist-valuation',
    style: '4-method intrinsic value', kind: 'specialist',
    steps: [{ key: 'collect_data', label: 'Collect data' }, { key: 'compute', label: 'Compute signal' }],
  },
  {
    slug: 'news_sentiment', name: 'News Sentiment', icon: 'specialist-news',
    style: 'LLM headline read', kind: 'specialist',
    steps: [{ key: 'collect_data', label: 'Collect data' }, { key: 'aggregate', label: 'Aggregate sentiment' }],
  },
];

export const COUNCIL_MEMBERS: PersonaMeta[] = [...COUNCIL_PERSONAS, ...COUNCIL_SPECIALISTS];

const BY_SLUG = new Map(COUNCIL_MEMBERS.map((p) => [p.slug, p]));

export const MEMBER_SLUGS: ReadonlySet<string> = new Set(BY_SLUG.keys());
export const SPECIALIST_SLUGS: ReadonlySet<string> = new Set(
  COUNCIL_SPECIALISTS.map((s) => s.slug),
);

export const prettyPersona = (slug: string): string =>
  BY_SLUG.get(slug)?.name ?? slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Normalise a streamed agent_id to a known member slug, if possible. */
export function normalizeSlug(raw: string | undefined): string {
  if (!raw) return '';
  const s = raw.toLowerCase().replace(/[\s-]+/g, '_');
  return BY_SLUG.has(s) ? s : s;
}

/**
 * `tool_runs` records carry `agent` = the collect_data builder's name
 * (`<slug>_data_collection` for every persona AND ReAct specialist) — strip
 * the suffix to join records to their council member.
 */
export const toolRunAgentSlug = (agent: string | undefined): string =>
  normalizeSlug((agent ?? '').replace(/_data_collection$/, ''));

export const getPersonaMeta = (slug: string): PersonaMeta | undefined => BY_SLUG.get(slug);
