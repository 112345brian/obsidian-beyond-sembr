import type {
  Editor,
  TFile
} from 'obsidian';

import { Plugin as ObsidianPlugin } from 'obsidian';

import type { PluginSettings } from './PluginSettings.ts';

import { PluginSettings as DefaultSettings } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

// ── Block-type detectors ──────────────────────────────────────────────────────

const HEADING_LINE_REGEX = /^#{1,6}\s/u;
const UNORDERED_LIST_LINE_REGEX = /^[-*+]\s/u;
const ORDERED_LIST_LINE_REGEX = /^\d+\.\s/u;
const HORIZONTAL_RULE_REGEX = /^(?:---|\*\*\*|___)\s*$/u;

// ── SemBr regexes ─────────────────────────────────────────────────────────────

const SEMBR_REMOVE_REGEX = /(?<punc>[.,:;?!—]) ?\n(?!\n)/gmu;
const SEMBR_CLAUSE_REGEX = /(?<clause>[^|.]{25,}?[^:][.,:;?!—](?: ?\[.+\])?(?<trailingSpace> ))(?!\n\n| |.*\|.*$|p\. [1-9-]+\]|@|\d)(?=[^|.]{25,})/gmu;
const FOOTNOTE_REGEX = /\n\[\^.*?(?=\[\n\^|\n\n|$)/gsu;

// A line is sembr'd if it ends in punctuation — used for per-paragraph state detection.
const SEMBR_LINE_REGEX = /[.,:;?!—] ?$/u;

// ── Extraction regexes ────────────────────────────────────────────────────────

const URL_REGEX = /https?:\/\/\S+/gu;
const INLINE_CODE_REGEX = /`[^`\n]+`/gu;
const SEMBR_OFF_BLOCK_REGEX = /<!--\s*sembr-off\s*-->.*?<!--\s*sembr-on\s*-->/gsu;

// ── Structural ────────────────────────────────────────────────────────────────

const YAML_HEADER_REGEX = /^---\n(?<body>.*?)---\n/su;
const PARAGRAPH_SPLIT_REGEX = /\n{2,}/u;
const CODE_BLOCK_DELIMITER = '```';
const TRAILING_NEWLINES_REGEX = /\n+$/u;
const CODE_BLOCK_MODULO = 2;
const URL_PLACEHOLDER_REGEX = /SEMBR_URL_(?<idx>\d+)/gu;
const CODE_PLACEHOLDER_REGEX = /SEMBR_CODE_(?<idx>\d+)/gu;
const SEMBR_OFF_PLACEHOLDER_REGEX = /SEMBR_OFF_(?<idx>\d+)/gu;
const FRONTMATTER_RULE_SEPARATOR = ': ';
const SEMBR_MIN_LINE_LENGTH = 25;

// ── Frontmatter sembr override values ────────────────────────────────────────

const SEMBR_FRONTMATTER_KEY = 'sembr';
const SEMBR_FRONTMATTER_OFF = 'false';
const SEMBR_FRONTMATTER_FORCE = 'force';

// ── Types ─────────────────────────────────────────────────────────────────────

type ParagraphSemBrState = 'add' | 'remove' | 'skip';

// ── Plugin ────────────────────────────────────────────────────────────────────

export class Plugin extends ObsidianPlugin {
  public override settings: PluginSettings = new DefaultSettings();

  public override async onload(): Promise<void> {
    await this.loadSettings();
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
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
          if (frontmatter[key] === ruleValue) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign(new DefaultSettings(), await this.loadData() as Partial<PluginSettings>);
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

    let noteContent = editor.getValue().replace(TRAILING_NEWLINES_REGEX, '');

    // Extract YAML frontmatter.
    const yamlHeader = YAML_HEADER_REGEX.exec(noteContent);
    if (yamlHeader) {
      noteContent = noteContent.replace(yamlHeader[0], '');
    }

    // Extract `<!-- sembr-off --> ... <!-- sembr-on -->` blocks.
    const sembrOffBlocks: string[] = [];
    noteContent = noteContent.replace(SEMBR_OFF_BLOCK_REGEX, (block) => {
      const idx = sembrOffBlocks.length;
      sembrOffBlocks.push(block);
      return `SEMBR_OFF_${String(idx)}`;
    });

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

    // Toggle per-paragraph — each paragraph decides its own direction.
    proseParts = proseParts.map((prose) => {
      const paragraphs = prose.split(PARAGRAPH_SPLIT_REGEX);
      const toggled = paragraphs.map((paragraph) => toggleSemBrInParagraph(paragraph));
      const result = toggled.join('\n\n');
      return result.replace(FOOTNOTE_REGEX, (footnote) => removeSemBr(footnote));
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

    editor.setValue(`${noteContent}\n`);
  }
}

// ── Helpers (alphabetical) ────────────────────────────────────────────────────

function addSemBrToParagraph(paragraph: string): string {
  const urls: string[] = [];
  const codespans: string[] = [];

  let text = paragraph.replace(URL_REGEX, (url) => {
    const idx = urls.length;
    urls.push(url);
    return `SEMBR_URL_${String(idx)}`;
  });

  text = text.replace(INLINE_CODE_REGEX, (span) => {
    const idx = codespans.length;
    codespans.push(span);
    return `SEMBR_CODE_${String(idx)}`;
  });

  text = text.replace(
    SEMBR_CLAUSE_REGEX,
    (fullMatch: string, clause: string, _trailingSpace: string, offset: number, fullString: string): string => {
      const charAfterMatch = fullString[offset + fullMatch.length];
      const lastPunc = clause.trimEnd().at(-1);
      if (lastPunc === '.' && (charAfterMatch === undefined || !/[A-Z]/u.test(charAfterMatch))) {
        return fullMatch;
      }
      return `${clause}\n`;
    }
  );

  text = text.replace(CODE_PLACEHOLDER_REGEX, (_match: string, idx: string) => codespans[Number(idx)] ?? '');
  text = text.replace(URL_PLACEHOLDER_REGEX, (_match: string, idx: string) => urls[Number(idx)] ?? '');

  return text;
}

function getParagraphState(paragraph: string): ParagraphSemBrState {
  if (!isProseParagraph(paragraph)) {
    return 'skip';
  }

  const lines = paragraph.split('\n');
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
  const hasShortLines = lines.some((line) => line.length < SEMBR_MIN_LINE_LENGTH);
  if (hasShortLines) {
    return 'skip';
  }

  return 'add';
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

function isProseParagraph(paragraph: string): boolean {
  return paragraph.split('\n').every((line) => !isNonProseLine(line));
}

function removeSemBr(str: string): string {
  return str.replace(SEMBR_REMOVE_REGEX, '$<punc> ');
}

function toggleSemBrInParagraph(paragraph: string): string {
  switch (getParagraphState(paragraph)) {
    case 'add':
      return addSemBrToParagraph(paragraph);
    case 'remove':
      return removeSemBr(paragraph);
    default:
      return paragraph;
  }
}

function wrapSelectionWithSemBrOff(editor: Editor): void {
  const selection = editor.getSelection();
  const wrapped = `<!-- sembr-off -->\n${selection}\n<!-- sembr-on -->`;
  editor.replaceSelection(wrapped);
}
