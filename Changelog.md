# Changelog

## Unreleased

- Rename plugin and package from Semantic Line Breaker / `obsidian-sembr` to Beyond SemBr / `obsidian-beyond-sembr`
- Rename Obsidian plugin id to `beyond-sembr`
- Treat page/location locator clusters such as `Pg. 193 A51/B75` as indivisible citation metadata and repair already-broken locator splits
- Add custom protected regex settings so users can define additional spans that must not be split

## 0.9.0 — 2026-06-08

- Per-paragraph toggle detection: each paragraph independently adds, removes, or skips sembr based on line-length heuristics
- Short lines (< 25 chars) cause a paragraph to be skipped — protects poetry, verse, and short-form content
- `sembr: false` / `sembr: force` front matter key overrides global exclusion settings per file
- `<!-- sembr-off -->` / `<!-- sembr-on -->` inline escape hatch: regions are never touched and invisible in reading view and export
- New command: "Wrap selection with sembr-off block" wraps the current selection in escape-hatch comments
- Migrated to mnaoumov/generator-obsidian-plugin toolchain

## 0.8.0 — 2024-01-01

- Settings panel: exclude folders, notes, and front matter rules from sembr processing
- Smarter block exclusions: headings, lists, tables, blockquotes, and code blocks are never touched
- URL and inline code extraction to prevent mid-content breaks

## 0.7.0 — 2022-06-07

- Prevent splitting footnotes and pandoc citations

## 0.6.0 — 2022-06-01

- Ignore fenced code blocks

## 0.5.x — 2022-05-19 to 2022-05-20

- Initial release and early bug fixes
- Minimum line length before sembr applies
- Fix deconverting sembr when merging blockquotes and lists
