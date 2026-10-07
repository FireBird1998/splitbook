'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import CircularProgress from '@mui/material/CircularProgress';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputBase from '@mui/material/InputBase';
import NativeSelect from '@mui/material/NativeSelect';
import Typography from '@mui/material/Typography';
import type { Theme } from '@mui/material/styles';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { formatCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor, toMajorAmount } from '@splitbook/shared/exact-money';
import { canRecordSettlement } from '@splitbook/shared/settlement-authorization';
import { suggestedSettlementMinor } from '@splitbook/shared/settlement-preview';
import { apiFetch, pinExpectedAccount, reloadForAccountChange } from '@/lib/utils/api-fetch';
import { useSettlementAttempts } from '@/lib/hooks/use-settlement-attempts';
import {
  browserAttemptStorage,
  browserPairLock,
  discardSettlementAttempt,
  recordSettlement,
  type NamedSettlementPayment,
  type SettlementAttempt,
} from '@/lib/settlement-attempts';
import {
  OVERPAY_TICK,
  RECORD_PAYMENT_FOOTNOTE,
  amountInputText,
  checkNewPayment,
  currencyLabel,
  money,
  standing,
  whoSees,
  type LedgerState,
} from './record-payment';

const UNCONFIRMED =
  'This payment may already be recorded. Recording it again sends the same record, so it can’t be counted twice.';
const GONE =
  'That payment was confirmed or discarded in another tab, so this can’t send anything. Check Payments below before recording another payment.';
const NOT_STORED =
  'Nothing was sent: this browser couldn’t keep a copy of the payment to retry it safely. Allow this site to store data, then record it again.';
const STALE =
  'Nothing was sent: this page was opened for a different account than the one signed in now. It reloads for the current account.';
const NOT_DISCARDED = 'This browser couldn’t discard the payment. Try again.';
export const DISCARDED =
  'This browser’s copy of the payment was discarded. Nothing was removed from the Group.';

/** Someone who can be picked as From or To. */
export interface PaymentParty {
  id: string;
  name: string;
}

/** Where the form starts: blank, a suggested payment, or a stored one to check. */
export interface RecordPaymentStart {
  from: string;
  to: string;
  /** The amount field's text, such as a suggestion's "1060.00". */
  amount?: string;
  note?: string;
  /** Whether "I meant to pay more than suggested" starts ticked. */
  ack?: boolean;
  /**
   * `record` a payment; `check` a stored one that may already be recorded, which never becomes
   * a new payment. Either shows the payment stored for the pair, if any.
   */
  purpose?: 'record' | 'check';
  /** Move focus into the form: to From, to the amount, or to what the last payment came to. */
  focus?: 'from' | 'amount' | 'outcome';
}

export interface RecordPaymentFormProps {
  groupId: string;
  groupName: string;
  /** The account the page was rendered for; it owns the payments stored in this browser. */
  accountId: string;
  /** The Group's currency: every new payment is in it. */
  currency: string;
  /** The Group's members, who can be picked as From and To. */
  members: PaymentParty[];
  /** The Group's balances in its currency, for the suggestion and the overpayment check. */
  ledger: LedgerState;
  start: RecordPaymentStart;
  /** What the last payment came to, shown when the form starts afresh. */
  outcome?: string | null;
  /** The form is done: a payment was recorded or discarded, or the member starts again. */
  onDone: (outcome: string | null) => void;
  /** Balances and Payments should read again. */
  onRefresh: () => void;
  /** The pair the form shows, so Settle up can mark its row. */
  onPairChange?: (pair: { from: string; to: string }) => void;
}

const samePair = (attempt: SettlementAttempt, a: string, b: string) =>
  [attempt.paidBy, attempt.paidTo].sort().join() === [a, b].sort().join();

