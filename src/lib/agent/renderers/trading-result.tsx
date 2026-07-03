import { View } from 'react-native';

import { Card, Text } from '@/components/ui';
import {
  BULL_BEAR_DEBATERS,
  DebateView,
  RISK_DEBATERS,
  bullBearTurns,
  namedMessageTurns,
} from '@/features/multi-agent/debate';
import { JsonBlock } from './json-block';
import { Markdown } from './markdown';
import { ReportSection, Verdict } from './widgets';

type Dict = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined;
}

/**
 * Renderer for the `trading_decision` agent — a TradingAgents-style flow that
 * produces a portfolio rating, an investment judge's verdict, analyst reports
 * (market / fundamentals / news / sentiment) and a bull-vs-bear debate.
 */
export function TradingResult({ value }: { value: unknown }) {
  if (!value || typeof value !== 'object') return <JsonBlock value={value} />;
  const v = value as Dict;
  const pd = (v.portfolio_decision ?? {}) as Dict;
  const judge = (v.investment_judge ?? {}) as Dict;
  const trader = (v.trader ?? {}) as Dict;

  const signal = str(pd.rating) ?? str(judge.signal) ?? str(trader.action);
  const conviction = typeof judge.conviction === 'number' ? judge.conviction : undefined;
  const summary = str(pd.executive_summary) ?? str(judge.summary);

  const debateTurns = bullBearTurns(v.investment_bull_responses, v.investment_bear_responses);
  const riskTurns = namedMessageTurns(v.risk_debate_messages);

  return (
    <View className="gap-3">
      <Verdict signal={signal} confidence={conviction} summary={summary} />

      {str(pd.investment_thesis) ? (
        <Card className="gap-2">
          <Text variant="label">Investment thesis</Text>
          <Markdown value={pd.investment_thesis as string} />
        </Card>
      ) : null}

      {/* Analyst reports */}
      <ReportSection title="Market / technicals" icon="markets" markdown={str(v.market_report)} />
      <ReportSection title="Fundamentals" icon="criteria" markdown={str(v.fundamentals_report)} />
      <ReportSection title="News" icon="research" markdown={str(v.news_report)} />
      <ReportSection title="Sentiment" icon="sparkle" markdown={str(v.sentiment_report)} />

      {/* Debates — rendered as actual conversations. */}
      <DebateView title="Bull vs Bear" icon="council" debaters={BULL_BEAR_DEBATERS} turns={debateTurns} />
      {str(judge.summary) && summary !== str(judge.summary) ? (
        <ReportSection title="Judge's verdict" icon="council" markdown={judge.summary as string} />
      ) : null}
      {str(trader.reasoning) ? <ReportSection title="Trader's plan" icon="evaluation" markdown={trader.reasoning as string} /> : null}
      <DebateView title="Risk debate" icon="warning" debaters={RISK_DEBATERS} turns={riskTurns} />
    </View>
  );
}
