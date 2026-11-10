import { normalizeExpenseMoney } from '@splitbook/shared/exact-money';
import { createExpenseSchema } from '@splitbook/shared/validators/expense';
import type { expenseFixture } from './fake-splitbook';

type Group = Parameters<typeof expenseFixture>[0] & {
  tags?: { _id: string; name: string }[];
};

/** A populated create receipt, built from the request; it does not apply the write to a world. */
export function expenseReceipt(group: Group, body: unknown, id: string, creatorId: string) {
  const input = createExpenseSchema.parse(body);
  const person = (id: string) => {
    const user = group.members.find((member) => member.user._id === id)?.user;
    if (!user) throw new Error(`Fixture receipt names a person outside the Group: ${id}`);
    return { _id: user._id, name: user.name, image: user.image ?? null };
  };
  const money = normalizeExpenseMoney(input);
  return {
    ...input,
    ...money,
    _id: id,
    group: group._id,
    revision: 0,
    date: input.date.toISOString(),
    paidBy: money.paidBy.map((row) => ({ ...row, user: person(row.user) })),
    splitBetween: money.splitBetween.map((row) => ({ ...row, user: person(row.user) })),
    tag: group.tags?.find((tag) => tag._id === input.tagId)?.name ?? input.tag ?? '',
    notes: input.notes ?? '',
    createdBy: person(creatorId),
    createdAt: group.updatedAt,
    updatedAt: group.updatedAt,
    isDeleted: false,
    editHistory: [],
  };
}
