import { View } from 'react-native';

import { Card, Collapsible } from '@/components/ui';
import {
  DebateView,
  bullBearTurns,
  debatersForTurns,
  namedMessageTurns,
} from '@/features/multi-agent/debate';
import { DecisionTicketCard, JudgeCard, TradePlanCard } from './cards';
import { JsonBlock } from './json-block';
import { ReportSection, Verdict } from './widgets';

type Dict = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/** A card already summarised above, folded away so it is available without repeating. */
function Folded({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card tone="muted">
      <Collapsible title={title} icon="council">
        {children}
      </Collapsible>
    </Card>
  );
}

/**
 * Renderer for the `trading_decision` agent — analyst reports → bull/bear debate → risk
 * debate → a portfolio call.
 *
 * The three structured payloads (portfolio decision, judge verdict, trader plan) render
 * through the SAME cards the timeline uses, so the two views cannot drift. This file
 * used to hand-roll one `Verdict` over `executive_summary` and drop everything else the
 * schemas carry — the price target, stop, horizon, sizing and accepted risks; the
 * judge's bull/bear cases, catalysts, risks and monitoring checklist; the trader's
 * entry/stop/take-profit levels. What remains here is the genuinely Overview-specific
 * composition: the four analyst reports and the two debates, in reading order.
 *
 * Cards are called as plain functions so a `null` (a payload that never arrived, or one
 * that does not match) can be detected and fallen through — see the note on
 * `CHANNEL_RENDERERS`.
 */
export function TradingResult({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <JsonBlock value={value} />;
  const v = value as Dict;
  const pd = (v.portfolio_decision ?? {}) as Dict;
  const judge = (v.investment_judge ?? {}) as Dict;
  const trader = (v.trader ?? {}) as Dict;

  const decision = DecisionTicketCard({ value: pd });
  const judgement = JudgeCard({ value: judge });
  const plan = TradePlanCard({ value: trader });

  // Bull/Bear debate: prefer the conference message list (muffin-agent #117), fall back
  // to the legacy per-speaker lists for pre-migration threads.
  const debateTurns = Array.isArray(v.investment_debate_messages)
    ? namedMessageTurns(v.investment_debate_messages)
    : bullBearTurns(v.investment_bull_responses, v.investment_bear_responses);
  const riskTurns = namedMessageTurns(v.risk_debate_messages);

  return (
    <View className="gap-3">
      {/* A run that stopped before the portfolio manager still has a directional view
          from the judge or the trader — fall back rather than showing nothing. */}
      {decision ??
        judgement ?? (
          <Verdict
            signal={str(pd.rating) ?? str(judge.signal) ?? str(trader.action)}
            confidence={typeof judge.conviction === 'number' ? judge.conviction : undefined}
            summary={str(pd.executive_summary) ?? str(judge.summary)}
          />
        )}

      <ReportSection title="Market / technicals" icon="markets" markdown={str(v.market_report)} />
      <ReportSection title="Fundamentals" icon="criteria" markdown={str(v.fundamentals_report)} />
      <ReportSection title="News" icon="research" markdown={str(v.news_report)} />
      <ReportSection title="Sentiment" icon="sparkle" markdown={str(v.sentiment_report)} />

      <DebateView title="Bull vs Bear" icon="council" debaters={debatersForTurns(debateTurns)} turns={debateTurns} />
      {decision && judgement ? <Folded title="Judge's verdict">{judgement}</Folded> : null}
      {plan ? <Folded title="Trader's plan">{plan}</Folded> : null}
      <DebateView title="Risk debate" icon="warning" debaters={debatersForTurns(riskTurns)} turns={riskTurns} />
    </View>
  );
}
