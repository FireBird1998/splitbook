'use client';

import { format } from 'date-fns';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import { formatCurrency } from '@splitbook/shared/currency';
import ErrorState from '@/components/common/ErrorState';
import { TabCard, PaysArrow, PersonAvatar, visuallyHidden } from './TabCard';

/** Someone named in a payment, as the settlements read populates them; null for an account gone. */
type PaymentPerson = { _id: string; name?: string } | null | undefined;

/** One Settlement as the Group's settlements read returns it. */
export interface PaymentRead {
  _id: string;
  paidBy: PaymentPerson;
  paidTo: PaymentPerson;
  amount: number;
  currency: string;
  note?: string;
  createdAt: string;
  /** Who recorded it: every Settlement stores its recorder. */
  createdBy?: PaymentPerson;
}

export type PaymentsState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; payments: PaymentRead[] };

/** "Sun 27 Sep", with the year when it isn't this year's, and "6:15 PM", in the viewer's zone. */
export function paymentWhen(createdAt: string, now = new Date()) {
  const at = new Date(createdAt);
  return {
    date: format(at, at.getFullYear() === now.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy'),
    time: format(at, 'h:mm a'),
  };
}

interface PaymentsTableProps {
  state: PaymentsState;
  /** The signed-in member, who reads as "You". */
  viewerId: string;
  onRetry: () => void;
}

/**
 * Payments (#312): every Settlement recorded in the Group, newest first, with when, who paid
 * whom, how much, the note and who recorded it. It shows names only, never an email, and loads
 * and fails on its own, without holding up the balances above it.
 */
export default function PaymentsTable({ state, viewerId, onRetry }: PaymentsTableProps) {
  const name = (person: PaymentPerson) =>
    person?._id === viewerId ? 'You' : person?.name?.trim() || 'Former member';
  // Avatars show the person's own initials, the viewer's included.
  const avatarName = (person: PaymentPerson) => person?.name?.trim() || name(person);
  const count = state.status === 'ready' ? state.payments.length : null;

  return (
    <TabCard
      headingId="payments-heading"
      title="Payments"
      subtitle={
        count === null
          ? 'Recorded payments between members'
          : count === 0
            ? 'None recorded yet'
            : `${count} recorded · already counted in the balances above`
      }
    >
      {state.status === 'loading' ? (
        <Box role="status" aria-label="Loading payments" sx={{ px: 2.5, pb: 2 }}>
          {[0, 1].map((row) => (
            <Skeleton key={row} variant="rounded" height={44} sx={{ mb: 1 }} aria-hidden />
          ))}
        </Box>
      ) : state.status === 'error' ? (
        <Box sx={{ px: 2.5, pb: 2.5 }}>
          <ErrorState
            severity="warning"
            message="Payments could not be loaded."
            onRetry={onRetry}
          />
        </Box>
      ) : state.payments.length === 0 ? (
        <Typography sx={{ m: 0, px: 2.5, pb: 2.5, fontSize: '0.875rem', color: 'text.secondary' }}>
          No payments yet. Record one when someone pays.
        </Typography>
      ) : (
        <Box
          role="region"
          aria-label="Payments table"
          tabIndex={0}
          sx={{
            overflowX: 'auto',
            pb: 1,
            borderBottomLeftRadius: '16px',
            borderBottomRightRadius: '16px',
            '&:focus-visible': { outline: 2, outlineColor: 'focus.main', outlineOffset: -2 },
          }}
        >
          <Box
            component="table"
            aria-labelledby="payments-heading"
            sx={{
              width: '100%',
              minWidth: 760,
              borderCollapse: 'collapse',
              fontSize: '0.875rem',
              color: 'text.primary',
              '& th': {
                textAlign: 'left',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: 'text.secondary',
                px: 1.5,
                py: 1.25,
                borderBottom: 1,
                borderColor: 'divider',
                whiteSpace: 'nowrap',
              },
              '& td': {
                px: 1.5,
                py: 1.25,
                height: 56,
                borderBottom: 1,
                borderColor: 'divider',
                verticalAlign: 'middle',
              },
              '& tbody tr:last-of-type td': { borderBottom: 0 },
              '& tbody tr:hover td': { bgcolor: 'surface.hover' },
              '& th:first-of-type, & td:first-of-type': { pl: 2.5 },
              '& th:last-of-type, & td:last-of-type': { pr: 2.5 },
              '& .num': { textAlign: 'right' },
            }}
          >
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">From → to</th>
                <th scope="col" className="num">
                  Amount
                </th>
                <th scope="col">Note</th>
                <th scope="col">Recorded by</th>
              </tr>
            </thead>
            <tbody>
              {state.payments.map((payment) => {
                const when = paymentWhen(payment.createdAt);
                const note = payment.note?.trim();
                return (
                  <tr key={payment._id}>
                    <td>
                      <Box
                        component="time"
                        dateTime={payment.createdAt}
                        sx={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap' }}
                      >
                        <span>{when.date}</span>
                        <Box component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                          {when.time}
                        </Box>
                      </Box>
                    </td>
                    <td>
                      <Box
                        component="span"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <PersonAvatar name={avatarName(payment.paidBy)} />
                        <span>{name(payment.paidBy)}</span>
                        <PaysArrow />
                        <PersonAvatar name={avatarName(payment.paidTo)} />
                        <span>{name(payment.paidTo)}</span>
                      </Box>
                    </td>
                    <Box
                      component="td"
                      className="num"
                      sx={(theme) => ({ ...theme.typography.money, whiteSpace: 'nowrap' })}
                    >
                      {formatCurrency(payment.amount, payment.currency)}
                    </Box>
                    <Box component="td" sx={{ overflowWrap: 'anywhere', maxWidth: 280 }}>
                      {note ? (
                        note
                      ) : (
                        <>
                          <Box component="span" aria-hidden sx={{ color: 'text.disabled' }}>
                            —
                          </Box>
                          <Box component="span" sx={visuallyHidden}>
                            No note
                          </Box>
                        </>
                      )}
                    </Box>
                    <Box component="td" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                      {payment.createdBy ? (
                        name(payment.createdBy)
                      ) : (
                        <>
                          <Box component="span" aria-hidden sx={{ color: 'text.disabled' }}>
                            —
                          </Box>
                          <Box component="span" sx={visuallyHidden}>
                            Not known
                          </Box>
                        </>
                      )}
                    </Box>
                  </tr>
                );
              })}
            </tbody>
          </Box>
        </Box>
      )}
    </TabCard>
  );
}
