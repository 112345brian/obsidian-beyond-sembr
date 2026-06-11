# Beyond SemBr

![Latest Release](https://img.shields.io/github/v/release/112345brian/obsidian-beyond-sembr?label=Latest%20Release&style=plastic)

An [Obsidian](https://obsidian.md/) plugin for rendered-first, diff-friendly Markdown.
It applies [Semantic Line Breaks](https://sembr.org/), protects Pandoc citations, and can normalize citation placement so source changes stay small without changing how prose reads in Live Preview.

## Philosophy

Beyond SemBr assumes source is a storage and diff format, not the primary reading surface.
Rendered prose should stay clean.
Markdown source should be structured enough for good git diffs, review, and automation.

Semantic line breaks are the base layer:

> When writing text with a compatible markup language,
> add a line break after each substantial unit of thought.
> — [sembr.org](https://sembr.org/)

With **Strict Line Breaks turned off** (the Obsidian default), single line breaks are visually seamless in Live Preview, Reading View, and export.
Beyond SemBr keeps that rendered experience intact while making source changes more reviewable.

## Features

- Applies and removes semantic line breaks per paragraph.
- Auto-applies on save or after idle.
- Shows optional subtle Live Preview markers where hidden semantic line breaks exist.
- Protects URLs, inline code, Pandoc citations, fenced code blocks, YAML front matter, and `<!-- sembr-off -->` regions.
- Optionally isolates sentence-final bracketed Pandoc citations onto their own lines for cleaner diffs.
- Supports per-note front matter overrides and exclusion settings.

## Commands

### Toggle semantic line breaks

Runs over the active note and either adds or removes semantic line breaks, per paragraph.

| Paragraph state | What happens |
| --- | --- |
| Plain prose | SemBr breaks are added at clause/sentence boundaries |
| Already SemBr'd | Breaks are joined back into flowing prose |
| Short lines detected | Paragraph is skipped |
| Non-prose block | Heading, list, table, and blockquote content is skipped |

### Wrap selection with sembr-off block

Wraps the current selection in a `<!-- sembr-off -->` / `<!-- sembr-on -->` block.
The wrapped region is ignored by Beyond SemBr.
The HTML comments are invisible in Reading View and export.

## Per-File Control

Add `sembr` to a note's front matter to override global settings:

```yaml
---
sembr: false
---
```

| Value | Effect |
| --- | --- |
| `false` | Never apply Beyond SemBr to this note |
| `force` | Always apply Beyond SemBr, even if the note matches an exclusion |

Use an inline escape hatch for specific regions:

```markdown
<!-- sembr-off -->
Roses are red,
Violets are blue,
This stanza stays
Exactly as-is too.
<!-- sembr-on -->
```

## Settings

**Auto-apply** — run manually, on save, or after idle.

**Idle timeout** — delay before after-idle auto-apply runs.

**Isolate pandoc citations** — put sentence-final bracketed Pandoc citations on their own line for cleaner diffs.

**Show line break markers** — show subtle markers for hidden semantic line breaks in Live Preview.

**Repair locator clusters** — join page/location references back together if a previous format split them across lines.

**Use custom protected regexes** — enable or disable the custom protection list without deleting it.

**Custom protected regexes** — protect additional source spans from line breaks.
Enter one JavaScript regex per line, either as a bare source or `/source/flags`.
Invalid regexes and regexes that can match an empty string are ignored.

**Excluded folders** — skip all notes inside these folders.

**Excluded notes** — skip specific notes by path or filename.

**Excluded front matter rules** — skip notes matching a front matter condition.
Rules can be `key` (any value) or `key: value` (exact match).

## How Breaks Are Inserted

- Breaks fire after `.,:;?!…` with at least 25 characters of prose on each side.
- Em-dashes (`—`) are not break points; a soft break immediately after an em-dash is collapsed into the em-dash instead.
- Periods only break when followed by an uppercase letter or `[` (a wikilink or bracket reference), avoiding most abbreviations.
- `et al.` is treated as an abbreviation and not a break point.
- URLs are extracted before processing and restored verbatim.
- Inline code spans are extracted and restored verbatim.
- Custom protected regex matches are extracted and restored verbatim.
- Pandoc citations are extracted and restored verbatim.
- Page/location references are treated as indivisible citation metadata.
  Beyond SemBr never inserts a line break inside clusters like `p. 12`, `pp. 12-15`, `Pg. 193`, `A51/B75`, `A290-B349`, `§25`, `ch. 4`, `para. 14`, `[@key, p. 12]`, or `[@key, Pg. 193 A51/B75]`.
- After formatting, broken locator clusters are repaired:
  lines ending with `p.`, `pp.`, `Pg.`, `ch.`, or `§` are joined back to their locator continuation.
- Sentence-final bracketed Pandoc citations can be isolated onto their own line.
- YAML front matter, fenced code blocks, and `<!-- sembr-off -->` regions are never touched.

## Installation

Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat) with:

```text
https://github.com/112345brian/obsidian-beyond-sembr
```

Or manually: download `main.js`, `manifest.json`, and `styles.css` from the latest release
and drop them in `.obsidian/plugins/beyond-sembr/`.

### Existing Semantic Line Breaker installs

The Obsidian plugin id changed from `obsidian-sembr` to `beyond-sembr`.
Obsidian treats that as a different plugin folder.
If you previously installed Semantic Line Breaker manually, remove or disable the old `.obsidian/plugins/obsidian-sembr/` folder after installing Beyond SemBr.

Settings from older Beyond SemBr data are normalized on load:
missing booleans receive defaults, malformed lists become empty lists, and invalid idle timeouts reset to the default.

## Audit Checklist

Before a release, verify citation rendering in your target workflow:

- Live Preview keeps isolated sentence-final citations visually attached to the sentence.
- Reading View keeps isolated sentence-final citations visually attached to the sentence.
- Your Pandoc/export workflow treats a line break before `[@key]` as ordinary whitespace.
- BRAT installs from `https://github.com/112345brian/obsidian-beyond-sembr`.
- Release artifacts contain `main.js`, `manifest.json`, and `styles.css`.
- `manifest.json` uses id `beyond-sembr` and name `Beyond SemBr`.
