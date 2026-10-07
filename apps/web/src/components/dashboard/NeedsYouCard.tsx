'use client';

import Link from 'next/link';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import TaskAltOutlinedIcon from '@mui/icons-material/TaskAltOutlined';
import { formatCurrency } from '@splitbook/shared/currency';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import type { HomeSuggestedPaymentRead } from '@splitbook/shared/home-balances-read';
import { initials } from '@/components/layout/AccountMenu';
import { recordPaymentHref as balancesRecordHref } from '@/components/settlements/record-payment';
import { RADIUS } from '@/lib/theme/tokens';
import {
  HomeCard,
  HomeCardEmpty,
  HomeCardError,
  HomeCardLoading,
  HomeList,
  homeRowSx,
} from './HomeCard';
import InvitationRow from './InvitationRow';
import {
  useHomeBalances,
  useHomeInvitations,
  type CardRead,
  type HomeInvitation,
} from './home-reads';

/** Read by screen readers only. Pixel strings: in `sx`, a bare 1 means 100%. */
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/**
 * Where Record goes: the payment's Group, on its Balances tab (#305), with Record payment
 * filled in for the member and the other person, and the suggested amount (#312).
 */
export function recordPaymentHref(payment: HomeSuggestedPaymentRead): string {
  return balancesRecordHref(payment.groupId, payment);
}

/** "You pay Sam Chen" or "Sam Chen pays you". */
export function paymentTitle({ direction, counterpartyName }: HomeSuggestedPaymentRead): string {
  return direction === 'pay' ? `You pay ${counterpartyName}` : `${counterpartyName} pays you`;
}

function PersonAvatar({ name }: { name: string }) {
  return (
    <Avatar
      sx={{
        width: 26,
        height: 26,
        borderRadius: '9px',
        fontSize: '0.65625rem',
        fontWeight: 600,
        bgcolor: 'tint.brand',
        color: 'primary.main',
        // Overlapping avatars keep a ring of the card's surface between them (web.css .avatars).
        boxShadow: (theme) => `0 0 0 2px ${theme.palette.background.paper}`,
        '& + &': { ml: '-4px' },
      }}
    >
      {initials(name)}
    </Avatar>
  );
}

/** A suggested payment: who pays whom, its Group, the exact amount and Record. */
function PaymentRow({
  payment,
  memberName,
}: {
  payment: HomeSuggestedPaymentRead;
  memberName: string;
}) {
  const title = paymentTitle(payment);
  const amount = formatCurrency(
    toMajorAmount(payment.amountMinor, payment.currency),
    payment.currency,
  );
  // The payer first, as the canvas draws it.
  const [first, second] =
    payment.direction === 'pay'
      ? [memberName, payment.counterpartyName]
      : [payment.counterpartyName, memberName];
  return (
    <Box component="li" sx={homeRowSx}>
      <Box aria-hidden sx={{ display: 'inline-flex', flex: 'none' }}>
        <PersonAvatar name={first} />
        <PersonAvatar name={second} />
      </Box>
      <Box sx={{ flex: '1 1 140px', minWidth: 0 }}>
        <Typography noWrap sx={{ fontWeight: 600, color: 'text.primary' }}>
          {title}
        </Typography>
        <Typography noWrap component="p" variant="caption" sx={{ color: 'text.secondary' }}>
          {payment.groupName} · suggested payment
        </Typography>
      </Box>
      {/* The amount over Record (web.css .lrow .end), leaving the names room in a narrow card. */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          flex: 'none',
          ml: 'auto',
        }}
      >
        <Typography
          component="span"
          sx={(theme) => ({
            ...theme.typography.money,
            fontSize: '0.875rem',
            color: 'text.primary',
          })}
        >
          {amount}
        </Typography>
        <Button
          component={Link}
          href={recordPaymentHref(payment)}
          variant="text"
          size="small"
          aria-label={`Record payment: ${title}, ${amount}, in ${payment.groupName}`}
          // Its label lines up with the amount above it.
          sx={{ mr: -1 }}
        >
          Record
        </Button>
      </Box>
    </Box>
  );
}

