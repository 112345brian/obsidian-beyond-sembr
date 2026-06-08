import assert from 'node:assert/strict';

import {
  createTransformNoteContentOptions,
  transformNoteContent
} from '../src/Formatter.ts';

interface FixtureSettings {
  readonly customProtectedRegexes?: readonly string[];
  readonly enableCustomProtectedRegexes?: boolean;
  readonly isolatePandocCitations?: boolean;
  readonly repairLocatorClusters?: boolean;
}

function format(rawContent: string, settings: FixtureSettings = {}, mode: 'add' | 'toggle' = 'add'): string {
  return transformNoteContent(
    rawContent,
    mode,
    createTransformNoteContentOptions({
      customProtectedRegexes: settings.customProtectedRegexes ?? [],
      enableCustomProtectedRegexes: settings.enableCustomProtectedRegexes ?? true,
      isolatePandocCitations: settings.isolatePandocCitations ?? true,
      repairLocatorClusters: settings.repairLocatorClusters ?? true
    })
  );
}

const locatorReference = format(
  'This sentence carries a compact page reference Pg. 193 A51/B75 while continuing into enough additional prose for the formatter to consider a semantic line break.'
);
assert.doesNotMatch(locatorReference, /Pg\.\n/u);
assert.doesNotMatch(locatorReference, /\n193 A51\/B75/u);

const bracketedCitation = format(
  'This sentence carries a compact page reference [@key, Pg. 193 A51/B75] while continuing into enough additional prose for the formatter to consider a semantic line break.'
);
assert.match(bracketedCitation, /\[@key, Pg\. 193 A51\/B75\]/u);
assert.doesNotMatch(bracketedCitation, /Pg\.\n/u);
assert.doesNotMatch(bracketedCitation, /\n193 A51\/B75/u);

const repairedLocator = format('This sentence carries a compact page reference Pg.\n193 A51/B75 and should be repaired.');
assert.match(repairedLocator, /Pg\. 193 A51\/B75/u);

const locatorWithRepairDisabled = format(
  'This sentence carries a compact page reference Pg.\n193 A51/B75 and should remain split when repair is disabled.',
  { repairLocatorClusters: false }
);
assert.match(locatorWithRepairDisabled, /Pg\.\n193 A51\/B75/u);

const separateLocatorLikeLine = format('This sentence ends cleanly.\nA51/B75 starts a separate note line.');
assert.match(separateLocatorLikeLine, /cleanly\.\nA51\/B75/u);

const customProtected = format(
  'This paragraph protects KEEP{Alpha. Beta. Gamma.} while continuing into enough additional prose for the formatter to consider a semantic line break.',
  { customProtectedRegexes: ['KEEP\\{[^}]+\\}'] }
);
assert.match(customProtected, /KEEP\{Alpha\. Beta\. Gamma\.\}/u);
assert.doesNotMatch(customProtected, /KEEP\{Alpha\.\n/u);

const customProtectionDisabled = format(
  'This paragraph protects KEEP{Alpha. Beta. Gamma.} while continuing into enough additional prose for the formatter to consider a semantic line break.',
  {
    customProtectedRegexes: ['KEEP\\{[^}]+\\}'],
    enableCustomProtectedRegexes: false
  }
);
assert.match(customProtectionDisabled, /KEEP\{Alpha\./u);

assert.doesNotThrow(() => {
  format(
    'This paragraph includes enough prose that an invalid custom regex should be ignored without disrupting formatting.',
    { customProtectedRegexes: ['/[unterminated/u', '.*'] }
  );
});

const isolatedCitation = format(
  'This sentence is intentionally long enough to trigger citation isolation at the end [@smith2020].'
);
assert.match(isolatedCitation, /\.\n\[@smith2020\]/u);

const flowingCitation = format(
  'This sentence is intentionally long enough to keep citation isolation disabled at the end [@smith2020].',
  { isolatePandocCitations: false }
);
assert.match(flowingCitation, /\[@smith2020\]\./u);
assert.doesNotMatch(flowingCitation, /\n\[@smith2020\]/u);

const plainParagraph =
  'This paragraph is deliberately long enough to receive semantic line breaks. This second sentence is also long enough to survive the round trip.';
const added = format(plainParagraph, { isolatePandocCitations: false }, 'toggle');
assert.notEqual(added, `${plainParagraph}\n`);
const removed = format(added, { isolatePandocCitations: false }, 'toggle');
assert.equal(removed, `${plainParagraph}\n`);
