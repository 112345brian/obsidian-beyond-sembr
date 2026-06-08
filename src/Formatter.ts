import type { Text } from '@codemirror/state';

const HEADING_LINE_REGEX = /^#{1,6}\s/u;
const UNORDERED_LIST_LINE_REGEX = /^[-*+]\s/u;
const ORDERED_LIST_LINE_REGEX = /^\d+\.\s/u;
const HORIZONTAL_RULE_REGEX = /^(?:---|\*\*\*|___)\s*$/u;

const SEMBR_REMOVE_REGEX = /(?<punc>[.,:;?!…]) ?\n(?!\n)/gmu;
const SEMBR_CLAUSE_REGEX = /(?<clause>[^|.\n]{25,}?[^:][.,:;?!…](?<trailingSpace> ))(?!\n\n| |.*\|.*$|p\. [1-9-]+\]|@|\d)(?=[^|.\n]{25,})/gmu;
const SEMBR_SENTENCE_CLAUSE_REGEX = /(?<clause>[^|.\n]{25,}?[^:][.?!…](?<trailingSpace> ))(?!\n\n| |.*\|.*$|p\. [1-9-]+\]|@|\d)(?=[^|.\n]{25,})/gmu;
const ET_AL_REGEX = /\bet al\. $/u;
const FOOTNOTE_REGEX = /\n\[\^.*?(?=\[\n\^|\n\n|$)/gsu;
const SEMBR_LINE_REGEX = /[.,:;?!…] ?$/u;
const SEMBR_SENTENCE_LINE_REGEX = /[.?!…] ?$/u;
const EM_DASH_SOFT_BREAK_REGEX = /—\n(?!\n)/gu;

const URL_REGEX = /https?:\/\/\S+/gu;
const INLINE_CODE_REGEX = /`[^`\n]+`/gu;
const BRACKETED_PANDOC_CITATION_REGEX = /\[[^\]\n]*@[^\]\n]*\]/gu;
const PANDOC_CITATION_REGEX = /-?@[\p{Letter}\p{Number}_:.#$%&\-+?<>~/]+|\[[^\]\n]*@[^\]\n]*\]/gu;
const LOCATOR_CLUSTER_REGEX =
  /(?<![\p{Letter}\p{Number}_])(?:(?:p|pp|Pg|ch|para)\. ?\d+(?:[-–]\d+)?(?:\s+[A-Z]\d+(?:\/[A-Z]?\d+|[-–][A-Z]?\d+)?)?|§ ?\d+|[A-Z]\d+(?:\/[A-Z]?\d+|[-–][A-Z]?\d+))(?![\p{Letter}\p{Number}_])/gu;
const SEMBR_OFF_BLOCK_REGEX = /<!--\s*sembr-off\s*-->.*?<!--\s*sembr-on\s*-->/gsu;

const YAML_HEADER_REGEX = /^---\n(?<body>.*?)---\n+/su;
const PARAGRAPH_SPLIT_REGEX = /\n{2,}/u;
const CODE_BLOCK_DELIMITER = '```';
const TRAILING_NEWLINES_REGEX = /\n+$/u;
const CODE_BLOCK_MODULO = 2;
const URL_PLACEHOLDER_REGEX = /SEMBR_URL_(?<idx>\d+)/gu;
const CODE_PLACEHOLDER_REGEX = /SEMBR_CODE_(?<idx>\d+)/gu;
const CITATION_PLACEHOLDER_REGEX = /SEMBR_CITATION_(?<idx>\d+)/gu;
const CUSTOM_PLACEHOLDER_REGEX = /SEMBR_CUSTOM_(?<idx>\d+)/gu;
const LOCATOR_PLACEHOLDER_REGEX = /SEMBR_LOCATOR_(?<idx>\d+)/gu;
const SEMBR_OFF_PLACEHOLDER_REGEX = /SEMBR_OFF_(?<idx>\d+)/gu;
const CITATION_LINE_BREAK_REGEX = /(?<citation>\[[^\]\n]*@[^\]\n]*\])\n(?!\n)/gu;
const LOCATOR_CONTINUATION_LINE_REGEX =
  /^(?:\d+(?:[-–]\d+)?\s+[A-Z]\d+(?:\/[A-Z]?\d+|[-–][A-Z]?\d+)?|[A-Z]\d+(?:\/[A-Z]?\d+|[-–][A-Z]?\d+)|§ ?\d+|ch\. ?\d+\]?)(?:\s|$)/u;
