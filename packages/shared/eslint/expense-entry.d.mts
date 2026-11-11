import type { Linter, Rule } from 'eslint';
export const entryExceptions: readonly { path: string; reason: string }[];
export const entryTranslationPlugin: { rules: Record<string, Rule.RuleModule> };

export function expenseEntryLint(root: string): Linter.Config[];
