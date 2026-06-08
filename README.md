# Semantic Line Breaker

![Latest Release](https://img.shields.io/github/v/release/112345brian/obsidian-sembr?label=Latest%20Release&style=plastic)

An [Obsidian](https://obsidian.md/) plugin that applies and removes [Semantic Line Breaks](https://sembr.org/) —
with smart per-paragraph heuristics and escape hatches for poetry, verse, and anything else that shouldn't be touched.

## What are Semantic Line Breaks?

Semantic line breaks means one rule:

> When writing text with a compatible markup language,
> add a line break after each substantial unit of thought.
> — [sembr.org](https://sembr.org/)

With **Strict Line Breaks turned off** (the Obsidian default), single line breaks are invisible in Reading View and export.
The breaks only show up in your source — and in your git diffs, where they make a real difference.

Three reasons to use them:

1. **Better git diffs.** Changes show up at the sentence level, not the paragraph level.
2. **Line-based editing commands work on prose.** Swap line up/down, vim motions, and similar tools now operate on roughly one sentence at a time.
3. **Paragraphs break into units of thought** — easier to read and revise at the source level.

## Commands

### Toggle semantic line breaks

Runs over the active note and either adds or removes semantic line breaks — per paragraph, not per document.

Each paragraph independently decides what to do:

| Paragraph state | What happens |
| --- | --- |
| Plain prose (no breaks yet) | SemBr breaks are added at clause/sentence boundaries |
| Already sembr'd (all breaks follow punctuation, lines ≥ 25 chars) | Breaks are joined back into flowing prose |
| Short lines detected (< 25 chars) | Paragraph is skipped — poetry, verse, short-form content |
| Non-prose block (heading, list, table, blockquote) | Always skipped |

Running the command twice returns the document to its original form.

### Wrap selection with sembr-off block

Highlight any text and run this command to wrap it in a `<!-- sembr-off -->` / `<!-- sembr-on -->` block.
The wrapped region is completely ignored by the toggle command.
The HTML comments are invisible in Reading View and in export.

## Controlling SemBr per file

### Front matter override

Add `sembr` to a note's front matter to override the global settings:

```yaml
---
sembr: false
---
```

| Value | Effect |
| --- | --- |
| `false` | Never apply sembr to this note, regardless of settings |
| `force` | Always apply sembr, even if the folder or note is in the exclusion lists |

### Inline escape hatch

Wrap any block of content to exclude it from processing:

```markdown
<!-- sembr-off -->
Roses are red,
Violets are blue,
This stanza stays
Exactly as-is too.
<!-- sembr-on -->
```

Use the **Wrap selection with sembr-off block** command to insert these automatically around a selection.

## Settings

**Excluded folders** — skip all notes inside these folders.
One path per line (e.g. `recipes` or `personal/journal`).

**Excluded notes** — skip specific notes by path or filename (e.g. `inbox.md`).

**Excluded front matter rules** — skip notes matching a front matter condition.
One rule per line.
Format: `key` (any value) or `key: value` (exact match).
Example: `up: [[Recipe]]` skips any note with that breadcrumb parent.

## How breaks are inserted

- Breaks fire after `.,:;?!—` with at least 25 characters of prose on each side.
- Periods only break when followed by an uppercase letter — avoids `Dr.`, `e.g.`, `vs.`, etc.
- URLs are extracted before processing and restored verbatim — no mid-URL breaks.
- Inline code spans (`` `like this` ``) are extracted and restored verbatim.
- Footnote references at the end of a clause are preserved.
- YAML front matter, fenced code blocks, and `<!-- sembr-off -->` regions are never touched.

## Installation

Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) with:

```text
https://github.com/112345brian/obsidian-sembr
```

Or manually: download `main.js`, `manifest.json`, and `styles.css` from the latest release
and drop them in `.obsidian/plugins/obsidian-sembr/`.