/** "You paid Priya Shah ₹250.25.", "Sam Chen paid you ₹100.00.", from the viewer's side. */
function recordedMessage(payment: NamedSettlementPayment, viewerId: string) {
  const amount = formatCurrency(payment.amount, payment.currency);
  const payer = payment.paidBy === viewerId ? 'You' : payment.paidByName;
  const payee = payment.paidTo === viewerId ? 'you' : payment.paidToName;
  return `Payment recorded. ${payer} paid ${payee} ${amount}.`;
}

/** A stored payment's amount as the field shows it, "250.25", whatever its currency's places. */
function storedAmountText(attempt: SettlementAttempt) {
  try {
    return amountInputText(parseAmountMinor(attempt.amount, attempt.currency), attempt.currency);
  } catch {
    return String(attempt.amount);
  }
}

const CARD_RADIUS = '16px';
const labelSx = { fontSize: '0.78rem', fontWeight: 600, color: 'text.secondary' } as const;
/** A field as the design canvas draws it (web.css: .input), with the theme's focus ring. */
const fieldSx = (theme: Theme) => ({
  minHeight: 44,
  width: '100%',
  border: 1,
  borderColor: 'border.strong',
  borderRadius: '10px',
  bgcolor: 'background.paper',
  color: 'text.primary',
  px: 1.5,
  fontSize: '0.9375rem',
  '&.Mui-focused': {
    borderColor: 'focus.main',
    boxShadow: `0 0 0 3px ${theme.palette.focus.ring}`,
  },
  // The field's border shows focus, so the control inside it doesn't add the global ring.
  '& input:focus-visible, & select:focus-visible': { outline: 'none', boxShadow: 'none' },
  '& .MuiNativeSelect-select': { height: 42, py: 0, pl: 0, pr: '26px !important' },
  '& .MuiNativeSelect-icon': { color: 'text.secondary' },
});

/**
 * Record payment, on the Balances tab (#312). It records a Settlement between two members, one
 * of whom must be the member: From and To accept any two members, and say when the pair isn't
 * one the member can record. The shared settlement preview gives the amount that settles the
 * pair, warns before paying more (Record then waits for an explicit tick), and shows where each
 * side would stand afterwards. Every payment is in the Group's currency.
 *
 * A payment is stored in this browser before its first send (see `@/lib/settlement-attempts`),
 * so a lost reply is an unconfirmed save, never a second record: while one is stored for the
 * pair shown, the form shows it read-only, Record resends it unchanged, and Discard waits until
 * the member has been told to check Payments. Once a payment it showed is confirmed or
 * discarded in another tab, the form sends nothing until the member starts a new payment.
 */
