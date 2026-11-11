import type { Rule } from 'eslint';
export const entryExceptions: readonly { path: string; reason: string }[];
export const entryTranslationPlugin: { rules: Record<string, Rule.RuleModule> };
