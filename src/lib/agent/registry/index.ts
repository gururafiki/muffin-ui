/**
 * Agent registry — "one graph → one screen".
 *
 * Each entry maps a LangGraph `assistant_id` (from muffin-agent/langgraph.json)
 * to the inputs its UI collects, how to shape the run `input`, and which state
 * key carries the headline result. **Adding a new agent = adding one file next
 * to the existing five and listing it here**; the generic runner handles the
 * rest. A `custom` key opts an agent into a bespoke screen (e.g. the council
 * avatars) instead of the generic transcript view.
 */
import { council } from './council';
import { criteriaAnalysis } from './criteria-analysis';
import { research } from './research';
import { stockEvaluation } from './stock-evaluation';
import { tradingDecision } from './trading-decision';
import type { AgentDef } from './types';

export { stageOutput } from './helpers';
export type {
  AdvancedField,
  AgentDef,
  AgentInputField,
  CustomScreen,
  StageChild,
  StageDef,
  StageDetail,
} from './types';

export const AGENTS: AgentDef[] = [research, council, criteriaAnalysis, stockEvaluation, tradingDecision];

export const getAgent = (id: string): AgentDef | undefined => AGENTS.find((a) => a.id === id);