export default function RecordPaymentForm({
  groupId,
  groupName,
  accountId,
  currency,
  members,
  ledger,
  start,
  outcome = null,
  onDone,
  onRefresh,
  onPairChange,
}: RecordPaymentFormProps) {
  const [from, setFrom] = useState(start.from);
  const [to, setTo] = useState(start.to);
  const [amount, setAmount] = useState(start.amount ?? '');
  /** Typed by the member, so a new pair keeps it rather than taking the pair's suggestion. */
  const [amountTyped, setAmountTyped] = useState(false);
  const [note, setNote] = useState(start.note ?? '');
  const [ack, setAck] = useState(start.ack ?? false);
  const [purpose, setPurpose] = useState(start.purpose ?? 'record');
  const [showOutcome, setShowOutcome] = useState(Boolean(outcome));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** A save found another payment for the pair stored first. */
  const [earlierFirst, setEarlierFirst] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** The key of the payment this form stored, which is no "earlier" payment. */
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  /** A payment this form showed that was confirmed or discarded elsewhere: it may be recorded. */
  const [gone, setGone] = useState<SettlementAttempt | null>(null);
  /** This form is saving or discarding, so a stored payment it removes is not news. */
  const acting = useRef(false);
  const shownAttempt = useRef<SettlementAttempt | null>(null);
  const fromField = useRef<HTMLSelectElement>(null);
  const amountField = useRef<HTMLInputElement>(null);
  const outcomeBox = useRef<HTMLDivElement>(null);
  const focusOnStart = useRef(start.focus);

  const attempts = useSettlementAttempts(accountId, groupId);
  const stored =
    from && to && from !== to
      ? (attempts.find((attempt) => samePair(attempt, from, to)) ?? null)
      : null;

  // A stored payment that disappears while it is shown was settled in another tab.
  useEffect(() => {
    if (stored) {
      shownAttempt.current = stored;
      return;
    }
    const lost = shownAttempt.current;
    shownAttempt.current = null;
    if (lost && !acting.current) {
      setGone(lost);
      setNotice(GONE);
      setError('');
      setConfirmDiscard(false);
      onRefresh();
    }
  }, [stored, onRefresh]);

  useEffect(() => {
    if (focusOnStart.current === 'from') fromField.current?.focus();
    if (focusOnStart.current === 'amount') amountField.current?.focus();
    if (focusOnStart.current === 'outcome') outcomeBox.current?.focus();
  }, []);

  // The payment shown is gone, or was only ever to be checked: this is no new payment.
  const blocked = !stored && (gone !== null || purpose === 'check');
  /** What the fields show, read-only: the stored payment, or the one that went. */
  const shown = stored ?? (blocked ? gone : null);
  const readOnly = stored !== null || blocked;
  const shownFrom = shown?.paidBy ?? from;
  const shownTo = shown?.paidTo ?? to;

  useEffect(() => {
    onPairChange?.({ from: shownFrom, to: shownTo });
  }, [shownFrom, shownTo, onPairChange]);

  // Names as each person is known: members by their account, others by the payment stored.
  const realNames = new Map(members.map((member) => [member.id, member.name]));
  for (const attempt of [stored, gone]) {
    if (!attempt) continue;
    if (!realNames.has(attempt.paidBy)) realNames.set(attempt.paidBy, attempt.paidByName);
    if (!realNames.has(attempt.paidTo)) realNames.set(attempt.paidTo, attempt.paidToName);
  }
  const realName = (id: string) => realNames.get(id) ?? 'Former member';
  const label = (id: string) => (id === accountId ? 'You' : realName(id));

  const check = readOnly
    ? null
    : checkNewPayment(
        { from, to, amount, note, ack },
        { viewerId: accountId, currency, ledger, nameOf: label },
      );

  const startFresh = () => {
    shownAttempt.current = null;
    setPurpose('record');
    setGone(null);
    setNotice('');
    setError('');
    setEarlierFirst(false);
    setConfirmDiscard(false);
    setCreatedKey(null);
    setAck(false);
    setShowOutcome(false);
  };

  /** A new pair, from From or To: it takes the pair's suggestion unless an amount was typed. */
  const choosePair = (nextFrom: string, nextTo: string) => {
    startFresh();
    setFrom(nextFrom);
    setTo(nextTo);
    if (amountTyped) return;
    const suggested =
      ledger.status === 'ready' &&
      nextFrom &&
      nextTo &&
      nextFrom !== nextTo &&
      canRecordSettlement(accountId, nextFrom, nextTo)
        ? suggestedSettlementMinor(ledger.ledger, nextFrom, nextTo)
        : 0;
    setAmount(suggested > 0 ? amountInputText(suggested, currency) : '');
  };

  const handleSubmit = async () => {
    if (blocked) {
      setNotice(GONE);
      return;
    }
    let payment: NamedSettlementPayment | undefined;
    if (!stored) {
      if (!check?.ready || check.amount.status !== 'valid') return;
      payment = {
        paidBy: from,
        paidTo: to,
        amount: toMajorAmount(check.amount.amountMinor, currency),
        currency,
        note,
        paidByName: realName(from),
        paidToName: realName(to),
      };
    }
    const sending = stored ?? payment!;
    setLoading(true);
    acting.current = true;
    setError('');
    setNotice('');
    setShowOutcome(false);

    try {
      const result = await recordSettlement({
        storage: browserAttemptStorage(),
        accountId,
        groupId,
        resend: stored,
        payment,
        newKey: () => {
          const key = crypto.randomUUID();
          setCreatedKey(key);
          return key;
        },
        post: (key, body) =>
          apiFetch(`/api/groups/${groupId}/settlements`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
            body,
          }),
        lock: browserPairLock(),
        // The same check the signed-in layout makes: is this page's account the one it sends as?
        pinnedToAccount: () => pinExpectedAccount(accountId),
      });
      // Removed by this save: not a payment settled elsewhere.
      if (result.status === 'recorded' || result.status === 'rejected') shownAttempt.current = null;

      switch (result.status) {
        case 'recorded':
          onDone(recordedMessage(sending, accountId));
          return;
        case 'earlier':
          setEarlierFirst(true);
          return;
        case 'gone':
          shownAttempt.current = null;
          setGone(stored);
          setNotice(GONE);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      acting.current = false;
      setLoading(false);
    }
  };

  const handleDiscard = async () => {
    const storage = browserAttemptStorage();
    if (!stored || !storage) return;
    acting.current = true;
    shownAttempt.current = null;
    let removed: boolean;
    try {
      removed = await discardSettlementAttempt(storage, stored, browserPairLock());
    } catch {
      setError(NOT_DISCARDED);
      return;
    } finally {
      acting.current = false;
    }
    onRefresh();
    if (removed) {
      onDone(DISCARDED);
      return;
    }
    // Already confirmed or discarded elsewhere.
    setGone(stored);
    setNotice(GONE);
    setConfirmDiscard(false);
  };

  // A first send in flight is not in doubt yet; once it fails, the warning shows.
  const inDoubt = stored !== null && !(loading && stored.key === createdKey);
  // Another payment for this pair was stored before: it has to be settled first.
  const earlier =
    stored !== null && stored.key !== createdKey && (purpose === 'record' || earlierFirst);
  const payer = shown?.paidByName ?? realName(from);
  const payee = shown?.paidToName ?? realName(to);
  const noticeText = notice || (blocked ? GONE : '');
  const amountText = shown ? storedAmountText(shown) : amount;
  const noteText = shown ? shown.note : note;
  const sendLabel = shown
    ? formatCurrency(shown.amount, shown.currency)
    : check?.amount.status === 'valid'
      ? money(check.amount.amountMinor, currency)
      : null;
  const amountError = check?.amount.status === 'invalid' ? check.amount.message : null;
  const canSend = !loading && !blocked && (stored !== null || check?.ready === true);
  const why = check?.waitingFor ?? null;
  const suggestedMinor = check?.suggestedMinor ?? null;
  const preview = check?.preview ?? null;
  const pairValid = Boolean(shownFrom && shownTo) && !check?.partyError;

  // Members first, then anyone shown who has since left (named by the stored payment).
  const options = [
    ...new Set([...members.map((member) => member.id), shownFrom, shownTo].filter(Boolean)),
  ];

  const select = (id: 'from' | 'to', value: string) => (
    <NativeSelect
      value={value}
      onChange={(event: ChangeEvent<HTMLSelectElement>) =>
        id === 'from'
          ? choosePair(event.target.value, shownTo)
          : choosePair(shownFrom, event.target.value)
      }
      disabled={loading}
      input={<InputBase sx={fieldSx} inputRef={id === 'from' ? fromField : undefined} />}
      inputProps={{ id: `record-payment-${id}` }}
    >
      {value === '' && (
        <option value="" disabled>
          Choose
        </option>
      )}
      {options.map((option) => (
        <option key={option} value={option}>
          {label(option)}
        </option>
      ))}
    </NativeSelect>
  );

  return (
    <Box
      component="section"
      aria-labelledby="record-payment-heading"
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: CARD_RADIUS,
        minWidth: 0,
      }}
    >
      <Box sx={{ px: 2.5, pt: 2, pb: 1, minHeight: 56 }}>
        <Typography
          id="record-payment-heading"
          component="h2"
          sx={{ m: 0, fontSize: '1rem', lineHeight: 1.3, fontWeight: 600, color: 'text.primary' }}
        >
          Record payment
        </Typography>
        <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary' }}>
          {groupName} · {currency}
        </Typography>
      </Box>

      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) void handleSubmit();
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, px: 2.5, pt: 0.5, pb: 2.5 }}
      >
        {showOutcome && outcome && (
          <Alert
            ref={outcomeBox}
            tabIndex={-1}
            severity="success"
            role="status"
            sx={{ '&:focus-visible': { outline: 2, outlineColor: 'focus.main' } }}
          >
            {outcome}
          </Alert>
        )}

        {error && (
          <Box
            role="alert"
            sx={{
              bgcolor: 'tint.negative',
              color: 'status.negative',
              px: 1.5,
              py: 1,
              borderRadius: '12px',
              fontSize: '0.875rem',
            }}
          >
            {error}
          </Box>
        )}

        {inDoubt && (
          <Alert severity="warning" role="status">
            <AlertTitle>Payment not confirmed</AlertTitle>
            {UNCONFIRMED}
            {earlier && (
              <Box component="span" sx={{ display: 'block', mt: 1 }}>
                This earlier payment between {payer} and {payee} isn’t confirmed yet, so it comes
                first. Record it again, or discard it, before recording another payment between
                them.
              </Box>
            )}
          </Alert>
        )}

        {!stored && noticeText && (
          <Alert severity="info" role="status">
            {noticeText}
          </Alert>
        )}

        <Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
              alignItems: 'end',
              gap: 1,
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
              <Box component="label" htmlFor="record-payment-from" sx={labelSx}>
                From
              </Box>
              {select('from', shownFrom)}
            </Box>
            <Box
              aria-hidden
              sx={{
                height: 44,
                display: 'inline-flex',
                alignItems: 'center',
                color: 'text.disabled',
              }}
            >
              <ArrowForwardIcon sx={{ fontSize: 18 }} />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, minWidth: 0 }}>
              <Box component="label" htmlFor="record-payment-to" sx={labelSx}>
                To
              </Box>
              {select('to', shownTo)}
            </Box>
          </Box>
          {check?.partyError && (
            <Typography role="alert" sx={{ mt: 1, fontSize: '0.875rem', color: 'status.negative' }}>
              {check.partyError}
            </Typography>
          )}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              minHeight: 24,
            }}
          >
            <Box component="label" htmlFor="record-payment-amount" sx={labelSx}>
              Amount paid
            </Box>
            {suggestedMinor !== null && suggestedMinor > 0 && (
              <Button
                variant="text"
                size="small"
                aria-label={`Suggested ${money(suggestedMinor, currency)}: use this amount`}
                onClick={() => {
                  setAmount(amountInputText(suggestedMinor, currency));
                  setAmountTyped(false);
                  setAck(false);
                  setShowOutcome(false);
                }}
                sx={{ minHeight: 32, px: 1, mr: -1, fontSize: '0.75rem', fontWeight: 500 }}
              >
                Suggested&nbsp;
                <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
                  {money(suggestedMinor, currency)}
                </Box>
              </Button>
            )}
          </Box>
          <InputBase
            inputRef={amountField}
            value={amountText}
            onChange={(event) => {
              setAmount(event.target.value);
              setAmountTyped(true);
              setAck(false);
              setShowOutcome(false);
            }}
            startAdornment={
              <Box
                component="span"
                role="img"
                aria-label={currencyLabel(shown?.currency ?? currency)}
                sx={(theme) => ({
                  ...theme.typography.money,
                  flex: 'none',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  color: 'text.secondary',
                  bgcolor: 'surface.muted',
                  borderRadius: '8px',
                  px: 1.125,
                  py: 0.625,
                  mr: 1.25,
                })}
              >
                {shown?.currency ?? currency}
              </Box>
            }
            inputProps={{
              id: 'record-payment-amount',
              inputMode: 'decimal',
              autoComplete: 'off',
              readOnly,
              'aria-invalid': amountError ? 'true' : 'false',
              'aria-describedby': amountError ? 'record-payment-amount-error' : undefined,
            }}
            sx={(theme) => ({
              minHeight: 60,
              border: 1,
              borderColor: amountError ? 'status.negative' : 'border.strong',
              boxShadow: amountError ? `inset 0 0 0 1px ${theme.palette.status.negative}` : 'none',
              borderRadius: '12px',
              bgcolor: readOnly ? 'surface.muted' : 'background.paper',
              color: 'text.primary',
              pl: 1.25,
              pr: 1.75,
              '&.Mui-focused': {
                borderColor: 'focus.main',
                boxShadow: `0 0 0 3px ${theme.palette.focus.ring}`,
              },
              '& input:focus-visible': { outline: 'none', boxShadow: 'none' },
              '& input': {
                ...theme.typography.money,
                fontSize: '1.625rem',
                letterSpacing: '-0.03em',
                py: 1,
              },
            })}
          />
          {amountError && (
            <Typography
              id="record-payment-amount-error"
              sx={{ m: 0, fontSize: '0.75rem', color: 'status.negative' }}
            >
              {amountError}
            </Typography>
          )}
        </Box>

        {check?.overpayment && (
          <Box
            sx={{
              display: 'flex',
              gap: 1.5,
              alignItems: 'flex-start',
              px: 1.75,
              py: 1.5,
              borderRadius: '12px',
              bgcolor: 'tint.warning',
              color: 'text.primary',
              fontSize: '0.8125rem',
              lineHeight: 1.45,
            }}
          >
            <Box
              component="svg"
              viewBox="0 0 24 24"
              aria-hidden
              sx={{
                width: 20,
                height: 20,
                flex: 'none',
                mt: '1px',
                fill: 'none',
                stroke: 'currentColor',
                strokeWidth: 1.8,
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                color: 'status.warning',
              }}
            >
              <path d="M12 4l9 16H3z" />
              <path d="M12 10v4M12 17h.01" />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minWidth: 0 }}>
              <span role="status">{check.overpayment}</span>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={ack}
                    onChange={(event) => setAck(event.target.checked)}
                    size="small"
                  />
                }
                label={OVERPAY_TICK}
                slotProps={{ typography: { sx: { fontSize: '0.875rem', fontWeight: 600 } } }}
                sx={{ minHeight: 40, ml: -0.75, mr: 0 }}
              />
            </Box>
          </Box>
        )}

        {preview && (
          <Box
            component="section"
            aria-labelledby="record-payment-after"
            sx={{ bgcolor: 'surface.muted', borderRadius: '12px', px: 1.75, py: 1.25 }}
          >
            <Typography
              id="record-payment-after"
              component="h3"
              sx={{
                m: 0,
                mb: 0.5,
                fontSize: '0.72rem',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'text.secondary',
              }}
            >
              After this payment
            </Typography>
            <Box component="dl" sx={{ m: 0 }}>
              {[preview.paidBy, preview.paidTo].map((side) => {
                const isViewer = side.userId === accountId;
                const position = standing(side.afterMinor, currency, isViewer);
                return (
                  <Box
                    key={side.userId}
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      gap: 1.5,
                      py: 0.5,
                      fontSize: '0.875rem',
                    }}
                  >
                    <Box
                      component="dt"
                      sx={{ fontWeight: 600, color: 'text.primary', minWidth: 0 }}
                    >
                      {label(side.userId)}
                    </Box>{' '}
                    <Box component="dd" sx={{ m: 0, color: 'text.secondary', textAlign: 'right' }}>
                      {position.words}
                      {position.amount && (
                        <>
                          {' '}
                          <Box
                            component="span"
                            sx={(theme) => ({
                              ...theme.typography.money,
                              color: side.afterMinor < 0 ? 'status.negative' : 'status.positive',
                            })}
                          >
                            {position.amount}
                          </Box>
                        </>
                      )}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Box component="label" htmlFor="record-payment-note" sx={labelSx}>
            Note, optional
          </Box>
          <InputBase
            value={noteText}
            onChange={(event) => {
              setNote(event.target.value);
              setShowOutcome(false);
            }}
            placeholder="e.g. Paid via UPI"
            inputProps={{
              id: 'record-payment-note',
              readOnly,
              'aria-invalid': check?.noteError ? 'true' : 'false',
              'aria-describedby': check?.noteError ? 'record-payment-note-error' : undefined,
            }}
            sx={[
              fieldSx,
              { bgcolor: readOnly ? 'surface.muted' : 'background.paper' },
              Boolean(check?.noteError) && { borderColor: 'status.negative' },
            ]}
          />
          {check?.noteError && (
            <Typography
              id="record-payment-note-error"
              sx={{ m: 0, fontSize: '0.75rem', color: 'status.negative' }}
            >
              {check.noteError}
            </Typography>
          )}
        </Box>

        {inDoubt && confirmDiscard && (
          <Alert severity="error" role="status">
            <AlertTitle>Check the Group’s payments first</AlertTitle>
            If Payments shows {payer} paying {payee}{' '}
            {formatCurrency(stored.amount, stored.currency)}, this payment was recorded: keep it.
            Discarding only forgets this browser’s copy. It never removes a recorded payment, and
            the next payment between them is sent as a new one.
          </Alert>
        )}

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {inDoubt && confirmDiscard ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'flex-end' }}>
              <Button
                onClick={() => setConfirmDiscard(false)}
                color="inherit"
                sx={{ minHeight: 44 }}
              >
                Keep payment
              </Button>
              <Button
                onClick={() => void handleDiscard()}
                variant="contained"
                color="error"
                sx={{ minHeight: 44, borderRadius: '12px' }}
              >
                Discard payment
              </Button>
            </Box>
          ) : (
            <>
              <Button
                type="submit"
                variant="contained"
                fullWidth
                disabled={!canSend}
                aria-describedby={why ? 'record-payment-why' : undefined}
                sx={{ minHeight: 44, borderRadius: '12px', gap: 1, fontSize: '0.875rem' }}
              >
                {loading ? (
                  <>
                    <CircularProgress size={18} color="inherit" aria-hidden />
                    Recording…
                  </>
                ) : (
                  <>
                    Record payment
                    {sendLabel && ' '}
                    {sendLabel && (
                      <Box component="span" sx={(theme) => ({ ...theme.typography.money })}>
                        {sendLabel}
                      </Box>
                    )}
                  </>
                )}
              </Button>
              {why && (
                <Typography
                  id="record-payment-why"
                  sx={{ m: 0, fontSize: '0.75rem', color: 'text.secondary', textAlign: 'center' }}
                >
                  {why}
                </Typography>
              )}
              {inDoubt && (
                <Button
                  onClick={() => setConfirmDiscard(true)}
                  color="error"
                  disabled={loading}
                  sx={{ minHeight: 44, alignSelf: 'flex-start' }}
                >
                  Discard this payment
                </Button>
              )}
              {blocked && (
                <Button
                  onClick={() => onDone(null)}
                  variant="outlined"
                  sx={{ minHeight: 44, borderRadius: '12px', alignSelf: 'flex-start' }}
                >
                  Start a new payment
                </Button>
              )}
            </>
          )}
          {!readOnly && pairValid && shownFrom && shownTo && (
            <Typography sx={{ m: 0, fontSize: '0.875rem', color: 'text.secondary' }}>
              {whoSees(accountId, shownFrom, shownTo, label)}
            </Typography>
          )}
          <Typography sx={{ m: 0, fontSize: '0.75rem', color: 'text.disabled' }}>
            {RECORD_PAYMENT_FOOTNOTE}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
