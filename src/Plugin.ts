import type { Extension } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type {
  Editor,
  MarkdownFileInfo,
  TAbstractFile
} from 'obsidian';

import {
  EditorState,
  RangeSetBuilder,
  StateField
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType
} from '@codemirror/view';
import {
  editorLivePreviewField,
  MarkdownView,
  Plugin as ObsidianPlugin,
  TFile
} from 'obsidian';

import type { PluginSettings as PluginSettingsData } from './PluginSettings.ts';

import {
  createTransformNoteContentOptions,
  shouldCollapseNewline,
  shouldMarkSemBrLineBreak,
  transformNoteContent
} from './Formatter.ts';
import {
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  MIN_IDLE_TIMEOUT_SECONDS,
  PluginSettings
} from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

const FRONTMATTER_RULE_SEPARATOR = ': ';
const MS_PER_SECOND = 1000;
const SEMBR_FRONTMATTER_FORCE = 'force';
const SEMBR_FRONTMATTER_KEY = 'sembr';
const SEMBR_FRONTMATTER_OFF = 'false';

class SemBrLineBreakMarkerWidget extends WidgetType {
  public override eq(widget: WidgetType): boolean {
    return widget instanceof SemBrLineBreakMarkerWidget;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement('span');
    span.addClass('sembr-live-preview-break-marker');
    span.ariaHidden = 'true';
    span.textContent = '^';
    return span;
  }
}

class SemBrSpaceWidget extends WidgetType {
  public override eq(widget: WidgetType): boolean {
    return widget instanceof SemBrSpaceWidget;
  }

  public override toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement('span');
    span.ariaHidden = 'true';
    span.textContent = ' ';
    return span;
  }
}

export class Plugin extends ObsidianPlugin {
  public override settings: PluginSettingsData = new PluginSettings();
  private readonly editorExtensions: Extension[] = [];
  private idleTimer: null | number = null;
  private semBrStateField: null | StateField<DecorationSet> = null;

  public isFileEnabledForSemBr(file: TFile): boolean {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const override = this.getSemBrFrontmatterOverride(frontmatter);
    if (override === 'false') {
      return false;
    }
    if (override !== 'force' && this.isNoteExcluded(file, frontmatter)) {
      return false;
    }
    return true;
  }

  public override async onload(): Promise<void> {
    await this.loadSettings();
    this.editorExtensions.push(...this.getEditorExtensions());
    this.registerEditorExtension(this.editorExtensions);
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
    this.setupAutoApply();
  }

