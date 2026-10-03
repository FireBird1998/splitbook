import { NextResponse } from 'next/server';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import {
  getAuthUser,
  unauthorized,
  success,
  notFound,
  forbidden,
  serverError,
  error,
} from '@/lib/utils/api-response';
import { groupService, LeaveBlockedError } from '@/lib/services/group.service';

/** "you owe ₹1,480.00 and are owed €12.50", one figure per currency. */
function describeOpenBalances(balances: LeaveBlockedError['balances']) {
  const figure = ({ currency, amountMinor }: { currency: string; amountMinor: number }) =>
    formatCurrency(toMajorAmount(Math.abs(amountMinor), currency), currency);
  const owe = balances.filter((balance) => balance.amountMinor < 0).map(figure);
  const owed = balances.filter((balance) => balance.amountMinor > 0).map(figure);
  const join = (figures: string[]) => figures.join(' and ');
  return [owe.length ? `you owe ${join(owe)}` : '', owed.length ? `are owed ${join(owed)}` : '']
    .filter(Boolean)
    .join(' and ')
    .replace(/^are owed/, 'you are owed');
}

// POST /api/groups/[id]/leave — The signed-in member leaves the Group
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthUser();
    if (!user) return unauthorized();

    const { id } = await params;
    const result = await groupService.leave(id, user.id);
    if (!result) return notFound('Group');

    return success({ message: 'Left group', archived: result.archived });
  } catch (err) {
    if (err instanceof LeaveBlockedError && err.code === 'LAST_ADMIN') {
      return error('Make someone else an admin before you leave.', 409, 'LAST_ADMIN');
    }
    if (err instanceof LeaveBlockedError && err.code === 'OPEN_BALANCE') {
      return NextResponse.json(
        {
          error: `Settle up before you leave: ${describeOpenBalances(err.balances)} in this Group.`,
          status: 409,
          code: 'OPEN_BALANCE',
          balances: err.balances.map(({ currency, amountMinor }) => ({
            currency,
            amount: toMajorAmount(amountMinor, currency),
          })),
        },
        { status: 409 },
      );
    }
    if (err instanceof Error && err.message === 'FORBIDDEN') return forbidden();
    if (err instanceof Error && err.message === 'LEAVE_CONFLICT') {
      return error('This Group changed while you were leaving. Try again.', 409, 'LEAVE_CONFLICT');
    }
    return serverError(err);
  }
}
