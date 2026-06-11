export type AutoApplyMode = 'off' | 'on-idle' | 'on-save';

export function isAutoApplyMode(value: unknown): value is AutoApplyMode {
  return value === 'off' || value === 'on-save' || value === 'on-idle';
}

export const DEFAULT_IDLE_TIMEOUT_SECONDS = 10;
export const MIN_IDLE_TIMEOUT_SECONDS = 1;

export class PluginSettings {
  public autoApply: AutoApplyMode = 'off';
  public customProtectedRegexes: string[] = [];
  public enableCustomProtectedRegexes = true;
  public excludedFolders: string[] = [];
  public excludedFrontmatterRules: string[] = [];
  public excludedNotes: string[] = [];
  public idleTimeoutSeconds: number = DEFAULT_IDLE_TIMEOUT_SECONDS;
  public isolatePandocCitations = true;
  public repairLocatorClusters = true;
  public sentenceOnly = true;
  public showLivePreviewLineBreakMarkers = true;
  public smartPaste = false;
}
