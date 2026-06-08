import type {
  Editor,
  TFile
} from 'obsidian';

import { Plugin as ObsidianPlugin } from 'obsidian';

import type { PluginSettings } from './PluginSettings.ts';

import { PluginSettings as DefaultSettings } from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

// ── Block-type detectors ──────────────────────────────────────────────────────
// Lines matching these patterns are never candidates for sembr.

const HEADING_LINE_REGEX = /^#{1,6}\s/u;
const UNORDERED_LIST_LINE_REGEX = /^[-*+]\s/u;
const ORDERED_LIST_LINE_REGEX = /^\d+\.\s/u;
const HORIZONTAL_RULE_REGEX = /^(?:---|\*\*\*|___)\s*$/u;

// ── SemBr regexes ─────────────────────────────────────────────────────────────

const SEMBR_DETECT_REGEX = /[.,:;?!—] ?\n(?!\n)/u;
const SEMBR_REMOVE_REGEX = /(?<punc>[.,:;?!—]) ?\n(?!\n)/gmu;
const SEMBR_CLAUSE_REGEX = /(?<clause>[^|.]{25,}?[^:][.,:;?!—](?: ?\[.+\])?(?<trailingSpace> ))(?!\n\n| |.*\|.*$|p\. [1-9-]+\]|@|\d)(?=[^|.]{25,})/gmu;
const FOOTNOTE_REGEX = /\n\[\^.*?(?=\[\n\^|\n\n|$)/gsu;

// ── Extraction regexes ────────────────────────────────────────────────────────
// These patterns are temporarily replaced with placeholders before sembr runs.

const URL_REGEX = /https?:\/\/\S+/gu;
const INLINE_CODE_REGEX = /`[^`\n]+`/gu;

// ── Structural ────────────────────────────────────────────────────────────────

const YAML_HEADER_REGEX = /^---\n(?<body>.*?)---\n/su;
const PARAGRAPH_SPLIT_REGEX = /\n{2,}/u;
const CODE_BLOCK_DELIMITER = '```';
const TRAILING_NEWLINES_REGEX = /\n+$/u;
const CODE_BLOCK_MODULO = 2;
const URL_PLACEHOLDER_REGEX = /SEMBR_URL_(?<idx>\d+)/gu;
const CODE_PLACEHOLDER_REGEX = /SEMBR_CODE_(?<idx>\d+)/gu;
const FRONTMATTER_RULE_SEPARATOR = ': ';

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private isNoteExcluded(file: TFile, frontmatter: null | Record<string, unknown>): boolean {
    const { excludedFolders, excludedFrontmatterRules, excludedNotes } = this.settings;

    // Check excluded notes by exact path.
    if (excludedNotes.some((note) => file.path === note || file.name === note)) {
      return true;
    }

    // Check excluded folders — note path must start with the folder path.
    if (excludedFolders.some((folder) => file.path.startsWith(`${folder}/`))) {
      return true;
    }

    // Check frontmatter rules.
    if (frontmatter && excludedFrontmatterRules.length > 0) {
      for (const rule of excludedFrontmatterRules) {
        const separatorIndex = rule.indexOf(FRONTMATTER_RULE_SEPARATOR);

        if (separatorIndex === -1) {
          // Key-only rule: exclude if the key exists at all.
          if (rule in frontmatter) {
            return true;
          }
        } else {
          // Key: value rule: exclude if the key matches the value.
          const key = rule.slice(0, separatorIndex).trim();
          const value = rule.slice(separatorIndex + FRONTMATTER_RULE_SEPARATOR.length).trim();
          if (String(frontmatter[key]) === value) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign(new DefaultSettings(), await this.loadData()) as PluginSettings;
  }

  private toggleSemBr(editor: Editor): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;

    if (this.isNoteExcluded(file, frontmatter)) {
      return;
    }

    let noteContent = editor.getValue().replace(TRAILING_NEWLINES_REGEX, '');

    // Extract and temporarily remove YAML frontmatter.
    const yamlHeader = YAML_HEADER_REGEX.exec(noteContent);
    if (yamlHeader) {
      noteContent = noteContent.replace(yamlHeader[0], '');
    }

    // Extract and temporarily remove fenced code blocks.
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

    const isAlreadySemBred = SEMBR_DETECT_REGEX.test(noteContent);

    proseParts = proseParts.map((prose) => {
      if (isAlreadySemBred) {
        return removeSemBr(prose);
      }

      const result = addSemBr(prose);
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

    if (yamlHeader) {
      noteContent = yamlHeader[0] + noteContent;
    }

    editor.setValue(`${noteContent}\n`);
  }
}

function addSemBr(prose: string): string {
  const paragraphs = prose.split(PARAGRAPH_SPLIT_REGEX);
  return paragraphs
    .map((paragraph) => (isProseParagraph(paragraph) ? addSemBrToParagraph(paragraph) : paragraph))
    .join('\n\n');
}

function addSemBrToParagraph(paragraph: string): string {
  // Extract URLs and inline code spans so the regex never breaks inside them.
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
      // Periods only break before uppercase — prevents abbreviation misfires.
      const charAfterMatch = fullString[offset + fullMatch.length];
      const lastPunc = clause.trimEnd().at(-1);
      if (lastPunc === '.' && (charAfterMatch === undefined || !/[A-Z]/u.test(charAfterMatch))) {
        return fullMatch;
      }
      return `${clause}\n`;
    }
  );

  // Restore inline code spans and URLs.
  text = text.replace(CODE_PLACEHOLDER_REGEX, (_match: string, idx: string) => codespans[Number(idx)] ?? '');
  text = text.replace(URL_PLACEHOLDER_REGEX, (_match: string, idx: string) => urls[Number(idx)] ?? '');

  return text;
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
