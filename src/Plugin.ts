import type { Extension } from '@codemirror/state';
import type { DecorationSet } from '@codemirror/view';
import type {
  Editor,
  MarkdownFileInfo,
  TAbstractFile
} from 'obsidian';

import {
  EditorState,
  Facet,
  Prec,
  RangeSetBuilder,
  StateField
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  WidgetType
} from '@codemirror/view';
import {
  editorInfoField,
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
  isAutoApplyMode,
  MIN_IDLE_TIMEOUT_SECONDS,
  PluginSettings
} from './PluginSettings.ts';
import { PluginSettingsTab } from './PluginSettingsTab.ts';

interface ObsidianEditorInfoField {
  readonly file?: TFile;
}

interface ObsidianEditorWithCm {
  readonly cm?: EditorView;
}

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
  private readonly lastFormattedContent = new Map<string, string>();

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
    this.addCommand({
      editorCallback: async (editor: Editor): Promise<void> => {
        await this.copyWithoutSemBr(editor);
      },
      id: 'copy-without-sembr',
      name: 'Copy without semantic line breaks'
    });
    this.addCommand({
      editorCallback: async (editor: Editor): Promise<void> => {
        await this.pasteWithSemBr(editor);
      },
      id: 'paste-with-sembr',
      name: 'Paste with semantic line breaks'
    });
    this.setupAutoApply();
    this.registerEvent(
      this.app.vault.on('delete', (abstractFile: TAbstractFile) => {
        this.lastFormattedContent.delete(abstractFile.path);
      })
    );
    this.registerEvent(
      this.app.vault.on('rename', (abstractFile: TAbstractFile, oldPath: string) => {
        this.lastFormattedContent.delete(oldPath);
        this.lastFormattedContent.delete(abstractFile.path);
      })
    );
  }

  public override onunload(): void {
    if (this.idleTimer !== null) {
      window.clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  public refreshEditorExtensions(): void {
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
    // Record what we're about to write so the vault 'modify' event we trigger
    // Can be recognised as our own write and skipped (prevents a format loop).
    this.lastFormattedContent.set(file.path, newContent);
    this.replaceEditorContent(editor, oldContent, newContent);
  }

  private async copyWithoutSemBr(editor: Editor): Promise<void> {
    const selected = editor.getSelection();
    if (!selected) {
      return;
    }
    const transformed = transformNoteContent(selected, 'remove', this.getTransformOptions());
    await navigator.clipboard.writeText(transformed.trimEnd());
  }

  private getEditorExtensions(): Extension[] {
    const extensions: Extension[] = [];
    if (this.settings.showLivePreviewLineBreakMarkers) {
      extensions.push(
        semBrExclusionFacet.of((file) => this.isFileEnabledForSemBr(file)),
        semBrSentenceOnlyFacet.of(this.settings.sentenceOnly),
        semBrLineBreakMarkerStateField
      );
    }
    if (this.settings.smartCopy) {
      extensions.push(this.getSmartCopyExtension());
    }
    if (this.settings.smartPaste) {
      extensions.push(this.getSmartPasteExtension());
    }
    return extensions;
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

  private getSmartCopyExtension(): Extension {
    return Prec.highest(keymap.of([{
      key: 'Mod-c',
      run: (view: EditorView): boolean => {
        const { state } = view;
        const selectedText = state.sliceDoc(state.selection.main.from, state.selection.main.to);
        if (!selectedText) {
          return false;
        }
        // @ts-expect-error -- Obsidian's StateField type is nominally distinct from the direct CodeMirror import.
        const file = (view.state.field(editorInfoField, false) as ObsidianEditorInfoField | undefined)?.file ?? null;
        if (file !== null && !this.isFileEnabledForSemBr(file)) {
          return false;
        }
        const transformed = transformNoteContent(selectedText, 'remove', this.getTransformOptions());
        navigator.clipboard.writeText(transformed.trimEnd()).catch(() => {/* Clipboard access denied */});
        return true;
      }
    }]));
  }

  private getSmartPasteExtension(): Extension {
    return EditorView.domEventHandlers({
      paste: (event: ClipboardEvent, view: EditorView): boolean => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) {
          return false;
        }
        // @ts-expect-error -- Obsidian's StateField type is nominally distinct from the direct CodeMirror import.
        const file = (view.state.field(editorInfoField, false) as ObsidianEditorInfoField | undefined)?.file ?? null;
        if (file !== null && !this.isFileEnabledForSemBr(file)) {
          return false;
        }
        const transformed = transformNoteContent(text, 'add', this.getTransformOptions());
        if (transformed.trimEnd() === text.trimEnd()) {
          return false;
        }
        event.preventDefault();
        view.dispatch(view.state.replaceSelection(transformed.trimEnd()));
        return true;
      }
    });
  }

  private getTransformOptions(): ReturnType<typeof createTransformNoteContentOptions> {
    return createTransformNoteContentOptions(this.settings);
  }

  private isFileEnabledForSemBr(file: TFile): boolean {
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

  private isNoteExcluded(file: TFile, frontmatter: null | Record<string, unknown>): boolean {
    const { excludedFolders, excludedFrontmatterRules, excludedNotes } = this.settings;

    if (excludedNotes.some((note) => file.path === note)) {
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
    this.settings.sentenceOnly = normalizeBoolean(this.settings.sentenceOnly, true);
    this.settings.showLivePreviewLineBreakMarkers = normalizeBoolean(this.settings.showLivePreviewLineBreakMarkers, true);
    this.settings.smartCopy = normalizeBoolean(this.settings.smartCopy, true);
    this.settings.smartPaste = normalizeBoolean(this.settings.smartPaste, false);
    if (!Number.isFinite(this.settings.idleTimeoutSeconds) || this.settings.idleTimeoutSeconds < MIN_IDLE_TIMEOUT_SECONDS) {
      this.settings.idleTimeoutSeconds = DEFAULT_IDLE_TIMEOUT_SECONDS;
    }
  }

  private async pasteWithSemBr(editor: Editor): Promise<void> {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        return;
      }
      const transformed = transformNoteContent(text, 'add', this.getTransformOptions());
      editor.replaceSelection(transformed.trimEnd());
    } catch {
      // Clipboard access denied — fall back silently
    }
  }

  /**
   * Replace the editor content while keeping the caret where the user left it.
   *
   * `editor.setValue()` swaps the whole document and resets the cursor to the
   * top, which yanks the caret away mid-edit on every auto-apply. Instead we
   * diff old vs. new down to the changed middle (common prefix + suffix) and
   * dispatch that single change through the underlying CodeMirror view, which
   * maps the existing selection through the change automatically. Falls back to
   * `setValue` only when the CM view is unreachable.
   */
  private replaceEditorContent(editor: Editor, oldContent: string, newContent: string): void {
    // eslint-disable-next-line no-restricted-syntax -- Obsidian's Editor does not expose `.cm` publicly; reaching the CodeMirror view requires casting through `unknown`.
    const view = (editor as unknown as ObsidianEditorWithCm).cm;
    if (!(view instanceof EditorView)) {
      editor.setValue(newContent);
      return;
    }

    const maxPrefix = Math.min(oldContent.length, newContent.length);
    let prefix = 0;
    while (prefix < maxPrefix && oldContent[prefix] === newContent[prefix]) {
      prefix++;
    }
    let suffix = 0;
    const maxSuffix = maxPrefix - prefix;
    while (
      suffix < maxSuffix
      && oldContent[oldContent.length - 1 - suffix] === newContent[newContent.length - 1 - suffix]
    ) {
      suffix++;
    }

    view.dispatch({
      changes: {
        from: prefix,
        insert: newContent.slice(prefix, newContent.length - suffix),
        to: oldContent.length - suffix
      }
    });
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
        const currentContent = view.editor.getValue();
        if (this.lastFormattedContent.get(abstractFile.path) === currentContent) {
          this.lastFormattedContent.delete(abstractFile.path);
          return;
        }
        this.applyAddSemBr(view.editor, abstractFile);
      })
    );

    this.registerEvent(
      this.app.workspace.on('editor-change', (_editor: Editor, info: MarkdownFileInfo) => {
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
          // Re-fetch the active view at fire time so we dispatch into whichever
          // Editor pane is actually showing the file, not the one that was open
          // When the keystroke was recorded.
          const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
          if (!activeView?.editor) {
            return;
          }
          this.applyAddSemBr(activeView.editor, file);
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

    const oldContent = editor.getValue();
    const newContent = transformNoteContent(oldContent, 'toggle', this.getTransformOptions());
    if (newContent === oldContent) {
      return;
    }
    this.replaceEditorContent(editor, oldContent, newContent);
  }
}

const semBrExclusionFacet = Facet.define<(file: TFile) => boolean, ((file: TFile) => boolean) | null>({
  combine: (checkers) => checkers[0] ?? null
});

const semBrSentenceOnlyFacet = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? true
});