/** A row still loading beside rows that have loaded. */
function RowLoading({ label }: { label: string }) {
  return (
    <Box component="li" role="status" aria-label={label} aria-busy="true" sx={homeRowSx}>
      <Skeleton variant="rounded" width={36} height={36} sx={{ borderRadius: `${RADIUS.md}px` }} />
      <Box sx={{ flex: 1 }}>
        <Skeleton variant="text" width="60%" />
        <Skeleton variant="text" width="40%" />
      </Box>
    </Box>
  );
}

interface NeedsYouCardViewProps {
  payments: CardRead<HomeSuggestedPaymentRead[]>;
  invitations: CardRead<HomeInvitation[]>;
  /** The signed-in member, drawn beside the other person. */
  memberName: string;
  onRetryPayments: () => void;
  onRetryInvitations: () => void;
  onInvitationAnswered: () => void;
}

/**
 * Needs you, in whichever state its two reads are in. Suggested payments come from the
 * balances read and invitations from their own; each loads and fails on its own, and the
 * card is calm and empty only when both have answered with nothing.
 */
export function NeedsYouCardView({
  payments,
  invitations,
  memberName,
  onRetryPayments,
  onRetryInvitations,
  onInvitationAnswered,
}: NeedsYouCardViewProps) {
  const paymentRows = payments.status === 'ready' ? payments.value : [];
  const invitationRows = invitations.status === 'ready' ? invitations.value : [];
  const count = paymentRows.length + invitationRows.length;
  const bothLoading = payments.status === 'loading' && invitations.status === 'loading';
  const nothing = payments.status === 'ready' && invitations.status === 'ready' && count === 0;

  return (
    <HomeCard
      id="home-needs-you"
      title="Needs you"
      width="narrow"
      aside={
        count > 0 ? (
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              borderRadius: 999,
              px: 1.125,
              py: 0.25,
              fontSize: '0.75rem',
              fontWeight: 600,
              bgcolor: 'tint.brand',
              color: 'primary.main',
            }}
          >
            {count}
            <Box component="span" sx={visuallyHidden}>
              {count === 1 ? ' item' : ' items'}
            </Box>
          </Box>
        ) : null
      }
    >
      {bothLoading ? (
        <HomeCardLoading label="Loading what needs you" blocks={3} height={44} />
      ) : nothing ? (
        <HomeCardEmpty
          icon={<TaskAltOutlinedIcon aria-hidden sx={{ color: 'status.positive' }} />}
          title="Nothing needs you"
          description="No payments to make or receive, and no invitations waiting."
        />
      ) : (
        <>
          {payments.status === 'error' ? (
            <HomeCardError
              message="Suggested payments could not be loaded."
              onRetry={onRetryPayments}
            />
          ) : null}
          {invitations.status === 'error' ? (
            <HomeCardError
              message="Invitations could not be loaded."
              onRetry={onRetryInvitations}
            />
          ) : null}
          {count > 0 || payments.status === 'loading' || invitations.status === 'loading' ? (
            <HomeList label="Needs you">
              {payments.status === 'loading' ? (
                <RowLoading label="Loading suggested payments" />
              ) : null}
              {paymentRows.map((payment) => (
                <PaymentRow
                  key={`${payment.groupId}:${payment.currency}:${payment.direction}:${payment.counterpartyId}`}
                  payment={payment}
                  memberName={memberName}
                />
              ))}
              {invitations.status === 'loading' ? <RowLoading label="Loading invitations" /> : null}
              {invitationRows.map((invitation) => (
                <InvitationRow
                  key={invitation.id}
                  invitation={invitation}
                  onAnswered={onInvitationAnswered}
                />
              ))}
            </HomeList>
          ) : null}
        </>
      )}
    </HomeCard>
  );
}

/**
 * Home's "Needs you" card (#306): one row per payment Splitbook suggests the member makes or
 * receives, across their Groups, with Record; and one per invitation, with Join and Decline.
 */
export default function NeedsYouCard({ memberName }: { memberName: string }) {
  const { payments, retry: retryPayments } = useHomeBalances();
  const { invitations, retry: retryInvitations } = useHomeInvitations();
  return (
    <NeedsYouCardView
      payments={payments}
      invitations={invitations}
      memberName={memberName}
      onRetryPayments={retryPayments}
      onRetryInvitations={retryInvitations}
      onInvitationAnswered={retryInvitations}
    />
  );
}
