'use client';

import useSWR from 'swr';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import MenuItem from '@mui/material/MenuItem';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import MoneyText from '@/components/common/MoneyText';
import ErrorState from '@/components/common/ErrorState';
import EmptyState from '@/components/common/EmptyState';
import RecordPaymentForm, {
  type PaymentParty,
  type RecordPaymentStart,
} from '@/components/settlements/RecordPaymentForm';
import {
  amountInputText,
  firstName,
  recordPaymentLinkPair,
  withoutRecordPaymentLink,
  type LedgerState,
} from '@/components/settlements/record-payment';
import { viewerFirst } from '@/components/groups/group-tabs';
import { formatCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, readLegacyAmountMinor } from '@splitbook/shared/exact-money';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import {
  previewSettlement,
  settlementLedgerFromRead,
  suggestedSettlementMinor,
  type SettlementLedger,
} from '@splitbook/shared/settlement-preview';
import { getGroupTheme } from '@splitbook/shared/group-themes';
import type { GroupRead } from '@splitbook/shared/group-read';
import { fetcher } from '@/lib/utils/fetcher';
import { useSettlementAttempts } from '@/lib/hooks/use-settlement-attempts';
import type { SettlementAttempt } from '@/lib/settlement-attempts';
import { TabCard, PersonAvatar } from './TabCard';
import PaymentsTable, { type PaymentRead, type PaymentsState } from './PaymentsTable';

const MIXED_CURRENCY_WARNING =
  'This ledger contains multiple currencies. Each balance is shown separately, without conversion.';

interface BalancesViewProps {
  groupId: string;
  userId: string;
  group: GroupRead;
}

interface BalancePerson {
  _id: string;
  name: string;
}

interface CurrencyFigures {
  currency: string;
  balances: Array<{ user: BalancePerson; balance: number }>;
  debts: Array<{ from: BalancePerson; to: BalancePerson; amount: number }>;
}

interface BalancesRead {
  data?: Partial<CurrencyFigures> & {
    byCurrency?: CurrencyFigures[];
    hasMixedCurrencies?: boolean;
  };
}

/** "Your payment of ₹250.25 to Priya Shah may already be recorded…", or the other way round. */
function unconfirmedPaymentMessage(attempt: SettlementAttempt, userId: string) {
  const amount = formatCurrency(attempt.amount, attempt.currency);
  const payment =
    attempt.paidBy === userId
      ? `Your payment of ${amount} to ${attempt.paidToName}`
      : `${attempt.paidByName}’s payment of ${amount} to ${attempt.paidTo === userId ? 'you' : attempt.paidToName}`;
  return `${payment} may already be recorded. Check it before recording another.`;
}

/** A stored payment's amount as the form's field shows it. */
function attemptAmountText(attempt: SettlementAttempt) {
  try {
    return amountInputText(parseAmountMinor(attempt.amount, attempt.currency), attempt.currency);
  } catch {
    return String(attempt.amount);
  }
}

/** One currency's figures in exact minor units, or null when there are none or they don't read. */
function ledgerOf(
  figures: Partial<CurrencyFigures> | undefined,
  currency: string,
): SettlementLedger | null {
  if (!figures) return null;
  try {
    return settlementLedgerFromRead(figures, currency);
  } catch {
    return null;
  }
}

/** The overline style the canvas uses for small headings (web.css: .t-over). */
const overlineSx = {
  m: 0,
  fontSize: '0.72rem',
  lineHeight: 1.3,
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'text.secondary',
} as const;

function CurrencyChip({ currency }: { currency: string }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        ...theme.typography.money,
        fontSize: '0.75rem',
        fontWeight: 600,
        color: 'text.secondary',
        bgcolor: 'surface.muted',
        borderRadius: '8px',
        px: 1,
        py: 0.375,
      })}
    >
      {currency}
    </Box>
  );
}

/**
 * The Balances tab (#312): the member's all-time balance, Settle up with the suggested payments
 * (Record fills the form in), Record payment on the page itself, everyone's net position and
 * the Group's Payments. Record payment keeps its place whatever the balances above it are
 * doing (loading, refreshing or failing), so a refresh never loses what the member entered.
 */