  public override onunload(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  public refreshEditorExtensions(): void {
    this.semBrStateField = null;
    this.editorExtensions.splice(0, this.editorExtensions.length, ...this.getEditorExtensions());
    this.app.workspace.updateOptions();
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private applyAddSemBr(editor: Editor, file: TFile): void {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const override = this.getSemBrFrontmatterOverride(frontmatter);
    if (override === 'false') {
      return;
    }
    if (override !== 'force' && this.isNoteExcluded(file, frontmatter)) {
      return;
    }
    const oldContent = editor.getValue();
    const newContent = transformNoteContent(oldContent, 'add', this.getTransformOptions());
    if (newContent === oldContent) {
      return;
    }
    editor.setValue(newContent);
  }

  private getEditorExtensions(): Extension[] {
    if (!this.settings.showLivePreviewLineBreakMarkers) {
      return [];
    }
    this.semBrStateField ??= createSemBrStateField(this);
    return [this.semBrStateField];
  }

  private getSemBrFrontmatterOverride(frontmatter: null | Record<string, unknown>): 'false' | 'force' | null {
    if (!frontmatter) {
      return null;
    }
    const raw = frontmatter[SEMBR_FRONTMATTER_KEY];
    if (raw === false || raw === SEMBR_FRONTMATTER_OFF) {
      return 'false';
    }
    if (raw === SEMBR_FRONTMATTER_FORCE) {
      return 'force';
    }
    return null;
  }

  private getTransformOptions(): ReturnType<typeof createTransformNoteContentOptions> {
    return createTransformNoteContentOptions(this.settings);
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
          const rawVal = frontmatter[key];
          if (
            (typeof rawVal === 'string' || typeof rawVal === 'number' || typeof rawVal === 'boolean')
            && String(rawVal) === ruleValue
          ) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private async loadSettings(): Promise<void> {
    this.settings = Object.assign(new PluginSettings(), await this.loadData() as Partial<PluginSettingsData>);
    if (!isAutoApplyMode(this.settings.autoApply)) {
      this.settings.autoApply = 'off';
    }
    this.settings.customProtectedRegexes = normalizeStringList(this.settings.customProtectedRegexes);
    this.settings.enableCustomProtectedRegexes = normalizeBoolean(this.settings.enableCustomProtectedRegexes, true);
    this.settings.excludedFolders = normalizeStringList(this.settings.excludedFolders);
    this.settings.excludedFrontmatterRules = normalizeStringList(this.settings.excludedFrontmatterRules);
    this.settings.excludedNotes = normalizeStringList(this.settings.excludedNotes);
    this.settings.isolatePandocCitations = normalizeBoolean(this.settings.isolatePandocCitations, true);
    this.settings.repairLocatorClusters = normalizeBoolean(this.settings.repairLocatorClusters, true);
    this.settings.showLivePreviewLineBreakMarkers = normalizeBoolean(this.settings.showLivePreviewLineBreakMarkers, true);
    if (!Number.isFinite(this.settings.idleTimeoutSeconds) || this.settings.idleTimeoutSeconds < MIN_IDLE_TIMEOUT_SECONDS) {
      this.settings.idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS;
    }
  }

  private setupAutoApply(): void {
    this.registerEvent(
      this.app.vault.on('modify', (abstractFile: TAbstractFile) => {
        if (this.settings.autoApply !== 'on-save') {
          return;
        }
        if (!(abstractFile instanceof TFile)) {
          return;
        }
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view?.file !== abstractFile) {
          return;
        }
        this.applyAddSemBr(view.editor, abstractFile);
      })
    );

    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor, info: MarkdownFileInfo) => {
        if (this.settings.autoApply !== 'on-idle') {
          return;
        }
        if (this.idleTimer !== null) {
          window.clearTimeout(this.idleTimer);
        }
        const { file } = info;
        if (!file) {
          return;
        }
        this.idleTimer = window.setTimeout(() => {
          this.idleTimer = null;
          if (this.settings.autoApply !== 'on-idle') {
            return;
          }
          if (this.app.workspace.getActiveFile() !== file) {
            return;
          }
          this.applyAddSemBr(editor, file);
        }, this.settings.idleTimeoutSeconds * MS_PER_SECOND);
      })
    );
  }

  private toggleSemBr(editor: Editor): void {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      return;
    }

    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter ?? null;
    const override = this.getSemBrFrontmatterOverride(frontmatter);

    if (override === 'false') {
      return;
    }

    if (override !== 'force' && this.isNoteExcluded(file, frontmatter)) {
      return;
    }

    editor.setValue(transformNoteContent(editor.getValue(), 'toggle', this.getTransformOptions()));
  }
}

function buildSemBrDecorations(state: EditorState, plugin: Plugin): DecorationSet {
  // @ts-expect-error Obsidian's StateField type is nominally distinct from the direct CodeMirror import.
  if (!state.field(editorLivePreviewField, false)) {
    return Decoration.none;
  }

  const activeFile = plugin.app.workspace.getActiveFile();
  if (activeFile && !plugin.isFileEnabledForSemBr(activeFile)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    if (shouldMarkSemBrLineBreak(line.text, lineNum, doc)) {
      builder.add(line.to, line.to + 1, semBrLineBreakMarkerDecoration);
    } else if (shouldCollapseNewline(line.text, lineNum, doc)) {
      builder.add(line.to, line.to + 1, semBrSpaceDecoration);
    }
  }

  return builder.finish();
}

function createSemBrStateField(plugin: Plugin): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create: (state) => buildSemBrDecorations(state, plugin),
    provide: (f) => EditorView.decorations.from(f),
    update: (decorations, tr) => tr.docChanged ? buildSemBrDecorations(tr.state, plugin) : decorations.map(tr.changes)
  });
}

function isAutoApplyMode(value: unknown): value is PluginSettingsData['autoApply'] {
  return value === 'off' || value === 'on-save' || value === 'on-idle';
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean);
}

const semBrSpaceDecoration = Decoration.replace({
  widget: new SemBrSpaceWidget()
});

const semBrLineBreakMarkerDecoration = Decoration.replace({
  widget: new SemBrLineBreakMarkerWidget()
});

function wrapSelectionWithSemBrOff(editor: Editor): void {
  const selection = editor.getSelection();
  const wrapped = `<!-- sembr-off -->\n${selection}\n<!-- sembr-on -->`;
  editor.replaceSelection(wrapped);
}
