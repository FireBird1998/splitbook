import mongoose, { Schema, Model } from 'mongoose';

/**
 * What the server last saw of a product switch, and since when. The switch itself is an
 * environment variable; this record is how the server remembers, across deployments, that it
 * was off for a while. One document per switch, keyed by name.
 *
 * `recurringExpenses` (#289): written by the first recurring generation run that finds the
 * switch off (`enabled: false`), then by the first run that finds it on again
 * (`enabled: true`, `since` = that run's time). Templates that already existed resume from
 * the month in `since`, so the months it was off are never back-filled.
 */
export interface IProductSwitchDocument {
  _id: string;
  enabled: boolean;
  since: Date;
}

const ProductSwitchSchema = new Schema<IProductSwitchDocument>(
  {
    _id: { type: String, required: true },
    enabled: { type: Boolean, required: true },
    since: { type: Date, required: true },
  },
  { versionKey: false },
);

const ProductSwitch: Model<IProductSwitchDocument> =
  mongoose.models.ProductSwitch ||
  mongoose.model<IProductSwitchDocument>('ProductSwitch', ProductSwitchSchema);

export default ProductSwitch;