const LOCATOR_PREFIX_LINE_END_REGEX = /\b(?:p|pp|Pg|ch|para)\.$|§$/u;
const SENTENCE_TERMINAL_LINE_END_REGEX = /[.!?]\]?$/u;
const SENTENCE_FINAL_CITATION_REGEX = /(?<sentencePunc>[.!?])? ?(?<citation>\[[^\]\n]*@[^\]\n]*\])(?<citationPunc>[.!?])?(?= |$)/gu;
const SEMBR_MIN_LINE_LENGTH = 25;

export type SemBrTransformMode = 'add' | 'toggle';
export interface SemBrTransformSettings {
  readonly customProtectedRegexes: readonly string[];
  readonly enableCustomProtectedRegexes: boolean;
  readonly isolatePandocCitations: boolean;
  readonly repairLocatorClusters: boolean;
  readonly sentenceOnly: boolean;
}
export interface TransformNoteContentOptions {
  readonly customProtectedRegexes: readonly RegExp[];
  readonly isolatePandocCitations: boolean;
  readonly repairLocatorClusters: boolean;
  readonly sentenceOnly: boolean;
}
type ParagraphSemBrState = 'add' | 'remove' | 'skip';
interface ParsedCustomRegexLiteral {
  readonly flags: string;
  readonly source: string;
}

export function createTransformNoteContentOptions(settings: SemBrTransformSettings): TransformNoteContentOptions {
  return {
    customProtectedRegexes: settings.enableCustomProtectedRegexes
      ? compileCustomProtectedRegexes(settings.customProtectedRegexes)
      : [],
    isolatePandocCitations: settings.isolatePandocCitations,
    repairLocatorClusters: settings.repairLocatorClusters,
    sentenceOnly: settings.sentenceOnly
  };
}

export function shouldCollapseNewline(lineText: string, lineNumber: number, doc: Text): boolean {
  if (lineNumber >= doc.lines) {
    return false;
  }
  if (lineText === '') {
    return false;
  }
  if (isNonProseLine(lineText)) {
    return false;
  }
  const nextLineText = doc.line(lineNumber + 1).text;
  if (nextLineText === '') {
    return false;
  }
  return !isNonProseLine(nextLineText);
}

export function shouldMarkSemBrLineBreak(lineText: string, lineNumber: number, doc: Text, sentenceOnly = false): boolean {
  if (lineNumber >= doc.lines) {
    return false;
  }
  const lineRegex = sentenceOnly ? SEMBR_SENTENCE_LINE_REGEX : SEMBR_LINE_REGEX;
  if (!lineRegex.test(lineText) || lineText.length < SEMBR_MIN_LINE_LENGTH) {
    return false;
  }
  if (isNonProseLine(lineText)) {
    return false;
  }

  const nextLineText = doc.line(lineNumber + 1).text;
  if (nextLineText.length < SEMBR_MIN_LINE_LENGTH && !isBracketedPandocCitationLine(nextLineText)) {
    return false;
  }

  return isProseParagraph(`${lineText}\n${nextLineText}`);
}

export function transformNoteContent(rawContent: string, mode: SemBrTransformMode, options: TransformNoteContentOptions): string {
  let noteContent = rawContent.replace(TRAILING_NEWLINES_REGEX, '');

  const yamlHeader = YAML_HEADER_REGEX.exec(noteContent);
  if (yamlHeader) {
    noteContent = noteContent.replace(yamlHeader[0], '');
  }

  const hasCodeBlocks = noteContent.includes(CODE_BLOCK_DELIMITER);
  const codeBlocks: string[] = [];
  let proseParts: string[] = [];

  if (hasCodeBlocks) {
    let i = 0;
    for (const part of noteContent.split(CODE_BLOCK_DELIMITER)) {
      if (i % CODE_BLOCK_MODULO === 0) {
        proseParts.push(part);
      } else {
        codeBlocks.push(part);
      }
      i++;
    }
  } else {
    proseParts.push(noteContent);
  }

  const sembrOffBlocks: string[] = [];
  proseParts = proseParts.map((prose) => {
    return prose.replace(SEMBR_OFF_BLOCK_REGEX, (block) => {
      const idx = sembrOffBlocks.length;
      sembrOffBlocks.push(block);
      return `SEMBR_OFF_${String(idx)}`;
    });
  });

  proseParts = proseParts.map((prose) => {
    const paragraphs = prose.split(PARAGRAPH_SPLIT_REGEX);
    const transformed = paragraphs.map((paragraph) => transformParagraph(paragraph, mode, options));
    const result = transformed.join('\n\n');
    const repaired = options.repairLocatorClusters ? repairBrokenLocatorClusters(result) : result;
    return repaired.replace(FOOTNOTE_REGEX, (footnote) => {
      return mode === 'toggle' ? removeSemBr(footnote) : footnote;
    });
  });

  if (hasCodeBlocks) {
    const parts: string[] = [];
    for (let i = 0; i < proseParts.length; i++) {
      parts.push(proseParts[i] ?? '');
      const codeBlock = codeBlocks[i];
      if (codeBlock !== undefined) {
        parts.push(codeBlock);
      }
    }
    noteContent = parts.join(CODE_BLOCK_DELIMITER);
  } else {
    noteContent = proseParts[0] ?? '';
  }

  noteContent = noteContent.replace(
    SEMBR_OFF_PLACEHOLDER_REGEX,
    (_match: string, idx: string) => sembrOffBlocks[Number(idx)] ?? ''
  );

  if (yamlHeader) {
    noteContent = yamlHeader[0] + noteContent;
  }

  return `${noteContent}\n`;
}

