'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import InputBase from '@mui/material/InputBase';
import Typography from '@mui/material/Typography';
import {
  rateBadge,
  rateNote,
  rateText,
  suggestedRateText,
} from '@splitbook/shared/cross-currency-payment';
import { decimalMoney, minorMoney } from '@splitbook/shared/cross-currency-settlement';
import { getCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { useRateSuggestion, type RateSuggestionState } from '@/lib/hooks/use-rate-suggestion';
import {
  browserAttemptStorage,
  browserPairLock,
  discardSettlementAttempt,
  recordSettlement,
  settlementPath,
  type SettlementAttempt,
} from '@/lib/settlement-attempts';
import { apiFetch, pinExpectedAccount, reloadForAccountChange } from '@/lib/utils/api-fetch';
import { FONT_MONO, RADIUS } from '@/lib/theme/tokens';
import { DISCARDED, GONE, NOT_DISCARDED, NOT_STORED, STALE, UNCONFIRMED } from './record-payment';
import {
  readSettleAll,
  settleAllWords,
  type SettleAllDebt,
  type SettleAllLine,
  type SettleAllOffer,
  type SettleAllRate,
  type SettleAllRateState,
} from '@splitbook/shared/settle-all';

export interface SettleAllDialogProps {
  open: boolean;
  groupId: string;
  /** The account the page was rendered for; it owns the payments stored in this browser. */
  accountId: string;
  /** The Debts between the two, as the latest Balances show them; null once there's no offer. */
  offer: SettleAllOffer | null;
  /** Everyone's name, kept with a stored payment. */
  names: Readonly<Record<string, string>>;
  /** The currencies it can be paid in: the Debts' own that the Group lists. */
  payCurrencies: string[];
  /** The payment stored for the two, if any: one that may already be recorded. */
  stored: SettlementAttempt | null;
  onClose: () => void;
  /** It was recorded, or its copy discarded: what to say about it. */
  onDone: (outcome: string) => void;
  /** Balances and Payments should read again. */
  onRefresh: () => void;
}

const symbolOf = (currency: string) => getCurrency(currency)?.symbol ?? currency;
/** "₹92.10 per €": units of the paying currency for one unit of the Debt's. */
const perUnit = (rate: string, paidCurrency: string, currency: string) =>
  `${decimalMoney(rateText(rate), paidCurrency)} per ${symbolOf(currency)}`;

/** Reads a Debt's suggested rate into the sheet: the hook, once per Debt and paying currency. */
function RateReader({
  groupId,
  currency,
  paidCurrency,
  onRead,
}: {
  groupId: string;
  currency: string;
  paidCurrency: string;
  onRead: (pair: string, state: RateSuggestionState) => void;
}) {
  const state = useRateSuggestion(groupId, currency, paidCurrency);
  // The hook answers with a new object each render; report it only when what it says changes.
  const suggestion = state.status === 'ready' ? state.suggestion : null;
  const reason = state.status === 'none' ? state.reason : null;
  useEffect(() => {
    onRead(
      pairKey(currency, paidCurrency),
      suggestion
        ? { status: 'ready', suggestion }
        : state.status === 'none'
          ? { status: 'none', reason }
          : { status: 'loading' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `suggestion` changes only with its read.
  }, [
    currency,
    paidCurrency,
    state.status,
    reason,
    suggestion?.rate,
    suggestion?.fetchedAt,
    onRead,
  ]);
  return null;
}

/** A rate belongs to its Debt's currency and the currency it is paid in, never one of them alone. */
const pairKey = (currency: string, paidCurrency: string) => `${currency}>${paidCurrency}`;

/** The rows of a stored settle-up, as it was sent: never changed, only checked. */
function storedLines(stored: SettlementAttempt): SettleAllLine[] {
  return (stored.batch ?? []).map((row) => {
    const debtMinor = parseAmountMinor(row.amount, row.currency);
    return {
      currency: row.currency,
      debtMinor,
      paidMinor: row.amountPaidMinor ?? debtMinor,
      rate: row.appliedRate ?? null,
      kind: row.appliedRate ? (row.rateKind ?? 'entered') : 'same',
      suggestion: null,
    };
  });
}

/**
 * Settle up (#734, board "Web · Settle both currencies at once"): one payment that clears every
 * Debt between the member and another person, in one currency, each Debt at its own suggested
 * or custom rate. It records one Settlement for each, all or none, through the payment store:
 * kept in this browser before its first send, so a lost reply is sent again unchanged, never
 * twice. Each Debt's currency moves by its own amount only; nothing is converted.
 */
export default function SettleAllDialog({
  open,
  groupId,
  accountId,
  offer,
  names,
  payCurrencies,
  stored,
  onClose,
  onDone,
  onRefresh,
}: SettleAllDialogProps) {
  const [paidCurrency, setPaidCurrency] = useState(
    () => offer?.debts.find(({ currency }) => payCurrencies.includes(currency))?.currency ?? '',
  );
  const [read, setRead] = useState<Record<string, RateSuggestionState>>({});
  const [custom, setCustom] = useState<Record<string, string | null>>({});
  const [changing, setChanging] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const onRead = useCallback(
    (pair: string, state: RateSuggestionState) => setRead((all) => ({ ...all, [pair]: state })),
    [],
  );

  // A settle-up stored in this browser is checked as it was sent; another payment waits first.
  const storedBatch = stored?.batch ? stored : null;
  const earlier = stored && !stored.batch ? stored : null;
  const debts: SettleAllDebt[] = storedBatch
    ? storedLines(storedBatch).map(({ currency, debtMinor }) => ({
        currency,
        amountMinor: debtMinor,
      }))
    : (offer?.debts ?? []);
  const shownOffer: SettleAllOffer | null =
    offer ??
    (storedBatch
      ? {
          paidBy: storedBatch.paidBy,
          paidTo: storedBatch.paidTo,
          other: storedBatch.paidBy === accountId ? storedBatch.paidToName : storedBatch.paidByName,
          youPay: storedBatch.paidBy === accountId,
          debts,
        }
      : null);
  const currency = storedBatch?.currency ?? paidCurrency;
  const rates: Record<string, SettleAllRate> = Object.fromEntries(
    debts.map(({ currency: code }) => [
      code,
      {
        state: read[pairKey(code, currency)] ?? { status: 'loading' },
        custom: custom[code] ?? null,
      },
    ]),
  );
  const reading = storedBatch
    ? {
        lines: storedLines(storedBatch),
        amounts: null,
        waiting: null,
      }
    : readSettleAll({ debts, paidCurrency: currency, rates });
  const totalMinor = storedBatch
    ? parseAmountMinor(storedBatch.amount, storedBatch.currency)
    : (reading.amounts?.totalPaidMinor ?? null);
  const total = totalMinor === null ? null : minorMoney(totalMinor, currency);
  const words = shownOffer ? settleAllWords(shownOffer) : null;

  const outcome = () => {
    if (!words || !shownOffer || total === null) return 'Recorded.';
    const payer = shownOffer.youPay ? 'You' : shownOffer.other;
    const payee = shownOffer.youPay ? shownOffer.other : 'you';
    return `Recorded. ${payer} paid ${payee} ${total} to clear ${words.amounts}.`;
  };

  const record = async () => {
    if (!shownOffer || sending) return;
    if (!storedBatch && !reading.amounts) return;
    setSending(true);
    setError('');
    try {
      const result = await recordSettlement({
        storage: browserAttemptStorage(),
        accountId,
        groupId,
        resend: storedBatch,
        payment: storedBatch
          ? undefined
          : {
              paidBy: shownOffer.paidBy,
              paidTo: shownOffer.paidTo,
              paidByName: names[shownOffer.paidBy] ?? 'Former member',
              paidToName: names[shownOffer.paidTo] ?? 'Former member',
              amount: toMajorAmount(totalMinor!, currency),
              currency,
              note: '',
              batch: reading.amounts!.settlements,
            },
        newKey: () => crypto.randomUUID(),
        post: (key, body) =>
          apiFetch(settlementPath(groupId, body), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body,
          }),
        lock: browserPairLock(),
        pinnedToAccount: () => pinExpectedAccount(accountId),
      });
      switch (result.status) {
        case 'recorded':
          onRefresh();
          onDone(outcome());
          return;
        case 'earlier':
          setError(
            'Another payment between you two may already be recorded. Check it before recording this one.',
          );
          return;
        case 'gone':
          setError(GONE);
          onRefresh();
          return;
        case 'not-stored':
          setError(NOT_STORED);
          return;
        case 'stale':
          setError(STALE);
          reloadForAccountChange();
          return;
        default:
          setError(result.message);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Something went wrong.');
    } finally {
      setSending(false);
    }
  };

  const discard = async () => {
    const storage = browserAttemptStorage();
    if (!storedBatch || !storage) return;
    try {
      await discardSettlementAttempt(storage, storedBatch, browserPairLock());
    } catch {
      setError(NOT_DISCARDED);
      return;
    }
    onRefresh();
    onDone(DISCARDED);
  };

  const cell = { py: 1.25, pr: 1.5, verticalAlign: 'top', textAlign: 'left' } as const;
  const head = { ...cell, fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' } as const;
  const mono = { fontFamily: FONT_MONO, whiteSpace: 'nowrap' } as const;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="settle-all-title"
    >
      {/* Each Debt's suggested rate, in the currency it is paid in. */}
      {!storedBatch &&
        debts
          .filter(({ currency: code }) => code !== currency)
          .map(({ currency: code }) => (
            <RateReader
              key={`${code}>${currency}`}
              groupId={groupId}
              currency={code}
              paidCurrency={currency}
              onRead={onRead}
            />
          ))}
      <DialogTitle id="settle-all-title">{words?.title ?? 'Settle up'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!words ? (
          <Typography>
            There’s nothing left to settle in more than one currency. Check Balances.
          </Typography>
        ) : (
          <>
            <Typography sx={{ color: 'text.secondary' }}>{words.intro}</Typography>
            {earlier && (
              <Alert severity="warning">
                Another payment between you two may already be recorded. Check it in Record payment
                before settling up.
              </Alert>
            )}
            {storedBatch && <Alert severity="warning">{UNCONFIRMED}</Alert>}
            {!storedBatch && payCurrencies.length > 1 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                <Typography
                  id="settle-all-pay-in"
                  sx={{ fontSize: '0.75rem', fontWeight: 500, color: 'text.secondary' }}
                >
                  Pay in
                </Typography>
                <Box
                  role="radiogroup"
                  aria-labelledby="settle-all-pay-in"
                  sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
                >
                  {payCurrencies.map((code) => (
                    <Button
                      key={code}
                      role="radio"
                      aria-checked={code === currency}
                      variant={code === currency ? 'contained' : 'outlined'}
                      disableElevation
                      onClick={() => {
                        setPaidCurrency(code);
                        setCustom({});
                        setChanging({});
                      }}
                      sx={{ minHeight: 40, minWidth: 64, borderRadius: `${RADIUS.sm}px`, ...mono }}
                    >
                      {code}
                    </Button>
                  ))}
                </Box>
              </Box>
            )}
            <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <Box component="tr" sx={{ borderBottom: 1, borderColor: 'divider' }}>
                  <Box component="th" scope="col" sx={head}>
                    Debt
                  </Box>
                  <Box component="th" scope="col" sx={head}>
                    Rate
                  </Box>
                  <Box component="th" scope="col" sx={{ ...head, textAlign: 'right', pr: 0 }}>
                    {words.payColumn}
                  </Box>
                </Box>
              </thead>
              <tbody>
                {reading.lines.map((line) => (
                  <Box
                    component="tr"
                    key={line.currency}
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                  >
                    <Box component="td" sx={cell}>
                      <Box component="span" sx={{ ...mono, fontWeight: 600, mr: 1 }}>
                        {line.currency}
                      </Box>
                      <Box component="span" sx={mono}>
                        {minorMoney(line.debtMinor, line.currency)}
                      </Box>
                    </Box>
                    <Box component="td" sx={cell}>
                      <RateCell
                        line={line}
                        paidCurrency={currency}
                        fixed={Boolean(storedBatch)}
                        changing={Boolean(changing[line.currency]) || custom[line.currency] != null}
                        custom={custom[line.currency] ?? null}
                        state={rates[line.currency]?.state ?? { status: 'loading' }}
                        onChange={() => {
                          const state = rates[line.currency]?.state;
                          setChanging((all) => ({ ...all, [line.currency]: true }));
                          setCustom((all) => ({
                            ...all,
                            [line.currency]:
                              state?.status === 'ready'
                                ? suggestedRateText(state.suggestion.rate)
                                : '',
                          }));
                        }}
                        onType={(value) => setCustom((all) => ({ ...all, [line.currency]: value }))}
                        onUseSuggestion={() => {
                          setCustom((all) => ({ ...all, [line.currency]: null }));
                          setChanging((all) => ({ ...all, [line.currency]: false }));
                        }}
                      />
                    </Box>
                    <Box component="td" sx={{ ...cell, ...mono, textAlign: 'right', pr: 0 }}>
                      {line.paidMinor === null ? '—' : minorMoney(line.paidMinor, currency)}
                    </Box>
                  </Box>
                ))}
                <Box component="tr">
                  <Box component="th" scope="row" colSpan={2} sx={{ ...cell, fontWeight: 600 }}>
                    Total
                  </Box>
                  <Box
                    component="td"
                    sx={{ ...cell, ...mono, textAlign: 'right', pr: 0, fontWeight: 600 }}
                  >
                    {total ?? '—'}
                  </Box>
                </Box>
              </tbody>
            </Box>
            <Typography
              sx={{
                fontSize: '0.8125rem',
                color: 'text.secondary',
                border: 1,
                borderStyle: 'dashed',
                borderColor: 'border.strong',
                borderRadius: `${RADIUS.md}px`,
                px: 1.75,
                py: 1.5,
              }}
            >
              {words.note}
            </Typography>
            {reading.waiting && (
              <Typography sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                {reading.waiting}
              </Typography>
            )}
            {confirmDiscard && (
              <Alert severity="warning">
                Discard this browser’s copy? If the payment was recorded, it stays recorded: check
                Payments before recording it again.
              </Alert>
            )}
            {error && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {storedBatch &&
          (confirmDiscard ? (
            <Button color="inherit" onClick={() => void discard()}>
              Discard copy
            </Button>
          ) : (
            <Button color="inherit" onClick={() => setConfirmDiscard(true)}>
              Discard
            </Button>
          ))}
        <Button onClick={onClose}>Cancel</Button>
        {words && !earlier && (
          <Button
            variant="contained"
            disableElevation
            disabled={sending || (!storedBatch && !reading.amounts)}
            onClick={() => void record()}
          >
            {total === null ? 'Record' : `Record ${total}${storedBatch ? ' again' : ''}`}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** A Debt's rate: none in the paying currency, else the rate, where it's from, and Change. */
function RateCell({
  line,
  paidCurrency,
  fixed,
  changing,
  custom,
  state,
  onChange,
  onType,
  onUseSuggestion,
}: {
  line: SettleAllLine;
  paidCurrency: string;
  /** A stored payment's rate, checked as it was sent. */
  fixed: boolean;
  changing: boolean;
  custom: string | null;
  state: SettleAllRateState;
  onChange: () => void;
  onType: (value: string) => void;
  onUseSuggestion: () => void;
}) {
  if (line.kind === 'same') return <>Same currency</>;
  const suggestion = state.status === 'ready' ? state.suggestion : null;
  const small = { fontSize: '0.75rem', color: 'text.secondary' } as const;
  if (fixed)
    return (
      <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
        {line.rate && <span>{perUnit(line.rate, paidCurrency, line.currency)}</span>}
      </Box>
    );
  const editing = changing || state.status === 'none';
  if (editing)
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            border: 1,
            borderColor: 'border.strong',
            borderRadius: `${RADIUS.sm}px`,
            px: 1,
            minHeight: 40,
          }}
        >
          <Box component="span" sx={{ fontFamily: FONT_MONO, color: 'text.secondary' }}>
            {symbolOf(paidCurrency)}
          </Box>
          <InputBase
            value={custom ?? ''}
            onChange={(event) => onType(event.target.value)}
            placeholder="Rate"
            inputProps={{
              'aria-label': `Rate for the ${line.currency} Debt`,
              inputMode: 'decimal',
              autoComplete: 'off',
            }}
            sx={{ flex: 1, fontFamily: FONT_MONO }}
          />
          <Box component="span" sx={small}>
            per {symbolOf(line.currency)}
          </Box>
        </Box>
        <Box component="span" sx={small}>
          {rateBadge(line.kind ?? (suggestion ? 'custom' : 'entered'), suggestion)}
          {suggestion && (
            <>
              {' · '}
              <Button
                variant="text"
                size="small"
                aria-label={`Use the suggested rate for the ${line.currency} Debt, ${decimalMoney(suggestedRateText(suggestion.rate), paidCurrency)}`}
                onClick={onUseSuggestion}
                sx={{ minWidth: 0, p: 0, fontSize: 'inherit', verticalAlign: 'baseline' }}
              >
                Use {decimalMoney(suggestedRateText(suggestion.rate), paidCurrency)}
              </Button>
            </>
          )}
        </Box>
      </Box>
    );
  if (state.status === 'loading' || !line.rate) return <>Getting the suggested rate…</>;
  const note = rateNote(line.kind ?? 'suggested', suggestion, paidCurrency, new Date());
  return (
    <Box component="span" sx={{ display: 'flex', flexDirection: 'column' }}>
      <Box component="span" sx={{ fontFamily: FONT_MONO }}>
        {perUnit(line.rate, paidCurrency, line.currency)}
      </Box>
      {/* The suggestion's source on one line; it's the suggested rate until Change. */}
      <Box component="span" data-rate-part="source" sx={small}>
        {note.text}
      </Box>
      <Box component="span" sx={small}>
        <Button
          variant="text"
          size="small"
          aria-label={`Change the rate for the ${line.currency} Debt`}
          onClick={onChange}
          sx={{ minWidth: 0, p: 0, fontSize: 'inherit', verticalAlign: 'baseline' }}
        >
          Change
        </Button>
      </Box>
    </Box>
  );
}
