export type AutoApplyMode = 'off' | 'on-idle' | 'on-save';

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 10;
export const MIN_IDLE_TIMEOUT_SECONDS = 1;

export class PluginSettings {
  public autoApply: AutoApplyMode = 'off';
  public customProtectedRegexes: string[] = [];
  public excludedFolders: string[] = [];
  public excludedFrontmatterRules: string[] = [];
  public excludedNotes: string[] = [];
  public idleTimeoutSeconds: number = DEFAULT_IDLE_TIMEOUT_SECONDS;
  public isolatePandocCitations = true;
  public showLivePreviewLineBreakMarkers = true;
}
