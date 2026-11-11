import type { GroupCategory } from './types';
export interface DraftContext {
  members: Array<{ id: string; name: string }>;
  tags: Array<{ id: string; name: string }>;
  /** The Group's currency, which an item without its own is in (#512). */
  currency?: string;
  /** The Group's category, which names it as Add expense does: a Trip's currency (#567). */
  category?: GroupCategory;
  /** The member reviewing, called "You" by id, never made the payer (#591). */
  viewerId?: string;
}
