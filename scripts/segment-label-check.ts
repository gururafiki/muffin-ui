// `memberLabel` — offline, no credentials, no browser.
//
// WHY THIS EXISTS. Samsung's business lines rendered on the deployed page as
//
//   "Dx Division Member Of Reportable Segments Member Of Disclosure Of Operating Segments Table Of"
//
// — a 90-character machine path where a division name belongs, on all four of its segments. It was
// found by LOOKING at the page; nothing else could see it, because a label is not a number and no
// assertion in this repo read one. That is the gap this file closes.
//
// The cause is that SEC and DART name a member differently. `amzn:AmazonWebServicesSegmentMember`
// needs one trailing `Member` removed; a Korean code is a whole PATH,
// `<Name>MemberOf<Parent>MemberOf<Table>TableOfMember`, and only its head is the name. So the two
// vocabularies are asserted TOGETHER here — a rule that fixes Korea and quietly mangles the US
// would pass a Korea-only check.
import { memberLabel } from '../src/features/markets/segment-label';

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

console.log('\nDART — a member code is a path, and only its head is the name');
const DART = 'entity00126380:DxDivisionMemberOfReportableSegmentsMemberOfDisclosureOfOperatingSegmentsTableOfMember';
check('the head of the path is the name', memberLabel(DART) === 'Dx Division', memberLabel(DART));
check(
  'and none of the path survives',
  !/MemberOf|Table Of|Disclosure/i.test(memberLabel(DART)),
  memberLabel(DART),
);
check(
  'a one-word division keeps its word',
  memberLabel('entity00126380:HarmanMemberOfReportableSegmentsMemberOfDisclosureOfOperatingSegmentsTableOfMember') === 'Harman',
);
check(
  'a geography member resolves the same way',
  memberLabel('entity00164788:EuropeMemberOfForeignCountriesMemberOfDisclosureOfGeographicalAreasTableOfMember') === 'Europe',
);
check(
  'a multi-word head keeps every word',
  memberLabel('entity00164788:PartsOfAfterSalesServicesMemberOfReportableSegmentsMemberOfDisclosureOfOperatingSegmentsTableOfMember')
    === 'Parts Of After Sales Services',
);

// THE OTHER VOCABULARY, WHICH THE FIX MUST NOT TOUCH. An SEC code contains no `MemberOf`, so the
// path rule is inert for it — asserted rather than assumed, because "fix Korea" and "break the US"
// is one edit away and 320 of 380 member codes in the universe are SEC extensions.
console.log('\nSEC — unchanged by the path rule');
check('an extension member still reads as a name',
  memberLabel('amzn:AmazonWebServicesSegmentMember') === 'Amazon Web Services');
check('a standard member does too', memberLabel('us-gaap:ProductMember') === 'Product');
check('a country member is left alone', memberLabel('dart:USMember') === 'US');
check('a namespace is never part of the label', !memberLabel('amzn:AmazonWebServicesSegmentMember').includes(':'));

console.log('\ndegenerate input');
check('a code that reduces to nothing falls back to itself', memberLabel('Member') === 'Member');
check('an empty string does not throw', memberLabel('') === '');

console.log(failures === 0 ? '\nALL SEGMENT LABEL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
if (failures > 0) process.exit(1);
