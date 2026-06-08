import type {
  Extension,
  Text
} from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type {
  Editor,
  MarkdownFileInfo,
  TAbstractFile
} from 'obsidian';

import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType
} from '@codemirror/view';
import {
  editorLivePreviewField,
  MarkdownView,
  Plugin as ObsidianPlugin,
  TFile
} from 'obsidian';

import type { PluginSettings as PluginSettingsData } from './PluginSettings.ts';

import {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  MIN_IDLE_TIMEOUT_SECONDS,
  PluginSettings
} from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

// ── Block-type detectors ──────────────────────────────────────────────────────

const HEADING_LINE_REGEX = /^#{1,6}\s/u;
const UNORDERED_LIST_LINE_REGEX = /^[-*+]\s/u;
const ORDERED_LIST_LINE_REGEX = /^\d+\.\s/u;
const HORIZONTAL_RULE_REGEX = /^(?:---|\*\*\*|___)\s*$/u;

// ── SemBr regexes ─────────────────────────────────────────────────────────────

const SEMBR_REMOVE_REGEX = /(?<punc>[.,:;?!—]) ?\n(?!\n)/gmu;
const SEMBR_CLAUSE_REGEX = /(?<clause>[^|.\n]{25,}?[^:][.,:;?!—](?: ?\[.+\])?(?<trailingSpace> ))(?!\n\n| |.*\|.*$|p\. [1-9-]+\]|@|\d)(?=[^|.\n]{25,})/gmu;
const ET_AL_REGEX = /\bet al\. $/u;
const FOOTNOTE_REGEX = /\n\[\^.*?(?=\[\n\^|\n\n|$)/gsu;

// A line is sembr'd if it ends in punctuation — used for per-paragraph state detection.
const SEMBR_LINE_REGEX = /[.,:;?!—] ?$/u;

// ── Extraction regexes ────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/\S+/gu;
const INLINE_CODE_REGEX = /`[^`\n]+`/gu;
const BRACKETED_PANDOC_CITATION_REGEX = /\[[^\]\n]*@[^\]\n]*\]/gu;
const PANDOC_CITATION_REGEX = /-?@[\p{Letter}\p{Number}_:.#$%&\-+?<>~/]+|\[[^\]\n]*@[^\]\n]*\]/gu;
const LOCATOR_CLUSTER_REGEX =
  /(?<![\p{Letter}\p{Number}_])(?:(?:p|pp|Pg|ch|para)\. ?\d+(?:[-–]\d+)?(?:\s+[A-Z]\d+(?:\/[A-Z]?\d+|[-–][A-Z]?\d+)?)?|§ ?\d+|[A-Z]\d+(?:\/[A-Z]?\d+|[-–][A-Z]?\d+))(?![\p{Letter}\p{Number}_])/gu;
const SEMBR_OFF_BLOCK_REGEX = /<!--\s*sembr-off\s*-->.*?<!--\s*sembr-on\s*-->/gsu;

// ── Structural ────────────────────────────────────────────────────────────────

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
const SENTENCE_FINAL_CITATION_REGEX = /(?<sentencePunc>[.!?])? ?(?<citation>\[[^\]\n]*@[^\]\n]*\])(?<citationPunc>[.!?])?(?= |$)/gu;
const FRONTMATTER_RULE_SEPARATOR = ': ';
const SEMBR_MIN_LINE_LENGTH = 25;
const MS_PER_SECOND = 1000;

// ── Frontmatter sembr override values ────────────────────────────────────────

const SEMBR_FRONTMATTER_KEY = 'sembr';
const SEMBR_FRONTMATTER_OFF = 'false';
const SEMBR_FRONTMATTER_FORCE = 'force';

// ── Types ─────────────────────────────────────────────────────────────────────

type ParagraphSemBrState = 'add' | 'remove' | 'skip';
interface ParsedCustomRegexLiteral {
  readonly flags: string;
  readonly source: string;
}
type SemBrTransformMode = 'add' | 'toggle';
interface SemBrTransformOptions {
  readonly customProtectedRegexes: readonly RegExp[];
  readonly isolatePandocCitations: boolean;
}

// ── Plugin ────────────────────────────────────────────────────────────────────

class SemBrLineBreakMarkerWidget extends WidgetType {
  public override eq(widget: WidgetType): boolean {
    return widget instanceof SemBrLineBreakMarkerWidget;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement('span');
    span.addClass('sembr-live-preview-break-marker');
    span.ariaHidden = 'true';
    span.textContent = '^';
    return span;
  }
}

// ── Helpers (alphabetical) ────────────────────────────────────────────────────

export class Plugin extends ObsidianPlugin {
  public override settings: PluginSettingsData = new PluginSettings();
  private readonly editorExtensions: Extension[] = [];
  private idleTimer: null | number = null;

  public override async onload(): Promise<void> {
    await this.loadSettings();
    this.editorExtensions.push(...this.getEditorExtensions());
    this.registerEditorExtension(this.editorExtensions);
    this.addSettingTab(new PluginSettingsTab(this.app, this));
    this.addCommand({
      editorCallback: (editor: Editor): void => {
        this.toggleSemBr(editor);
      },
      id: 'toggle-sem-br',
      name: 'Toggle semantic line breaks'
    });
    this.addCommand({
      editorCallback: (editor: Editor): void => {
        wrapSelectionWithSemBrOff(editor);
      },
      id: 'wrap-sembr-off',
      name: 'Wrap selection with sembr-off block'
    });
    this.setupAutoApply();
  }

  public override onunload(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  public refreshEditorExtensions(): void {
    this.editorExtensions.splice(0, this.editorExtensions.length, ...this.getEditorExtensions());
    this.app.workspace.updateOptions();
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private applyAddSemBr(editor: Editor, file: TFile): void {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const override = this.getSemBrFrontmatterOverride(frontmatter);
    if (override === 'false') {
      return;
    }
    if (override !== 'force' && this.isNoteExcluded(file, frontmatter)) {
      return;
    }
    const oldContent = editor.getValue();
    const newContent = transformNoteContent(oldContent, 'add', this.getTransformOptions());
    if (newContent === oldContent) {
      return;
    }
    editor.setValue(newContent);
  }

  private getEditorExtensions(): Extension[] {
    if (!this.settings.showLivePreviewLineBreakMarkers) {
      return [];
    }
    return [semBrLineBreakMarkerExtension];
  }

  private getSemBrFrontmatterOverride(frontmatter: null | Record<string, unknown>): 'false' | 'force' | null {
    if (!frontmatter) {
      return null;
    }
    const raw = frontmatter[SEMBR_FRONTMATTER_KEY];
    // YAML `sembr: false` comes through as boolean false; `sembr: "false"` as a string.
    if (raw === false || raw === SEMBR_FRONTMATTER_OFF) {
      return 'false';
    }
    if (raw === SEMBR_FRONTMATTER_FORCE) {
      return 'force';
    }
    return null;
  }

  private getTransformOptions(): SemBrTransformOptions {
    return {
      customProtectedRegexes: compileCustomProtectedRegexes(this.settings.customProtectedRegexes),
      isolatePandocCitations: this.settings.isolatePandocCitations
    };
  }

  private isNoteExcluded(file: TFile, frontmatter: null | Record<string, unknown>): boolean {
    const { excludedFolders, excludedFrontmatterRules, excludedNotes } = this.settings;

    if (excludedNotes.some((note) => file.path === note || file.name === note)) {
      return true;
    }

    if (excludedFolders.some((folder) => file.path.startsWith(`${folder}/`))) {
      return true;
    }

    if (frontmatter && excludedFrontmatterRules.length > 0) {
      for (const rule of excludedFrontmatterRules) {
        const separatorIndex = rule.indexOf(FRONTMATTER_RULE_SEPARATOR);

        if (separatorIndex === -1) {
          if (rule in frontmatter) {
            return true;
          }
        } else {
          const key = rule.slice(0, separatorIndex).trim();
          const ruleValue = rule.slice(separatorIndex + FRONTMATTER_RULE_SEPARATOR.length).trim();
          const rawVal = frontmatter[key];
          if (
            (typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean')
            && String(rawVal) === ruleValue
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign(new PluginSettings(), await this.loadData() as Partial<PluginSettingsData>);
    if (!Number.isFinite(this.settings.idleTimeoutSeconds) || this.settings.idleTimeoutSeconds < MIN_IDLE_TIMEOUT_SECONDS) {
      this.settings.idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS;
    }
  }

  private setupAutoApply(): void {
    // On-save: fires whenever Obsidian writes the active file to disk.
    this.registerEvent(
      this.app.vault.on('modify', (abstractFile: TAbstractFile) => {
        if (this.settings.autoApply !== 'on-save') {
          return;
        }
        if (!(abstractFile instanceof TFile)) {
          return;
        }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file !== abstractFile) {
          return;
        }
        this.applyAddSemBr(view.editor, abstractFile);
      })
    );

    // On-idle: debounced — fires after the user stops typing for the configured duration.
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor, info: MarkdownFileInfo) => {
        if (this.settings.autoApply !== 'on-idle') {
          return;
        }
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
        }
        const { file } = info;
        if (!file) {
          return;
        }
        this.idleTimer = window.setTimeout(() => {
          this.idleTimer = null;
          if (this.settings.autoApply !== 'on-idle') {
            return;
          }
          if (this.app.workspace.getActiveFile() !== file) {
            return;
          }
          this.applyAddSemBr(editor, file);
        }, this.settings.idleTimeoutSeconds * MS_PER_SECOND);
      })
    );
  }

  private toggleSemBr(editor: Editor): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const override = this.getSemBrFrontmatterOverride(frontmatter);

    // `sembr: false` — skip entirely regardless of all other rules.
    if (override === 'false') {
      return;
    }

    // `sembr: force` — bypass exclusion checks.
    if (override !== 'force' && this.isNoteExcluded(file, frontmatter)) {
      return;
    }

    editor.setValue(transformNoteContent(editor.getValue(), 'toggle', this.getTransformOptions()));
  }
}

function addGlobalRegexFlag(flags: string): string {
  return Array.from(new Set(`${flags}g`)).join('');
}

function addSemBrToParagraph(paragraph: string, options: SemBrTransformOptions): string {
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

  text = text.replace(
    SEMBR_CLAUSE_REGEX,
    (fullMatch: string, clause: string, _trailingSpace: string, offset: number, fullString: string): string => {
      const charAfterMatch = fullString[offset + fullMatch.length];
      const lastPunc = clause.trimEnd().at(-1);
      if (ET_AL_REGEX.test(clause)) {
        return fullMatch;
      }
      if (lastPunc === '.' && (charAfterMatch === undefined || !/[A-Z]/u.test(charAfterMatch))) {
        return fullMatch;
      }
      return `${clause}\n`;
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

function buildSemBrLineBreakMarkers(view: EditorView): DecorationSet {
  // @ts-expect-error Obsidian's StateField type is nominally distinct from the direct CodeMirror import.
  if (!view.state.field(editorLivePreviewField, false)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let lastLineNumber = 0;

  for (const range of view.visibleRanges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = doc.lineAt(pos);
      if (line.number !== lastLineNumber && shouldMarkSemBrLineBreak(line.text, line.number, doc)) {
        builder.add(line.to, line.to, semBrLineBreakMarkerDecoration);
        lastLineNumber = line.number;
      }
      if (line.to >= doc.length) {
        break;
      }
      pos = line.to + 1;
    }
  }

  return builder.finish();
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

function getParagraphState(paragraph: string): ParagraphSemBrState {
  if (!isProseParagraph(paragraph)) {
    return 'skip';
  }

  const lines = paragraph.split('\n').filter((line) => !isBracketedPandocCitationLine(line));
  if (lines.length === 1) {
    return 'add';
  }

  // Paragraph looks sembr'd: every non-terminal line ends with punctuation,
  // Both the line and the following line meet the minimum prose length.
  const allBreaksAreSemBr = lines.every((line, i) => {
    if (i === lines.length - 1) {
      return true;
    }
    const nextLine = lines[i + 1] ?? '';
    return (
      SEMBR_LINE_REGEX.test(line)
      && line.length >= SEMBR_MIN_LINE_LENGTH
      && nextLine.length >= SEMBR_MIN_LINE_LENGTH
    );
  });

  if (allBreaksAreSemBr) {
    return 'remove';
  }

  // Lines shorter than the minimum suggest poetry, verse, or short-form content — skip.
  // Exclude the terminal line: it is almost always short and would cause false positives.
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

const semBrLineBreakMarkerDecoration = Decoration.widget({
  side: 1,
  widget: new SemBrLineBreakMarkerWidget()
});

const semBrLineBreakMarkerExtension = EditorView.decorations.of(buildSemBrLineBreakMarkers);

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
    if (
      previous
      && trimmedLine !== ''
      && (LOCATOR_PREFIX_LINE_END_REGEX.test(previous.trimEnd()) || LOCATOR_CONTINUATION_LINE_REGEX.test(trimmedLine))
      && !isNonProseLine(trimmedLine)
    ) {
      repaired[repaired.length - 1] = `${previous} ${trimmedLine}`;
    } else {
      repaired.push(line);
    }
  }

  return repaired.join('\n');
}

function shouldMarkSemBrLineBreak(lineText: string, lineNumber: number, doc: Text): boolean {
  if (lineNumber >= doc.lines) {
    return false;
  }
  if (!SEMBR_LINE_REGEX.test(lineText) || lineText.length < SEMBR_MIN_LINE_LENGTH) {
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

function transformNoteContent(rawContent: string, mode: SemBrTransformMode, options: SemBrTransformOptions): string {
  let noteContent = rawContent.replace(TRAILING_NEWLINES_REGEX, '');

  // Extract YAML frontmatter.
  const yamlHeader = YAML_HEADER_REGEX.exec(noteContent);
  if (yamlHeader) {
    noteContent = noteContent.replace(yamlHeader[0], '');
  }

  // Split out fenced code blocks so they are never touched.
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

  // Extract `<!-- sembr-off --> ... <!-- sembr-on -->` blocks from prose parts only.
  // Must run after code splitting so directives inside code blocks are ignored.
  const sembrOffBlocks: string[] = [];
  proseParts = proseParts.map((prose) => {
    return prose.replace(SEMBR_OFF_BLOCK_REGEX, (block) => {
      const idx = sembrOffBlocks.length;
      sembrOffBlocks.push(block);
      return `SEMBR_OFF_${String(idx)}`;
    });
  });

  // Transform per-paragraph — each paragraph decides its own direction.
  proseParts = proseParts.map((prose) => {
    const paragraphs = prose.split(PARAGRAPH_SPLIT_REGEX);
    const transformed = paragraphs.map((paragraph) => transformParagraph(paragraph, mode, options));
    const result = transformed.join('\n\n');
    const repaired = repairBrokenLocatorClusters(result);
    return repaired.replace(FOOTNOTE_REGEX, (footnote) => {
      return mode === 'toggle' ? removeSemBr(footnote) : footnote;
    });
  });

  // Reassemble code blocks.
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

  // Restore sembr-off blocks.
  noteContent = noteContent.replace(
    SEMBR_OFF_PLACEHOLDER_REGEX,
    (_match: string, idx: string) => sembrOffBlocks[Number(idx)] ?? ''
  );

  if (yamlHeader) {
    noteContent = yamlHeader[0] + noteContent;
  }

  return `${noteContent}\n`;
}

function transformParagraph(paragraph: string, mode: SemBrTransformMode, options: SemBrTransformOptions): string {
  const state = getParagraphState(paragraph);
  if (state === 'skip') {
    return paragraph;
  }
  if (state === 'remove') {
    return mode === 'toggle' ? removeSemBr(paragraph) : paragraph;
  }
  return addSemBrToParagraph(paragraph, options);
}

function wrapSelectionWithSemBrOff(editor: Editor): void {
  const selection = editor.getSelection();
  const wrapped = `<!-- sembr-off -->\n${selection}\n<!-- sembr-on -->`;
  editor.replaceSelection(wrapped);
}
