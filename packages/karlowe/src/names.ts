/** Harlowe macro names ignore ASCII case, dashes and underscores. */
export const harloweMacroName = (name: string): string => name.toLowerCase().replaceAll(/[-_]/g, '');
