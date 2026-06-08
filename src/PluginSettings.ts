export class PluginSettings {
  // Folder paths (e.g. "recipes", "personal/journal"). Any note inside
  // These folders will be skipped by the sembr command.
  public excludedFolders: string[] = [];

  // Frontmatter exclusion rules. Each entry is a string of the form:
  //   "key"           — exclude if the key exists with any value
  //   "key: value"    — exclude if the key equals this specific value
  // Example: "up: [[Recipe]]" skips any note with that breadcrumb.
  public excludedFrontmatterRules: string[] = [];

  // Specific note paths (e.g. "inbox.md", "templates/book.md").
  public excludedNotes: string[] = [];
}
