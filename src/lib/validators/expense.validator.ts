import { z } from "zod/v4";
import { CURRENCY_CODES } from "@/lib/utils/currency";
import { CATEGORY_IDS } from "@/lib/constants/categories";

export const createExpenseSchema = z.object({
  description: z.string().min(1, "Description is required").max(200).trim(),
  amount: z.number().positive("Amount must be positive").max(10_000_000),
  currency: z.string().refine((val) => CURRENCY_CODES.includes(val), {
    message: "Invalid currency code",
  }),
  category: z.string().default("other"),
  date: z.coerce.date(),
  paidBy: z
    .array(
      z.object({
        user: z.string().min(1),
        amount: z.number().nonnegative(),
      })
    )
    .min(1, "At least one payer is required"),
  splitMethod: z.enum(["equal", "unequal", "percentage", "shares", "exact"]),
  splitBetween: z
    .array(
      z.object({
        user: z.string().min(1),
        amount: z.number().nonnegative().optional(),
        percentage: z.number().min(0).max(100).optional(),
        shares: z.number().int().min(0).optional(),
      })
    )
    .min(1, "At least one person must be in the split"),
  tag: z.string().min(1, "Tag is required").trim(),
  predefinedItem: z.string().nullable().optional(),
  notes: z.string().max(500).trim().optional(),
});

export const updateExpenseSchema = createExpenseSchema.partial().extend({
  isDeleted: z.literal(false).optional(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

