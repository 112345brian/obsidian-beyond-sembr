import type { Editor } from 'obsidian';

import { Plugin as ObsidianPlugin } from 'obsidian';

// Named capture group versions of the regexes to satisfy ESLint prefer-named-capture-group.
// The SemBr add regex uses named group 'match' for the punctuated clause to replace.
const SEMBR_DETECT_REGEX = /[.,:;?!—] ?\n(?!\n)/;
const SEMBR_REMOVE_REGEX = /(?<punc>[.,:;?!—]) ?\n(?!\n)/gm;
const SEMBR_ADD_REGEX = /(?<clause>[^|.]{25,}?[^:][.,:;?!—](?: ?\[.+\])?(?<trailingSpace> ))(?!\n\n| |.*\|.*$|p\. [1-9-]+\]|@|\d)(?=[^|.]{25,})/gm;
const FOOTNOTE_REGEX = /\n\[\^.*?(?=\[\n\^|\n\n|$)/gs;
const YAML_HEADER_REGEX = /^---\n.*?---\n/s;
const CODE_BLOCK_DELIMITER = '```';
const TRAILING_NEWLINES_REGEX = /\n+$/;
const CODE_BLOCK_MODULO = 2;

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

  private removeSemBr(str: string): string {
    return str.replace(SEMBR_REMOVE_REGEX, '$<punc> ');
  }

  private toggleSemBr(editor: Editor): void {
    let noteContent = editor.getValue().replace(TRAILING_NEWLINES_REGEX, '');

    // Extract and temporarily remove YAML frontmatter
    const yamlHeader = YAML_HEADER_REGEX.exec(noteContent);
    if (yamlHeader) {
      noteContent = noteContent.replace(yamlHeader[0], '');
    }

    // Extract and temporarily remove fenced code blocks
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

    const isSemanticLineBreaked = SEMBR_DETECT_REGEX.test(noteContent);

    proseParts = proseParts.map((prose) => {
      if (isSemanticLineBreaked) {
        return this.removeSemBr(prose);
      }

      // Add semantic line breaks after punctuation
      prose = prose.replace(SEMBR_ADD_REGEX, '$<clause>\n');

      // Restore footnotes that were incorrectly split
      prose = prose.replace(FOOTNOTE_REGEX, (footnote) => this.removeSemBr(footnote));

      return prose;
    });

    // Reassemble code blocks into prose
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

    // Restore YAML frontmatter
    if (yamlHeader) {
      noteContent = yamlHeader[0] + noteContent;
    }

    editor.setValue(`${noteContent}\n`);
  }
}
