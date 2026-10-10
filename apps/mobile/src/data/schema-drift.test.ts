import { describe, expect, it } from 'vitest';
import { createGroupSchema } from '@splitbook/shared/validators/group';
import { createSettlementSchema } from '@splitbook/shared/validators/settlement';
import { updateExpenseSchema } from '@splitbook/shared/validators/expense';
import { validateGroupDraft } from './group-draft';
import { settlementBody, validateSettlementDraft } from './settlement';
import { expenseDraftSchema, validateExpenseDraft } from './expense-draft';
import type { GroupDraft } from './types';

const group: GroupDraft = {
  name: 'House',
  description: '',
  category: 'home',
  defaultCurrency: 'INR',
  startDate: '',
  endDate: '',
};
const payment = {
  paidBy: 'a00000000000000000000001',
  paidTo: 'a00000000000000000000002',
  amount: '1',
  currency: 'INR',
  note: '',
};
const expense = {
  amount: '1',
  currency: 'INR',
  description: '',
  date: '2026-10-10',
  payerId: payment.paidBy,
  multiPayer: false,
  payers: [],
  splitMethod: 'equal' as const,
  splitValues: {},
  participantIds: [payment.paidBy],
  category: 'general',
  tagId: '',
  notes: '',
};

describe('native field limits match the shared rules on the sent value', () => {
  for (const padding of ['', '     ']) {
    it.each([100, 101])(
      'Group name length %i with padding ' + JSON.stringify(padding),
      (length) => {
        const draft = { ...group, name: 'a'.repeat(length) + padding };
        const error = validateGroupDraft(draft, '2026-10-10').name;
        expect(createGroupSchema.shape.name.safeParse(draft.name.trim()).success).toBe(!error);
        expect(error).toBe(length > 100 ? 'Keep the name to 100 characters or fewer.' : undefined);
      },
    );
    it.each([500, 501])(
      'Settlement note length %i with padding ' + JSON.stringify(padding),
      (length) => {
        const draft = { ...payment, note: 'a'.repeat(length) + padding };
        const error = validateSettlementDraft(draft).note;
        expect(createSettlementSchema.shape.note.safeParse(draft.note.trim()).success).toBe(!error);
        expect(error).toBe(length > 500 ? 'Keep the note to 500 characters or fewer.' : undefined);
        if (!error) expect(JSON.parse(settlementBody(draft)).note).toBe('a'.repeat(length));
      },
    );
    it.each([200, 201])(
      'Expense description length %i with padding ' + JSON.stringify(padding),
      (length) => {
        const draft = { ...expense, description: 'a'.repeat(length) + padding };
        const error = validateExpenseDraft(draft, null, '2026-10-10').description;
        expect(updateExpenseSchema.shape.description.safeParse(draft.description).success).toBe(
          !error,
        );
        expect(error).toBe(
          length > 200 ? 'Keep the description to 200 characters or fewer.' : undefined,
        );
        // Storage and the native input cap raw text, even though the wire rule trims first.
        expect(expenseDraftSchema.shape.description.safeParse(draft.description).success).toBe(
          draft.description.length <= 200,
        );
      },
    );
  }
});