export default function BalancesView({ groupId, userId, group }: BalancesViewProps) {
  const [selectedCurrency, setSelectedCurrency] = useState('');
  const blank = useCallback((): RecordPaymentStart => ({ from: userId, to: '' }), [userId]);
  /** Each new `seq` starts the form afresh; nothing else (such as a refresh) resets it. */
  const [form, setForm] = useState<{
    seq: number;
    start: RecordPaymentStart;
    outcome: string | null;
  }>(() => ({ seq: 0, start: blank(), outcome: null }));
  const [formPair, setFormPair] = useState({ from: userId, to: '' });
  // Payments whose reply was lost, offered whatever the suggestions say (#198).
  const attempts = useSettlementAttempts(userId, groupId);

  const { data, error, mutate } = useSWR<BalancesRead>(`/api/groups/${groupId}/balances`, fetcher, {
    refreshInterval: 15_000,
  });
  const {
    data: settlementsData,
    error: settlementsError,
    mutate: mutateSettlements,
  } = useSWR<{ data?: PaymentRead[] }>(`/api/groups/${groupId}/settlements`, fetcher);

  const refresh = useCallback(() => {
    void mutate();
    void mutateSettlements();
  }, [mutate, mutateSettlements]);

  const openForm = (start: RecordPaymentStart) =>
    setForm((current) => ({ seq: current.seq + 1, start, outcome: null }));
  const onFormDone = useCallback(
    (outcome: string | null) => {
      refresh();
      setForm((current) => ({
        seq: current.seq + 1,
        start: { ...blank(), focus: outcome ? 'outcome' : 'from' },
        outcome,
      }));
    },
    [refresh, blank],
  );

  const groupCurrency = group.defaultCurrency;
  const read = data?.data;
  const defaultCurrency = read?.currency || groupCurrency;
  const buckets = read?.byCurrency ?? [];
  const currency = buckets.some((bucket) => bucket.currency === selectedCurrency)
    ? selectedCurrency
    : defaultCurrency;
  const shownBucket = buckets.find((bucket) => bucket.currency === currency);
  const balances = shownBucket?.balances ?? read?.balances ?? [];
  const debts = shownBucket?.debts ?? read?.debts ?? [];
  const hasMixedCurrencies = Boolean(read?.hasMixedCurrencies);

  // Every new payment is in the Group's currency, so the form reads that currency's figures.
  const groupLedger = ledgerOf(
    buckets.find((bucket) => bucket.currency === groupCurrency) ?? read,
    groupCurrency,
  );
  const ledger: LedgerState = groupLedger
    ? { status: 'ready', ledger: groupLedger }
    : read || error
      ? { status: 'error' }
      : { status: 'loading' };
  // Settle up's figures in exact minor units, for the currency shown.
  const shownLedger = ledgerOf(shownBucket ?? read, currency);

  const members: PaymentParty[] = viewerFirst(group.members, userId).map((member) => ({
    id: member.user._id,
    name: member.user.name,
  }));
  // Home's Record (#306) links here for one pair. Once the balances have answered, the form
  // starts with that pair and its suggestion, and the address drops the link, so reloading or
  // coming Back doesn't fill the form in again. A link naming someone outside the Group does
  // nothing.
  const searchParams = useSearchParams();
  const linkPair = recordPaymentLinkPair(searchParams, userId);
  const linkFrom = linkPair?.from ?? '';
  const linkTo = linkPair?.to ?? '';
  const linkOther = linkFrom === userId ? linkTo : linkFrom;
  const linkMember = members.some((member) => member.id === linkOther);
  const linkSuggestion =
    linkPair && groupLedger ? suggestedSettlementMinor(groupLedger, linkFrom, linkTo) : 0;
  const linkAmount = linkSuggestion > 0 ? amountInputText(linkSuggestion, groupCurrency) : '';
  const answered = Boolean(read || error);
  const appliedLink = useRef<string | null>(null);
  useEffect(() => {
    const link = searchParams.toString();
    if (!linkFrom || !answered || appliedLink.current === link) return;
    // Deferred, as the Group page applies `?action=add-expense`, so it runs after mount.
    const timeout = window.setTimeout(() => {
      appliedLink.current = link;
      // Next keeps its router in step with the native history API.
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${withoutRecordPaymentLink(link)}`,
      );
      if (!linkMember) return;
      setForm((current) => ({
        seq: current.seq + 1,
        outcome: null,
        start: {
          from: linkFrom,
          to: linkTo,
          amount: linkAmount,
          purpose: 'record',
          focus: 'amount',
        },
      }));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchParams, linkFrom, linkTo, linkMember, linkAmount, answered]);

  const displayName = (person: BalancePerson) => (person._id === userId ? 'You' : person.name);
  const userBalance = balances.find((balance) => balance.user._id === userId);
  const theme = getGroupTheme(group.category);

  const payments: PaymentsState = settlementsData
    ? { status: 'ready', payments: settlementsData.data ?? [] }
    : settlementsError
      ? { status: 'error' }
      : { status: 'loading' };

  const unconfirmedPayments =
    attempts.length > 0 ? (
      <Stack spacing={1.5}>
        {attempts.map((attempt) => (
          <Alert
            key={attempt.key}
            severity="warning"
            role="status"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() =>
                  openForm({
                    from: attempt.paidBy,
                    to: attempt.paidTo,
                    amount: attemptAmountText(attempt),
                    purpose: 'check',
                    focus: 'amount',
                  })
                }
              >
                Check payment
              </Button>
            }
          >
            <AlertTitle>Payment not confirmed</AlertTitle>
            {unconfirmedPaymentMessage(attempt, userId)}
          </Alert>
        ))}
      </Stack>
    ) : null;

  const currencySelector = hasMixedCurrencies ? (
    <Stack spacing={1.5}>
      <Alert severity="info">{MIXED_CURRENCY_WARNING}</Alert>
      <TextField
        select
        label="Balance currency"
        value={currency}
        onChange={(event) => setSelectedCurrency(event.target.value)}
        size="small"
        sx={{ maxWidth: 320 }}
      >
        {buckets.map((bucket) => (
          <MenuItem key={bucket.currency} value={bucket.currency}>
            {bucket.currency}
          </MenuItem>
        ))}
      </TextField>
      {currency !== groupCurrency && (
        <Typography variant="caption" color="text.secondary">
          Historical balances in {currency}. New payments use the Group currency, {groupCurrency}.
        </Typography>
      )}
    </Stack>
  ) : null;

  const balanceCard = (() => {
    const amount = userBalance?.balance ?? 0;
    const position = amount < 0 ? 'You owe' : amount > 0 ? 'You’re owed' : 'You’re settled up';
    return (
      <Box
        component="section"
        aria-labelledby="all-time-balance-heading"
        sx={{
          bgcolor: 'background.paper',
          border: 1,
          borderColor: 'divider',
          borderRadius: '16px',
          px: 2.75,
          pt: 2.25,
          pb: 2.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
          animation: 'balance-settle 400ms ease-out both',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          <Typography id="all-time-balance-heading" component="h2" sx={overlineSx}>
            All-time balance
          </Typography>
          <CurrencyChip currency={currency} />
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Typography sx={{ m: 0, color: 'text.secondary' }}>{position}</Typography>
          <MoneyText
            amount={Math.abs(amount)}
            currency={currency}
            tone={amount < 0 ? 'negative' : amount > 0 ? 'positive' : 'neutral'}
            sx={{
              display: 'block',
              fontSize: { xs: '2rem', sm: '2.5rem' },
              lineHeight: 1.05,
              letterSpacing: '-0.04em',
            }}
          />
        </Box>
        {theme.signature === 'monthCycle' && (
          <Typography sx={{ m: 0, fontSize: '0.875rem', color: 'text.secondary' }}>
            Includes every month. Picking a month on Expenses doesn’t change it.
          </Typography>
        )}
      </Box>
    );
  })();

  const settleUpCard = (
    <TabCard
      headingId="settle-up-heading"
      title="Settle up"
      subtitle={debts.length > 0 ? `${currency} · Record one once it’s paid` : currency}
    >
      {debts.length === 0 ? (
        <Typography sx={{ m: 0, px: 2.5, pb: 2.5, fontSize: '0.875rem', color: 'text.secondary' }}>
          Everyone is settled up in {currency}.
        </Typography>
      ) : (
        <>
          <Box
            component="ul"
            aria-label="Suggested payments"
            sx={{ listStyle: 'none', m: 0, p: 0 }}
          >
            {debts.map((debt, index) => {
              const involved = canRecordSettlement(userId, debt.from._id, debt.to._id);
              const recordable = involved && currency === groupCurrency;
              const inForm =
                recordable && formPair.from === debt.from._id && formPair.to === debt.to._id;
              const payer = displayName(debt.from);
              const payee = displayName(debt.to);
              const title =
                debt.from._id === userId
                  ? `You pay ${payee}`
                  : debt.to._id === userId
                    ? `${payer} pays you`
                    : `${payer} pays ${payee}`;
              let amountMinor: number | null = null;
              try {
                amountMinor = readLegacyAmountMinor(debt.amount, currency);
              } catch {
                amountMinor = null;
              }
              const after =
                shownLedger && amountMinor
                  ? previewSettlement(shownLedger, {
                      paidBy: debt.from._id,
                      paidTo: debt.to._id,
                      amountMinor,
                    })
                  : null;
              const sub = inForm
                ? 'In the form'
                : !involved
                  ? `Only ${firstName(debt.from.name)} or ${firstName(debt.to.name)} can record it`
                  : after?.paidTo.afterMinor === 0
                    ? debt.to._id === userId
                      ? 'Then you’re settled up'
                      : `Then ${firstName(debt.to.name)} is settled up`
                    : after?.paidBy.afterMinor === 0
                      ? debt.from._id === userId
                        ? 'Then you’re settled up'
                        : `Then ${firstName(debt.from.name)} is settled up`
                      : 'Either of you can record it';
              return (
                <Box
                  component="li"
                  key={`${debt.from._id}-${debt.to._id}-${index}`}
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 1.5,
                    minHeight: 60,
                    px: 2.5,
                    py: 1,
                    bgcolor: inForm ? 'tint.brand' : 'transparent',
                    '& + li': { borderTop: 1, borderColor: 'divider' },
                  }}
                >
                  <Box aria-hidden sx={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    <PersonAvatar name={debt.from.name} />
                    <Box
                      component="svg"
                      viewBox="0 0 24 24"
                      sx={{
                        width: 16,
                        height: 16,
                        fill: 'none',
                        stroke: 'currentColor',
                        strokeWidth: 1.8,
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        color: 'text.disabled',
                      }}
                    >
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </Box>
                    <PersonAvatar name={debt.to.name} />
                  </Box>
                  <Box
                    sx={{
                      flex: '1 1 160px',
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '1px',
                    }}
                  >
                    <Typography
                      sx={{ m: 0, fontSize: '0.875rem', fontWeight: 600, color: 'text.primary' }}
                    >
                      {title}
                    </Typography>
                    <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
                      {sub}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 'auto' }}>
                    <MoneyText
                      amount={debt.amount}
                      currency={currency}
                      tone="neutral"
                      sx={{ fontSize: '1rem', fontWeight: 500 }}
                    />
                    {recordable && (
                      <Button
                        variant={inForm ? 'outlined' : 'contained'}
                        disableElevation
                        aria-label={
                          debt.from._id === userId
                            ? `Record your payment to ${debt.to.name}`
                            : `Record ${debt.from.name}’s payment to you`
                        }
                        onClick={() =>
                          openForm({
                            from: debt.from._id,
                            to: debt.to._id,
                            amount:
                              amountMinor === null ? '' : amountInputText(amountMinor, currency),
                            purpose: 'record',
                            focus: 'amount',
                          })
                        }
                        sx={{
                          minHeight: 40,
                          borderRadius: '12px',
                          px: 2,
                          flexShrink: 0,
                          ...(inForm
                            ? {
                                bgcolor: 'background.paper',
                                borderColor: 'border.strong',
                                color: 'text.primary',
                              }
                            : {
                                bgcolor: 'tint.brand',
                                color: 'primary.main',
                                '&:hover': { bgcolor: 'tint.brand' },
                              }),
                        }}
                      >
                        Record
                      </Button>
                    )}
                  </Box>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ mx: 2.5, borderTop: 1, borderColor: 'divider' }} />
          <Typography
            sx={{ m: 0, px: 2.5, pt: 1.5, pb: 2, fontSize: '0.875rem', color: 'text.secondary' }}
          >
            After {debts.length === 1 ? 'this payment' : `these ${debts.length} payments`}, everyone
            in {group.name} is settled up in {currency}.
          </Typography>
        </>
      )}
    </TabCard>
  );

  const positionsCard = (
    <TabCard
      headingId="net-positions-heading"
      title="Net positions"
      subtitle={`All-time net · ${currency}`}
    >
      <Box component="ul" sx={{ listStyle: 'none', m: 0, px: 2.5, pt: 0, pb: 1.5 }}>
        {balances.map((balance) => (
          <Box
            component="li"
            key={balance.user._id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              minHeight: 44,
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
              <PersonAvatar name={balance.user.name} />
              <Typography sx={{ m: 0, fontSize: '0.875rem', color: 'text.primary' }}>
                {displayName(balance.user)}
              </Typography>
            </Box>
            {balance.balance === 0 ? (
              <Typography
                sx={{ m: 0, fontSize: '0.875rem', fontWeight: 600, color: 'status.positive' }}
              >
                Settled
              </Typography>
            ) : (
              <MoneyText
                amount={balance.balance}
                currency={currency}
                signed
                variant="body2"
                fontWeight={600}
              />
            )}
          </Box>
        ))}
      </Box>
    </TabCard>
  );

  // Above Record payment on a phone: the balance and Settle up, so a suggestion's Record sits
  // just above the form it fills in. Below it: everyone's net position.
  const [top, rest] = !read
    ? [
        error ? (
          <ErrorState message="Balances could not be loaded." onRetry={() => void mutate()} />
        ) : (
          <Stack spacing={2} role="status" aria-label="Loading balances" aria-busy="true">
            <Skeleton variant="rounded" height={150} sx={{ borderRadius: '16px' }} />
            <Skeleton variant="rounded" height={180} sx={{ borderRadius: '16px' }} />
          </Stack>
        ),
        null,
      ]
    : balances.length === 0 && debts.length === 0
      ? [
          <Box
            key="settled"
            component="section"
            aria-label="Balances"
            sx={{
              bgcolor: 'background.paper',
              border: 1,
              borderColor: 'divider',
              borderRadius: '16px',
            }}
          >
            <EmptyState
              title="All settled up"
              description={`No one owes anyone in this ${theme.nouns.singular} right now.`}
            />
          </Box>,
          null,
        ]
      : [
          <>
            {error && (
              <ErrorState
                severity="warning"
                message="Balances could not be refreshed. Showing the balances loaded before."
                onRetry={() => void mutate()}
              />
            )}
            {balanceCard}
            {settleUpCard}
          </>,
          positionsCard,
        ];

  return (
    <Stack spacing={2.5}>
      {unconfirmedPayments}
      {currencySelector}
      {/* Two columns once the tab is wide enough for both (web.css .duo: 600px + 340px), the
          form beside the figures; one column otherwise, the form straight after Settle up. */}
      <Box sx={{ containerType: 'inline-size' }}>
        <Box
          sx={{
            display: 'grid',
            gap: 2.5,
            alignItems: 'start',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gridTemplateAreas: '"top" "form" "rest"',
            '@container (min-width: 920px)': {
              gridTemplateColumns: 'minmax(0, 1fr) 340px',
              gridTemplateRows: 'auto 1fr',
              gridTemplateAreas: '"top form" "rest form"',
            },
          }}
        >
          <Box
            sx={{
              gridArea: 'top',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
            }}
          >
            {top}
          </Box>
          <Box sx={{ gridArea: 'form', minWidth: 0 }}>
            <RecordPaymentForm
              key={form.seq}
              groupId={groupId}
              groupName={group.name}
              accountId={userId}
              currency={groupCurrency}
              members={members}
              ledger={ledger}
              start={form.start}
              outcome={form.outcome}
              onDone={onFormDone}
              onRefresh={refresh}
              onPairChange={setFormPair}
            />
          </Box>
          {rest && <Box sx={{ gridArea: 'rest', minWidth: 0 }}>{rest}</Box>}
        </Box>
      </Box>
      <PaymentsTable state={payments} viewerId={userId} onRetry={() => void mutateSettlements()} />
    </Stack>
  );
}
