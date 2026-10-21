import 'server-only';
import mongoose, { Schema, type Model } from 'mongoose';
import type { ProviderRate, RateSource } from './providers';

export interface CachedRate extends ProviderRate {
  source: RateSource;
  fetchedAt: string;
}
interface RateTableDocument {
  _id: string;
  entries: CachedRate[];
  attemptedOn?: string;
}
const entry = new Schema<CachedRate>(
  {
    currency: { type: String, required: true },
    rate: { type: String, required: true },
    asOf: { type: String, required: true },
    source: { type: String, enum: ['frankfurter', 'exchange-rate-api'], required: true },
    fetchedAt: { type: String, required: true },
  },
  { _id: false },
);
const schema = new Schema<RateTableDocument>({
  _id: { type: String, required: true },
  entries: { type: [entry], default: [] },
  attemptedOn: String,
});
export const RateTable: Model<RateTableDocument> =
  mongoose.models.ExchangeRateTable ||
  mongoose.model<RateTableDocument>('ExchangeRateTable', schema);
