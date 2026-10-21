import { z } from 'zod';

/** Optional on older Activity and single payments; a batch keeps its first Settlement's id. */
export const settlementBatchActivityShape = {
  batchId: z.string().min(1).optional(),
  batchSize: z.number().int().min(1).optional(),
};
