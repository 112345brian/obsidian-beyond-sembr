import {
  App,
  PluginSettingTab,
  Setting
} from 'obsidian';
import { convertAsyncToSync } from 'obsidian-dev-utils/async';

import type { Plugin } from './Plugin.ts';

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
