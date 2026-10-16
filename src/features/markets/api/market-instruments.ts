/**
 * The `market.instruments` schema (05-market-instruments.sql).
 *
 * This is the CURATED 35-row universe. The sector page has moved to `market.sector_constituents`
 * — securities a sector SPDR actually holds, from its SEC filing — so the remaining readers are
 * the asset-universe list and the single-instrument stock page, both of which still want the
 * hand-authored `asset_type` / `industry` / `market_cap` this table carries and the fund-derived
 * model does not.
 *
 * The schema lives in its own module so those two readers do not have to import it through a hook
 * that no longer uses it.
 */
import { z } from 'zod';

export const zInstrument = z.looseObject({
  symbol: z.string(),
  name: z.string().nullish(),
  sector_id: z.string().nullish(),
  provider_sector: z.string().nullish(),
  industry: z.string().nullish(),
  country: z.string().nullish(),
  // The ISO, which is what ROUTES — `/country/[countryId]` is keyed on the registry id, looked up
  // from this. The display name alone left the stock page's country badge a dead end.
  countryIso: z.string().nullish(),
  // The only STABLE key. Migration 39 changed the display symbol for 41% of non-US securities, so
  // anything joined on symbol needed re-keying by hand while anything joined on this needed
  // nothing. `security_funds` is keyed on it.
  securityId: z.string().nullish(),
  asset_type: z.string().nullish(),
  priced: z.boolean().nullish(),
  price_symbol: z.string().nullish(),
  // Written by `instrument-profile` from yfinance. It is what labels `market_cap` — NESN's is in
  // CHF, and an unlabelled figure defaults to reading as dollars.
  currency: z.string().nullish(),
  // The currency the LISTING trades in, from the price lane's newest bar, which carries the
  // currency Yahoo states for that line. Pence, agorot and fils are codes of their own (GBX, ILA,
  // KWF), so a London price is never read as pounds. It labels the price and a dividend.
  quoteCurrency: z.string().nullish(),
  // The currency `market_cap` is in, chosen by the view (a fundamentals cap states its own; the
  // legacy column falls back to the security's). Read, never re-derived here.
  marketCapCurrency: z.string().nullish(),
  // `z.coerce` is a driver guard: PostgREST sends `numeric` as a JSON number today, but a version
  // that quoted it would make every row fail to parse and silently empty the list.
  market_cap: z.coerce.number().nullish(),
  sort_order: z.coerce.number().nullish(),
});
export type Instrument = z.infer<typeof zInstrument>;
