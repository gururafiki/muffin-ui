import { has, tickerField } from './helpers';
import type { AgentDef } from './types';

export const tradingDecision: AgentDef = {
  id: 'trading_decision',
  title: 'Trading Decision',
  icon: 'trading',
  tagline: 'Analyst reports → bull/bear debate → risk debate → a portfolio call.',
  inputs: [
    tickerField,
    { key: 'query', label: 'Focus (optional)', placeholder: 'Entry on a pullback?' },
    { key: 'narrative', label: 'Narrative (optional)', placeholder: 'Your current thesis / position' },
  ],
  buildInput: (v) => ({
    ticker: v.ticker?.toUpperCase(),
    ...(v.query ? { query: v.query } : {}),
    ...(v.narrative ? { narrative: v.narrative } : {}),
  }),
  exampleConfigs: [
    { label: 'AAPL', values: { ticker: 'AAPL', query: 'Entry on a pullback?' } },
    {
      label: 'NVDA',
      values: { ticker: 'NVDA', query: 'Is the AI trade still momentum-driven or due a correction?' },
    },
    {
      label: 'TSLA',
      values: {
        ticker: 'TSLA',
        narrative: 'I hold a small starter position and am deciding whether to add.',
      },
    },
  ],
  // No `resultKey`: the trading widget renders the whole state (reports,
  // debate, judge, portfolio decision), not just one field.
  resultRenderer: 'trading',
  stages: [
    { key: 'market', label: 'Market & technicals', icon: 'markets', done: (v) => has(v, 'market_report'), active: /market_analyst/i, output: 'market_report' },
    { key: 'fundamentals', label: 'Fundamentals', icon: 'criteria', done: (v) => has(v, 'fundamentals_report'), active: /fundamentals_analyst/i, output: 'fundamentals_report' },
    { key: 'news', label: 'News', icon: 'research', done: (v) => has(v, 'news_report'), active: /news_analyst/i, output: 'news_report' },
    { key: 'sentiment', label: 'Social sentiment', icon: 'sparkle', done: (v) => has(v, 'sentiment_report'), active: /social_analyst|sentiment/i, output: 'sentiment_report' },
    {
      // Both debates are real conference subgraphs (muffin-agent #117),
      // so they're discovered as sub-agent rows. Their turns live in a
      // non-default messages channel (no scoped transcript), so `output`
      // supplies the history/detail substrate and `detail: 'debate'` renders
      // it as a conversation. `?? { bull, bear }` keeps pre-migration threads
      // (legacy list channels) rendering.
      key: 'debate',
      label: 'Bull vs bear debate',
      icon: 'council',
      node: 'investment_debate',
      done: (v) => has(v, 'investment_debate_messages') || has(v, 'investment_judge'),
      active: /bull|bear|invest.*debat|research_manager/i,
      output: (v) =>
        v.investment_debate_messages ??
        (has(v, 'investment_bull_responses') || has(v, 'investment_bear_responses')
          ? { bull: v.investment_bull_responses, bear: v.investment_bear_responses }
          : undefined),
      detail: 'debate',
    },
    { key: 'judge', label: 'The judge rules', icon: 'council', done: (v) => has(v, 'investment_judge'), active: /judge/i, output: 'investment_judge' },
    { key: 'trader', label: 'Trader drafts the plan', icon: 'trading', done: (v) => has(v, 'trader'), active: /trader/i, output: 'trader' },
    { key: 'risk', label: 'Risk debate', icon: 'warning', node: 'risk_debate', done: (v) => has(v, 'risk_debate_messages') || has(v, 'portfolio_decision'), active: /risk|debator/i, output: 'risk_debate_messages', detail: 'debate' },
    { key: 'portfolio', label: 'Portfolio call', icon: 'portfolio', done: (v) => has(v, 'portfolio_decision'), active: /portfolio/i, output: 'portfolio_decision' },
  ],
  advanced: [
    { key: 'max_investment_debate_rounds', label: 'Bull/bear debate rounds', type: 'number', placeholder: '2' },
    { key: 'max_risk_debate_rounds', label: 'Risk debate rounds', type: 'number', placeholder: '1' },
    {
      key: 'reflection_enabled',
      label: 'Reflection memory',
      type: 'boolean',
      default: true,
      hint: 'Learn from past decisions on this ticker (needs a persistent store + user id).',
    },
  ],
};
