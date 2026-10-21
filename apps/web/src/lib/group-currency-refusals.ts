import type { ExtraCurrencyUse } from '@splitbook/shared/group-currency-settings';

/**
 * An extra currency that can't be removed yet (#721): an Expense, a Settlement or a To review
 * item still uses it. It carries what uses it, as the viewer may see it, for the settings to list.
 */
export class CurrencyInUseError extends Error {
  readonly code = 'CURRENCY_IN_USE';

  constructor(
    currency: string,
    groupName: string,
    readonly use: ExtraCurrencyUse,
  ) {
    super(`${currency} can’t be removed while ${groupName} uses it.`);
    this.name = 'CurrencyInUseError';
  }
}

/** A currency to remove that isn't one of the Group's extra currencies. */
export class CurrencyNotListedError extends Error {
  readonly code = 'CURRENCY_NOT_LISTED';

  constructor(currency: string) {
    super(`${currency} isn’t one of this Group’s extra currencies.`);
    this.name = 'CurrencyNotListedError';
  }
}

/** The Group's main currency, which can't be removed: a conflict with its state, like its lock. */
export class CurrencyIsMainError extends Error {
  readonly code = 'CURRENCY_IS_MAIN';

  constructor(currency: string) {
    super(`${currency} is the main currency, so it can’t be removed.`);
    this.name = 'CurrencyIsMainError';
  }
}
