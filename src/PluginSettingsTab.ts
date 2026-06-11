import {
  App,
  PluginSettingTab,
  Setting
} from 'obsidian';
import { convertAsyncToSync } from 'obsidian-dev-utils/async';

import type { Plugin } from './Plugin.ts';

import {
  isAutoApplyMode,
  MIN_IDLE_TIMEOUT_SECONDS
} from './PluginSettings.ts';

const TEXTAREA_ROWS = 5;

export class PluginSettingsTab extends PluginSettingTab {
  private readonly plugin: Plugin;

  public constructor(app: App, plugin: Plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  public override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Auto-apply ─────────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName('Auto-apply')
      .setDesc('Automatically apply semantic line breaks without running the command manually.')
      .addDropdown((dropdown) => {
        dropdown
          .addOption('off', 'Off — manual command only')
          .addOption('on-save', 'On save')
          .addOption('on-idle', 'After idle')
          .setValue(this.plugin.settings.autoApply)
          .onChange(convertAsyncToSync(async (value: string) => {
            if (!isAutoApplyMode(value)) {
              return;
            }
            this.plugin.settings.autoApply = value;
            await this.plugin.saveSettings();
          }));
      });

    // ── Idle timeout ───────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName('Idle timeout (seconds)')
      .setDesc('When "after idle" is selected, apply sembr after this many seconds of not typing.')
      .addText((text) => {
        text
          .setValue(String(this.plugin.settings.idleTimeoutSeconds))
          .onChange(convertAsyncToSync(async (value: string) => {
            const parsed = Number.parseFloat(value);
            if (!Number.isFinite(parsed) || parsed < MIN_IDLE_TIMEOUT_SECONDS) {
              return;
            }
            this.plugin.settings.idleTimeoutSeconds = parsed;
            await this.plugin.saveSettings();
          }));
      });

    // ── Pandoc citations ──────────────────────────────────────────────────

    new Setting(containerEl)
      .setName('Isolate pandoc citations')
      .setDesc('Put sentence-final bracketed pandoc citations on their own line for cleaner diffs.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.isolatePandocCitations)
          .onChange(convertAsyncToSync(async (value: boolean) => {
            this.plugin.settings.isolatePandocCitations = value;
            await this.plugin.saveSettings();
          }));
      });

    new Setting(containerEl)
      .setName('Show line break markers')
      .setDesc('Show subtle markers for semantic line breaks in live preview.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showLivePreviewLineBreakMarkers)
          .onChange(convertAsyncToSync(async (value: boolean) => {
            this.plugin.settings.showLivePreviewLineBreakMarkers = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditorExtensions();
          }));
      });

    new Setting(containerEl)
      .setName('Repair locator clusters')
      .setDesc('Join page or location references back together if a prior format split them across lines.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.repairLocatorClusters)
          .onChange(convertAsyncToSync(async (value: boolean) => {
            this.plugin.settings.repairLocatorClusters = value;
            await this.plugin.saveSettings();
          }));
      });

    new Setting(containerEl)
      .setName('Sentence-only breaks')
      .setDesc('Only insert line breaks at sentence endings (. ? ! …). When off, breaks are also inserted at clause boundaries (, ; :).')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.sentenceOnly)
          .onChange(convertAsyncToSync(async (value: boolean) => {
            this.plugin.settings.sentenceOnly = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditorExtensions();
          }));
      });

    new Setting(containerEl)
      .setName('Smart paste')
      .setDesc('Automatically apply semantic line breaks when pasting text that does not already have them.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.smartPaste)
          .onChange(convertAsyncToSync(async (value: boolean) => {
            this.plugin.settings.smartPaste = value;
            await this.plugin.saveSettings();
            this.plugin.refreshEditorExtensions();
          }));
      });

    new Setting(containerEl)
      .setName('Use custom protected regexes')
      .setDesc('Apply the custom regex list below when protecting spans from line breaks.')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.enableCustomProtectedRegexes)
          .onChange(convertAsyncToSync(async (value: boolean) => {
            this.plugin.settings.enableCustomProtectedRegexes = value;
            await this.plugin.saveSettings();
          }));
      });

    new Setting(containerEl)
      .setName('Custom protected regexes')
      .setDesc('Protect custom spans from line breaks. One JavaScript regex per line, as source or /source/flags.')
      .addTextArea((text) => {
        text
          .setPlaceholder('ISBN\\s+\\d[\\d-]+\\n/[A-Z]{2}\\d+\\/B\\d+/u')
          .setValue(this.plugin.settings.customProtectedRegexes.join('\n'))
          .onChange(convertAsyncToSync(async (value: string) => {
            this.plugin.settings.customProtectedRegexes = splitLines(value);
            await this.plugin.saveSettings();
          }));
        text.inputEl.rows = TEXTAREA_ROWS;
        text.inputEl.addClass('sembr-settings-textarea');
      });

    // ── Excluded folders ───────────────────────────────────────────────────

    new Setting(containerEl)
      .setName('Excluded folders')
      .setDesc('Skip all notes inside these folders. One folder path per line (e.g. "recipes" or "personal/journal").')
      .addTextArea((text) => {
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder shows file paths, lowercase is correct
          .setPlaceholder('recipes\npersonal/journal')
          .setValue(this.plugin.settings.excludedFolders.join('\n'))
          .onChange(convertAsyncToSync(async (value: string) => {
            this.plugin.settings.excludedFolders = splitLines(value);
            await this.plugin.saveSettings();
          }));
        text.inputEl.rows = TEXTAREA_ROWS;
        text.inputEl.addClass('sembr-settings-textarea');
      });

    // ── Excluded notes ─────────────────────────────────────────────────────

    new Setting(containerEl)
      .setName('Excluded notes')
      .setDesc('Skip these specific notes. One path per line (e.g. "inbox.md" or "templates/book.md").')
      .addTextArea((text) => {
        text
          .setPlaceholder('inbox.md\ntemplates/book.md')
          .setValue(this.plugin.settings.excludedNotes.join('\n'))
          .onChange(convertAsyncToSync(async (value: string) => {
            this.plugin.settings.excludedNotes = splitLines(value);
            await this.plugin.saveSettings();
          }));
        text.inputEl.rows = TEXTAREA_ROWS;
        text.inputEl.addClass('sembr-settings-textarea');
      });

    // ── Frontmatter exclusion rules ────────────────────────────────────────

    new Setting(containerEl)
      .setName('Excluded frontmatter rules')
      .setDesc(
        'Skip notes matching these frontmatter conditions. One rule per line. '
          + 'Format: "key" (any value) or "key: value" (exact match). '
          + 'Example: "up: [[Recipe]]" skips any note with that breadcrumb.'
      )
      .addTextArea((text) => {
        text
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- placeholder shows frontmatter keys, lowercase is correct
          .setPlaceholder('up: [[Recipe]]\ntags: private')
          .setValue(this.plugin.settings.excludedFrontmatterRules.join('\n'))
          .onChange(convertAsyncToSync(async (value: string) => {
            this.plugin.settings.excludedFrontmatterRules = splitLines(value);
            await this.plugin.saveSettings();
          }));
        text.inputEl.rows = TEXTAREA_ROWS;
        text.inputEl.addClass('sembr-settings-textarea');
      });
  }
}

function splitLines(value: string): string[] {
  return value.split('\n').map((s) => s.trim()).filter(Boolean);
}
