/**
 * A Group's Assistant rule (#621): whether its members' Connected assistants may reach it at all.
 * Allowed is the default, and a Group stored without a rule is Allowed.
 */
export const ASSISTANT_RULES = ['allowed', 'not_allowed'] as const;
export type AssistantRule = (typeof ASSISTANT_RULES)[number];

/** The rule as members read it, on the web and on Android. */
export const ASSISTANT_RULE_LABELS: Record<AssistantRule, string> = {
  allowed: 'Allowed',
  not_allowed: 'Not allowed',
};
