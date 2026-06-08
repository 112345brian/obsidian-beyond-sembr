import type { Editor } from 'obsidian';

import { Plugin as ObsidianPlugin } from 'obsidian';

// ── Block-type detectors ──────────────────────────────────────────────────────
// Lines matching these patterns are never candidates for sembr.

const HEADING_LINE_REGEX = /^#{1,6}\s/u;
const UNORDERED_LIST_LINE_REGEX = /^[-*+]\s/u;
const ORDERED_LIST_LINE_REGEX = /^\d+\.\s/u;

const HORIZONTAL_RULE_REGEX = /^(?:---|\*\*\*|___)\s*$/u;

// ── SemBr regexes ─────────────────────────────────────────────────────────────

// Detect whether sembr is already applied (used to decide toggle direction).
const SEMBR_DETECT_REGEX = /[.,:;?!—] ?\n(?!\n)/u;

// Remove sembr: collapse punctuation + soft newline back to a space.
const SEMBR_REMOVE_REGEX = /(?<punc>[.,:;?!—]) ?\n(?!\n)/gmu;

// Add sembr: match a prose clause of 25+ chars ending in punctuation + space,
// Followed by another 25+ chars. Excludes tables, Pandoc citations, page refs,
// Footnotes, and email-like patterns.
const SEMBR_CLAUSE_REGEX = /(?<clause>[^|.]{25,}?[^:][.,:;?!—](?: ?\[.+\])?(?<trailingSpace> ))(?!\n\n| |.*\|.*$|p\. [1-9-]+\]|@|\d)(?=[^|.]{25,})/gmu;

// Footnote blocks should not be split.
const FOOTNOTE_REGEX = /\n\[\^.*?(?=\[\n\^|\n\n|$)/gsu;

// URLs — extracted before sembr and restored after.
const URL_REGEX = /https?:\/\/\S+/gu;

// ── Structural regexes ────────────────────────────────────────────────────────

const YAML_HEADER_REGEX = /^---\n.*?---\n/su;
const PARAGRAPH_SPLIT_REGEX = /\n{2,}/u;
const CODE_BLOCK_DELIMITER = '```';
const TRAILING_NEWLINES_REGEX = /\n+$/u;
const CODE_BLOCK_MODULO = 2;
const URL_PLACEHOLDER_PREFIX = 'SEMBR_URL_';
const URL_PLACEHOLDER_REGEX = /SEMBR_URL_(?<idx>\d+)/gu;

// ── Helpers ───────────────────────────────────────────────────────────────────

export class Plugin extends ObsidianPlugin {
  public override onload(): void {
    this.addCommand({
      editorCallback: (editor: Editor): void => {
        this.toggleSemBr(editor);
      },
      id: 'toggle-sem-br',
      name: 'Toggle semantic line breaks'
    });
  }

  private toggleSemBr(editor: Editor): void {
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

      // Restore footnotes that were incorrectly split.
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

    // Restore YAML frontmatter.
    if (yamlHeader) {
      noteContent = yamlHeader[0] + noteContent;
    }

    editor.setValue(`${noteContent}\n`);
  }
}

function addSemBr(prose: string): string {
  const paragraphs = prose.split(PARAGRAPH_SPLIT_REGEX);

  const processed = paragraphs.map((paragraph) => {
    if (!isProseParagraph(paragraph)) {
      return paragraph;
    }
    return addSemBrToParagraph(paragraph);
  });

  // Rejoin with the same double-newline separator.
  return processed.join('\n\n');
}

function addSemBrToParagraph(paragraph: string): string {
  // Temporarily replace URLs so the regex never breaks inside them.
  const urls: string[] = [];
  let text = paragraph.replace(URL_REGEX, (url) => {
    const placeholder = `${URL_PLACEHOLDER_PREFIX}${String(urls.length)}`;
    urls.push(url);
    return placeholder;
  });

  text = text.replace(
    SEMBR_CLAUSE_REGEX,
    (
      fullMatch: string,
      clause: string,
      _trailingSpace: string,
      offset: number,
      fullString: string
    ): string => {
      // For periods only: require the next character to be uppercase.
      // This avoids breaking abbreviations like e.g., Dr., Mr., etc.
      const charAfterMatch = fullString[offset + fullMatch.length];
      const lastPunc = clause.trimEnd().at(-1);

      if (lastPunc === '.' && (charAfterMatch === undefined || !/[A-Z]/u.test(charAfterMatch))) {
        return fullMatch;
      }

      return `${clause}\n`;
    }
  );

  // Restore URLs.
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

// ── Plugin ────────────────────────────────────────────────────────────────────

function removeSemBr(str: string): string {
  return str.replace(SEMBR_REMOVE_REGEX, '$<punc> ');
}