function buildSemBrDecorations(state: EditorState): DecorationSet {
  // @ts-expect-error Obsidian's StateField type is nominally distinct from the direct CodeMirror import.
  if (!state.field(editorLivePreviewField, false)) {
    return Decoration.none;
  }

  const isFileEnabled = state.facet(semBrExclusionFacet);
  if (isFileEnabled !== null) {
    // @ts-expect-error Obsidian's StateField type is nominally distinct from the direct CodeMirror import.
    const file = (state.field(editorInfoField, false))?.file ?? null;
    if (file !== null && !isFileEnabled(file)) {
      return Decoration.none;
    }
  }

  const sentenceOnly = state.facet(semBrSentenceOnlyFacet);
  const builder = new RangeSetBuilder<Decoration>();
  const doc = state.doc;

  for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
    const line = doc.line(lineNum);
    if (shouldMarkSemBrLineBreak(line.text, lineNum, doc, sentenceOnly)) {
      builder.add(line.to, line.to + 1, semBrLineBreakMarkerDecoration);
    } else if (shouldCollapseNewline(line.text, lineNum, doc)) {
      builder.add(line.to, line.to + 1, semBrSpaceDecoration);
    }
  }

  return builder.finish();
}

const semBrLineBreakMarkerStateField = StateField.define<DecorationSet>({
  create: (state) => buildSemBrDecorations(state),
  provide: (f) => EditorView.decorations.from(f),
  update: (decorations, tr) => (tr.docChanged || tr.reconfigured) ? buildSemBrDecorations(tr.state) : decorations.map(tr.changes)
});

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