function addGlobalRegexFlag(flags: string): string {
  return Array.from(new Set(`${flags}g`)).join('');
}

function addSemBrToParagraph(paragraph: string, options: TransformNoteContentOptions): string {
  const clauseRegex = options.sentenceOnly ? SEMBR_SENTENCE_CLAUSE_REGEX : SEMBR_CLAUSE_REGEX;
  const customMatches: string[] = [];
  const urls: string[] = [];
  const codespans: string[] = [];
  const citations: string[] = [];
  const locators: string[] = [];

  let text = paragraph;

  for (const customRegex of options.customProtectedRegexes) {
    text = text.replace(customRegex, (match: string) => {
      const idx = customMatches.length;
      customMatches.push(match);
      return `SEMBR_CUSTOM_${String(idx)}`;
    });
  }

  text = text.replace(URL_REGEX, (url) => {
    const idx = urls.length;
    urls.push(url);
    return `SEMBR_URL_${String(idx)}`;
  });

  text = text.replace(INLINE_CODE_REGEX, (span) => {
    const idx = codespans.length;
    codespans.push(span);
    return `SEMBR_CODE_${String(idx)}`;
  });

  text = text.replace(PANDOC_CITATION_REGEX, (citation) => {
    const idx = citations.length;
    citations.push(citation);
    return `SEMBR_CITATION_${String(idx)}`;
  });

  text = text.replace(LOCATOR_CLUSTER_REGEX, (locator) => {
    const idx = locators.length;
    locators.push(locator);
    return `SEMBR_LOCATOR_${String(idx)}`;
  });

  text = text.replace(EM_DASH_SOFT_BREAK_REGEX, '—');

  text = text.replace(
    clauseRegex,
    (fullMatch: string, clause: string, _trailingSpace: string, offset: number, fullString: string): string => {
      const charAfterMatch = fullString[offset + fullMatch.length];
      const lastPunc = clause.trimEnd().at(-1);
      if (ET_AL_REGEX.test(clause)) {
        return fullMatch;
      }
      if (lastPunc === '.' && (charAfterMatch === undefined || (!/[A-Z]/u.test(charAfterMatch) && charAfterMatch !== '['))) {
        return fullMatch;
      }
      return `${clause.slice(0, -1)}\n`;
    }
  );

  text = text.replace(CUSTOM_PLACEHOLDER_REGEX, (_match: string, idx: string) => customMatches[Number(idx)] ?? '');
  text = text.replace(CODE_PLACEHOLDER_REGEX, (_match: string, idx: string) => codespans[Number(idx)] ?? '');
  text = text.replace(CITATION_PLACEHOLDER_REGEX, (_match: string, idx: string) => citations[Number(idx)] ?? '');
  text = text.replace(LOCATOR_PLACEHOLDER_REGEX, (_match: string, idx: string) => locators[Number(idx)] ?? '');
  text = text.replace(URL_PLACEHOLDER_REGEX, (_match: string, idx: string) => urls[Number(idx)] ?? '');

  if (options.isolatePandocCitations) {
    text = isolateSentenceFinalPandocCitations(text);
  }

  return text;
}

function compileCustomProtectedRegexes(rawRegexes: readonly string[]): RegExp[] {
  const regexes: RegExp[] = [];

  for (const rawRegex of rawRegexes) {
    const regex = parseCustomProtectedRegex(rawRegex);
    if (!regex) {
      continue;
    }
    regex.lastIndex = 0;
    if (regex.test('')) {
      continue;
    }
    regexes.push(regex);
  }

  return regexes;
}

