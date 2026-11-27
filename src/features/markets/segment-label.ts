/**
 * A filer's own XBRL member code, made legible.
 *
 * PURE, AND IN ITS OWN MODULE FOR THAT REASON. It used to live inside `use-segments.ts`, which
 * imports react-query and the Supabase client — neither of which `tsx` can transform — so the logic
 * could not be driven offline. `money.ts` is split the same way, and for the same reason: the bug
 * this guards against is a formatting bug, and a formatting bug is exactly what a pure check is for.
 *
 * A LAST RESORT, behind `concept_name` and `member_label`. Measured across the universe, 320 of 380
 * member codes are the filer's own extension in its own namespace, so most lines land here — but a
 * code is not a name, and this only makes one readable.
 */
/** Namespaces whose members are printed text, not XBRL codes. */
const PRINTED = new Set(['cninfo', 'edinet', 'esef']);

export function memberLabel(code: string): string {
  const colon = code.indexOf(':');
  const bare = colon >= 0 ? code.slice(colon + 1) : code;
  // A NAME A READER COPIED FROM A PRINTED TABLE IS ALREADY A NAME. CNINFO, EDINET and ESEF members
  // are the row or column text of a report's own table (`cninfo:3C数码`, `edinet:自動車事業`), not an
  // XBRL code, so splitting them at a case change damages them: measured 2026-11-27, 142 of 25,521
  // CNINFO members rendered as "1.5 MW", "10 G/25 G光模块" and "3 C数码".
  if (colon >= 0 && PRINTED.has(code.slice(0, colon))) return bare.trim() || code;
  // DART NAMES A MEMBER BY ITS WHOLE PATH, AND ONLY THE HEAD IS THE NAME.
  // Korean filers use `<Name>MemberOf<Parent>MemberOf<Table>TableOfMember`, so stripping one
  // trailing `Member` — all an SEC code needs — leaves the scaffolding behind. Samsung's DX
  // division rendered on the deployed page as "Dx Division Member Of Reportable Segments Member Of
  // Disclosure Of Operating Segments Table Of". Everything from the first `MemberOf` is the path.
  const head = bare.includes('MemberOf') ? bare.slice(0, bare.indexOf('MemberOf')) : bare;
  return head
    .replace(/Member$/, '')
    .replace(/Segment$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim() || code;
}
