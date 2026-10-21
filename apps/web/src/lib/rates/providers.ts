import 'server-only';

export type RateSource = 'frankfurter' | 'exchange-rate-api';
/** Every entry is units of currency per USD, with the provider's calendar day. */
export interface ProviderRate {
  currency: string;
  rate: string;
  asOf: string;
}
export interface RateProvider {
  readonly source: RateSource;
  fetchTable(): Promise<ProviderRate[]>;
}
export interface RateProviders {
  primary: RateProvider;
  fallback: RateProvider;
}
