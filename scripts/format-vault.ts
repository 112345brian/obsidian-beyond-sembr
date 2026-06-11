#!/usr/bin/env node
/**
 * Format vault notes with current SemBr settings.
 *
 * Usage:
 *   jiti scripts/format-vault.ts [options] [path]
 *
 * Arguments:
 *   path              Vault root or a single .md file (default: $VAULT env var, required)
 *
 * Options:
 *   --dry-run, -n     Print what would change without writing anything
 *   --verbose, -v     With --dry-run, flag files that mix prose with dialogue /
 *                     transclusions / non-prose lines (worth a manual look)
 *   --sentence-only   Restrict breaks to sentence endings (default: true)
 *   --no-sentence-only  Also break at clause boundaries (, ; :)
 *   --isolate-citations  Isolate sentence-final pandoc citations (default: true)
 *   --no-isolate-citations
 *   --no-repair-locators  Disable locator-cluster repair
 *   --help, -h        Show this message
 */

/* eslint-disable no-console -- This is a CLI script; console.log is the intended output mechanism. */
import fs from 'node:fs';
import path from 'node:path';

import {
  createTransformNoteContentOptions,
  isNonProseLine,
  transformNoteContent
} from '../src/Formatter.ts';

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_VAULT = process.env['VAULT'];

const EXCLUDED_DIR_PREFIXES = ['.obsidian', '.trash', '.versiondb', '.git'];

function hasMixedContent(content: string): boolean {
  const body = content.replace(/^---\n[\s\S]*?\n---\n/u, '');
  const paragraphs = body.split(/\n{2,}/u).map((p) => p.trim()).filter(Boolean);
  let hasNonProse = false;
  let hasProse = false;
  for (const para of paragraphs) {
    const lines = para.split('\n');
    const nonProseLines = lines.filter((l) => isNonProseLine(l));
    const proseLines = lines.filter((l) => l.length > 0 && !isNonProseLine(l));
    if (nonProseLines.length > 0) {
      hasNonProse = true;
    }
    if (proseLines.length > 0) {
      hasProse = true;
    }
    // A paragraph that mixes both is the risky case
    if (nonProseLines.length > 0 && proseLines.length > 0) {
      return true;
    }
  }
  // Also flag if file has both prose and non-prose paragraphs side-by-side
  return hasNonProse && hasProse;
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

const ARGV_ARGS_START = 2;
const args = process.argv.slice(ARGV_ARGS_START);

function hasFlag(...names: string[]): boolean {
  return names.some((n) => args.includes(n));
}

if (hasFlag('--help', '-h')) {
  const src = fs.readFileSync(new URL(import.meta.url).pathname, 'utf8');
  console.log((/\/\*\*(?<jsdoc>[\s\S]*?)\*\//.exec(src))?.groups?.['jsdoc']?.replace(/^ \* ?/gm, '') ?? '');
  process.exit(0);
}

const dryRun = hasFlag('--dry-run', '-n');
const verbose = hasFlag('--verbose', '-v');
const sentenceOnly = !hasFlag('--no-sentence-only');
const isolatePandocCitations = !hasFlag('--no-isolate-citations');
const repairLocatorClusters = !hasFlag('--no-repair-locators');

const positional = args.filter((a) => !a.startsWith('-'));
const targetPath = positional[0] ?? DEFAULT_VAULT;

if (!targetPath) {
  console.error('Error: no vault path given. Pass a path as an argument or set the VAULT environment variable.');
  process.exit(1);
}

// ── Transform options ─────────────────────────────────────────────────────────

const options = createTransformNoteContentOptions({
  customProtectedRegexes: [],
  enableCustomProtectedRegexes: false,
  isolatePandocCitations,
  repairLocatorClusters,
  sentenceOnly
});

// ── File collection ───────────────────────────────────────────────────────────

function collectMarkdownFiles(target: string): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return [];
  }
  if (stat.isFile()) {
    return target.endsWith('.md') ? [target] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  const results: string[] = [];
  for (const entry of fs.readdirSync(target)) {
    if (EXCLUDED_DIR_PREFIXES.some((p) => entry.startsWith(p))) {
      continue;
    }
    results.push(...collectMarkdownFiles(path.join(target, entry)));
  }
  return results;
}

const files = collectMarkdownFiles(path.resolve(targetPath));

// ── Run ───────────────────────────────────────────────────────────────────────

let changed = 0;
let skipped = 0;
let errors = 0;
let flagged = 0;

for (const file of files) {
  try {
    const original = fs.readFileSync(file, 'utf8');
    const formatted = transformNoteContent(original, 'add', options);
    const rel = path.relative(process.cwd(), file);

    if (formatted === original) {
      skipped++;
      continue;
    }

    changed++;
    const mixed = verbose && hasMixedContent(original);
    if (mixed) {
      flagged++;
    }

    if (dryRun) {
      const tag = mixed ? '[review]      ' : '[would change] ';
      console.log(`${tag}${rel}`);
    } else {
      fs.writeFileSync(file, formatted, 'utf8');
      const tag = mixed ? '[changed/mixed]' : '[changed]      ';
      console.log(`${tag} ${rel}`);
    }
  } catch (err) {
    errors++;
    console.error(`[error]        ${path.relative(process.cwd(), file)}: ${String(err)}`);
  }
}

const verb = dryRun ? 'Would change' : 'Changed';
console.log(`\n${verb} ${String(changed)} file(s), skipped ${String(skipped)} already-formatted, ${String(errors)} error(s).`);
if (verbose && flagged > 0) {
  console.log(`${String(flagged)} file(s) flagged [review] — mixed prose/non-prose content, worth a manual look.`);
}
if (dryRun && changed > 0) {
  console.log('Re-run without --dry-run to apply.');
}
/* eslint-enable no-console -- re-enable after CLI output section */