function getParagraphState(paragraph: string, sentenceOnly = false): ParagraphSemBrState {
  if (!isProseParagraph(paragraph)) {
    return 'skip';
  }

  const lines = paragraph.split('\n').filter((line) => !isBracketedPandocCitationLine(line));
  if (lines.length === 1) {
    return 'add';
  }

  const lineRegex = sentenceOnly ? SEMBR_SENTENCE_LINE_REGEX : SEMBR_LINE_REGEX;
  const allBreaksAreSemBr = lines.every((line, i) => {
    if (i === lines.length - 1) {
      return true;
    }
    const nextLine = lines[i + 1] ?? '';
    return (
      lineRegex.test(line)
      && line.length >= SEMBR_MIN_LINE_LENGTH
      && nextLine.length >= SEMBR_MIN_LINE_LENGTH
    );
  });

  if (allBreaksAreSemBr) {
    return 'remove';
  }

  const hasShortLines = lines.slice(0, -1).some((line) => line.length < SEMBR_MIN_LINE_LENGTH);
  if (hasShortLines) {
    return 'skip';
  }

  return 'add';
}

function isBracketedPandocCitationLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed !== '' && trimmed.replace(BRACKETED_PANDOC_CITATION_REGEX, '').trim() === '';
}

function isNonProseLine(line: string): boolean {
  return (
    HEADING_LINE_REGEX.test(line)
    || UNORDERED_LIST_LINE_REGEX.test(line)
    || ORDERED_LIST_LINE_REGEX.test(line)
    || line.startsWith('>')
    || line.startsWith('|')
    || HORIZONTAL_RULE_REGEX.test(line)
  );
}

function isolateSentenceFinalPandocCitations(str: string): string {
  return str.replace(
    SENTENCE_FINAL_CITATION_REGEX,
    (fullMatch: string, sentencePunc: string | undefined, citation: string, citationPunc: string | undefined): string => {
      const punc = sentencePunc ?? citationPunc;
      if (!punc) {
        return fullMatch;
      }
      return `${punc}\n${citation}`;
    }
  );
}

function isProseParagraph(paragraph: string): boolean {
  return paragraph.split('\n').every((line) => !isNonProseLine(line));
}

function parseCustomProtectedRegex(rawRegex: string): null | RegExp {
  const trimmed = rawRegex.trim();
  if (trimmed === '') {
    return null;
  }

  const literal = parseRegexLiteral(trimmed);
  const source = literal?.source ?? trimmed;
  const flags = literal?.flags ?? 'u';
  const globalFlags = addGlobalRegexFlag(flags.replaceAll('y', ''));

  try {
    return new RegExp(source, globalFlags);
  } catch {
    return null;
  }
}

function parseRegexLiteral(rawRegex: string): null | ParsedCustomRegexLiteral {
  if (!rawRegex.startsWith('/')) {
    return null;
  }

  let escaped = false;
  let inCharacterClass = false;
  for (let i = 1; i < rawRegex.length; i++) {
    const char = rawRegex[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      continue;
    }
    if (char === ']') {
      inCharacterClass = false;
      continue;
    }
    if (char === '/' && !inCharacterClass) {
      return {
        flags: rawRegex.slice(i + 1),
        source: rawRegex.slice(1, i)
      };
    }
  }

  return null;
}

function removeSemBr(str: string): string {
  return str
    .replace(SEMBR_REMOVE_REGEX, '$<punc> ')
    .replace(CITATION_LINE_BREAK_REGEX, '$<citation> ');
}

function repairBrokenLocatorClusters(str: string): string {
  const lines = str.split('\n');
  const repaired: string[] = [];

  for (const line of lines) {
    const previous = repaired.at(-1);
    const trimmedLine = line.trimStart();
    const trimmedPrevious = previous?.trimEnd();
    const previousEndsWithLocatorPrefix = trimmedPrevious ? LOCATOR_PREFIX_LINE_END_REGEX.test(trimmedPrevious) : false;
    const lineStartsWithLocatorContinuation = LOCATOR_CONTINUATION_LINE_REGEX.test(trimmedLine);
    if (
      previous
      && trimmedLine !== ''
      && (previousEndsWithLocatorPrefix
        || (lineStartsWithLocatorContinuation && !SENTENCE_TERMINAL_LINE_END_REGEX.test(trimmedPrevious ?? '')))
      && !isNonProseLine(trimmedLine)
    ) {
      repaired[repaired.length - 1] = `${previous} ${trimmedLine}`;
    } else {
      repaired.push(line);
    }
  }

  return repaired.join('\n');
}

function transformParagraph(paragraph: string, mode: SemBrTransformMode, options: TransformNoteContentOptions): string {
  const state = getParagraphState(paragraph, options.sentenceOnly);
  if (state === 'skip') {
    return paragraph;
  }
  if (state === 'remove') {
    return mode === 'toggle' ? removeSemBr(paragraph) : paragraph;
  }
  return addSemBrToParagraph(paragraph, options);
}
