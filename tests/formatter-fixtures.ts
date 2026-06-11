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
      repairLocatorClusters: settings.repairLocatorClusters ?? true,
      sentenceOnly: false
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

// ── sentenceOnly mode ────────────────────────────────────────────────────────

function formatSentenceOnly(rawContent: string, settings: FixtureSettings = {}, mode: 'add' | 'toggle' = 'add'): string {
  return transformNoteContent(
    rawContent,
    mode,
    createTransformNoteContentOptions({
      customProtectedRegexes: settings.customProtectedRegexes ?? [],
      enableCustomProtectedRegexes: settings.enableCustomProtectedRegexes ?? true,
      isolatePandocCitations: settings.isolatePandocCitations ?? true,
      repairLocatorClusters: settings.repairLocatorClusters ?? true,
      sentenceOnly: true
    })
  );
}

// Sentence boundary should produce a break.
const sentenceBreakAdded = formatSentenceOnly(
  'This is the first sentence, which is deliberately long enough. This is the second sentence, also long enough to qualify.'
);
assert.match(sentenceBreakAdded, /enough\.\nThis/u);

// Clause boundary (comma) should NOT produce a break in sentenceOnly mode.
const noClauseBreak = formatSentenceOnly(
  'This clause ends with a comma, but that should not cause a break here because sentence-only mode ignores clause boundaries regardless of length.'
);
assert.doesNotMatch(noClauseBreak, /comma,\n/u);

// Semicolon should NOT produce a break in sentenceOnly mode.
const noSemicolonBreak = formatSentenceOnly(
  'This clause ends with a semicolon; but that should not cause a break here because sentence-only mode only breaks at sentence terminals.'
);
assert.doesNotMatch(noSemicolonBreak, /semicolon;\n/u);

// Toggle round-trip works correctly with sentenceOnly.
const sentencePlain = 'This is the first long sentence in sentence-only mode. This is the second long sentence, also long enough to survive.';
const sentenceAdded = formatSentenceOnly(sentencePlain, { isolatePandocCitations: false }, 'toggle');
assert.notEqual(sentenceAdded, `${sentencePlain}\n`);
const sentenceRemoved = formatSentenceOnly(sentenceAdded, { isolatePandocCitations: false }, 'toggle');
assert.equal(sentenceRemoved, `${sentencePlain}\n`);

// ── YAML front matter passthrough ────────────────────────────────────────────

const yamlNote = format(
  '---\ntitle: Test\ndate: 2024-01-01\n---\n\nThis paragraph is deliberately long enough to receive semantic line breaks. This second sentence is also long enough.'
);
assert.match(yamlNote, /^---\ntitle: Test\ndate: 2024-01-01\n---\n/u);
assert.match(yamlNote, /enough\.\n/u);

// YAML body content is never modified.
const yamlOnlyNote = format('---\ntitle: Test\ndate: 2024-01-01\n---\n');
assert.match(yamlOnlyNote, /^---\ntitle: Test\ndate: 2024-01-01\n---\n/u);

// ── Fenced code block preservation ───────────────────────────────────────────

const codeBlockNote = format(
  'This paragraph is deliberately long enough to receive semantic line breaks. This second sentence is also long enough.\n\n```ts\nconst x = 1. const y = 2. const z = 3.\n```\n\nThis trailing paragraph is also deliberately long enough to receive line breaks. This second sentence too.'
);
// Code block content is never touched.
assert.match(codeBlockNote, /```ts\nconst x = 1\. const y = 2\. const z = 3\.\n```/u);
// Prose before the code block is still formatted (break at the sentence boundary).
assert.match(codeBlockNote, /receive semantic line breaks\.\nThis second sentence is also/u);
// Trailing paragraph remains on one line (lookahead "This second sentence too" is only 24 chars).
assert.match(codeBlockNote, /receive line breaks\. This second sentence too\./u);

// Unbalanced code fences return the raw content unchanged.
const unbalancedFences = format('Some prose.\n\n```ts\nunclosed fence\n');
assert.equal(unbalancedFences, 'Some prose.\n\n```ts\nunclosed fence\n');

// ── sembr-off block preservation ─────────────────────────────────────────────

const sembrOffNote = format(
  'This paragraph is deliberately long enough to receive semantic line breaks. This second sentence qualifies too.\n\n<!-- sembr-off -->\nRoses are red. Violets are blue. This stanza stays exactly as-is.\n<!-- sembr-on -->\n\nThis trailing paragraph is also deliberately long enough to receive semantic line breaks. This second sentence qualifies.'
);
// Protected region is unchanged.
assert.match(sembrOffNote, /<!-- sembr-off -->\nRoses are red\. Violets are blue\. This stanza stays exactly as-is\.\n<!-- sembr-on -->/u);
// Prose outside the protected region is formatted (each paragraph gets its own break).
assert.match(sembrOffNote, /receive semantic line breaks\.\nThis second sentence qualifies too\./u);
assert.match(sembrOffNote, /receive semantic line breaks\.\nThis second sentence qualifies\./u);

// ── Short-line skip ───────────────────────────────────────────────────────────

// Paragraphs with short lines are skipped entirely.
const shortLinePoem = format('Roses are red.\nViolets are blue.\nSugar is sweet.\nAnd so are you.');
assert.equal(shortLinePoem, 'Roses are red.\nViolets are blue.\nSugar is sweet.\nAnd so are you.\n');

// ── Non-prose skips ───────────────────────────────────────────────────────────

// Headings are never modified.
const headingContent = format(
  '## This is a heading long enough to theoretically qualify for a break.\n\nThis prose paragraph is deliberately long enough to receive semantic line breaks. Second sentence here.'
);
assert.doesNotMatch(headingContent, /heading\.\n/u);

// Lists are never modified (no break inserted inside a list item).
const listContent = format('- First list item that is deliberately long enough to theoretically qualify for a break at the end.\n- Second list item.');
// The only \n inside the first item's text is at its natural end, followed by the second list marker.
assert.match(listContent, /at the end\.\n- Second list item/u);
