'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import CircularProgress from '@mui/material/CircularProgress';
import InputBase from '@mui/material/InputBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CheckIcon from '@mui/icons-material/Check';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import LaptopOutlinedIcon from '@mui/icons-material/LaptopOutlined';
import { expensePageKey } from '@splitbook/shared/query-keys';
import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { formatCurrency } from '@splitbook/shared/currency';
import { toDateParam } from '@splitbook/shared/date';
import { toMajorAmount } from '@splitbook/shared/exact-money';
import { ExpenseDraft } from '@splitbook/shared/expense-draft';
import type { GroupRead } from '@splitbook/shared/group-read';
import {
  quickAddDraftValues,
  readQuickAdd,
  suggestQuickAddTag,
  type QuickAddHistoryItem,
} from '@splitbook/shared/quick-add';
import { findReferencedTag } from '@splitbook/shared/tag-identity';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { FONT_MONO } from '@/lib/theme/tokens';
import { fetchWebExpensePage } from '@/lib/web-read';
import ExpenseFormDialog from './ExpenseFormDialog';
import { quickAddModel, type QuickAddChip, type QuickAddModel } from './quick-add-view';
import { useExpenseDraftSave } from './use-expense-draft-save';

/** What the design canvas puts in the empty field. */
export const QUICK_ADD_PLACEHOLDER = 'Dinner 2400 paid by me';
export const QUICK_ADD_NOTE = 'Read on this page as you type. Nothing is sent until you add it.';
export const QUICK_ADD_UNCONFIRMED =
  'This Expense may already be recorded: the reply never arrived. Press Enter to send the same record again, so it can’t be counted twice.';

/** The Group's latest Expenses, whose Tags Quick add learns from. Read once typing starts. */
const HISTORY_SIZE = 50;
/** How long typing pauses before a screen reader hears what was read. */
const SUMMARY_PAUSE_MS = 900;

interface QuickAddExpenseProps {
  groupId: string;
  userId: string;
  group: GroupRead;
}

/** The field's state beyond its text: how the last save went, for the text it was sent with. */
type Outcome =
  | { kind: 'unconfirmed'; text: string }
  | { kind: 'refused'; text: string; message: string }
  | { kind: 'not-sent'; text: string }
  | { kind: 'added'; description: string; amount: string };

/**
 * Quick add (#320, design canvas "GroupExpenses", state "quickadd"): one field above a Group's
 * Expenses. What the member types is read on the page into chips (description, amount, who
 * paid, the split, the date and a Tag) by the shared `readQuickAdd`, and Enter adds it through
 * the full form's own save: the same request, idempotency key and unconfirmed-save handling.
 * The Tag comes only from the Group's active Tags; when none fits, the member picks one before
 * Enter works. "More options" opens the full form with what was read.
 */
export default function QuickAddExpense({ groupId, userId, group }: QuickAddExpenseProps) {
  const currency = group.defaultCurrency;
  const members = useMemo(
    () => group.members.map(({ user }) => ({ id: user._id, name: user.name })),
    [group.members],
  );
  const activeTags = useMemo(
    () => group.tags.filter((tag) => !tag.isArchived && !tag.isDeleted),
    [group.tags],
  );
  const tagIds = useMemo(() => group.tags.map((tag) => tag._id), [group.tags]);

  const openDraft = () =>
    ExpenseDraft.open({
      groupId,
      accountId: userId,
      memberIds: members.map(({ id }) => id),
      currency,
      defaultTag: '',
      date: toDateParam(new Date()),
    });

  const [text, setText] = useState('');
  // One draft for the field's life: a reply that never arrived leaves its request in it, so
  // sending the same line again is the same request, never a second Expense.
  const [draft, setDraft] = useState(openDraft);
  const [payerPick, setPayerPick] = useState<{ said: string | null; memberId: string } | null>(
    null,
  );
  const [tagPick, setTagPick] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [formDraft, setFormDraft] = useState<ExpenseDraft | null>(null);
  const [announcement, setAnnouncement] = useState({ id: 0, text: '' });
  const { save } = useExpenseDraftSave(setDraft);
  const inputRef = useRef<HTMLInputElement>(null);

  const typing = text.trim() !== '';
  const [wantsHistory, setWantsHistory] = useState(false);
  const historyRead = useSWR(
    wantsHistory
      ? expensePageKey(WEB_QUERY_ACCOUNT, groupId, { page: 1, limit: HISTORY_SIZE })
      : null,
    fetchWebExpensePage,
    { revalidateOnFocus: false },
  );
  const historyItems = useMemo<QuickAddHistoryItem[]>(
    () =>
      (historyRead.data?.data.expenses ?? []).map((item) => {
        // Older Expenses name their Tag; the name counts when it is one Tag's.
        const tag = findReferencedTag(group.tags, item);
        return { description: item.description, tagId: tag ? String(tag._id) : null };
      }),
    [historyRead.data, group.tags],
  );

  const today = toDateParam(new Date());
  const context = useMemo(
    () => ({ currency, today, viewerId: userId, members }),
    [currency, today, userId, members],
  );
  const read = useMemo(() => readQuickAdd(text, context), [text, context]);
  const payerChoice = payerPick && payerPick.said === read.payer.said ? payerPick.memberId : null;
  const payerId = payerChoice ?? read.payer.memberId;
  const problems = payerChoice
    ? read.problems.filter((problem) => problem.field !== 'payer')
    : read.problems;
  const suggestion = useMemo(
    () =>
      suggestQuickAddTag(
        read.description,
        activeTags.map((tag) => ({ id: tag._id, name: tag.name })),
        historyItems,
      ),
    [read.description, activeTags, historyItems],
  );
  const picked = activeTags.find((tag) => tag._id === tagPick);
  const tag = picked
    ? { id: picked._id, name: picked.name, how: 'chosen' as const }
    : suggestion
      ? { id: suggestion.tagId, name: suggestion.name, how: 'suggested' as const }
      : null;
  const model = quickAddModel({
    read,
    today,
    currency,
    viewerId: userId,
    members,
    payerId,
    problems,
    tag,
  });

  // What was read, spoken once typing pauses.
  const summary = typing ? model.summary : '';
  useEffect(() => {
    if (!summary) return;
    const timeout = window.setTimeout(
      () => setAnnouncement((last) => ({ id: last.id + 1, text: summary })),
      SUMMARY_PAUSE_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [summary]);
  const announce = (message: string) =>
    setAnnouncement((last) => ({ id: last.id + 1, text: message }));

  const values = () => quickAddDraftValues(read, { payerId, tagId: tag?.id ?? '' }, context);

  const clear = () => {
    setText('');
    setPayerPick(null);
    setTagPick(null);
  };

  const add = async () => {
    if (!typing || draft.loading) return;
    if (!model.ready) {
      announce(model.message.text);
      return;
    }
    const sent = text;
    const description = read.description;
    const amount = formatCurrency(toMajorAmount(read.amountMinor!, currency), currency);
    const result = await save(draft.edit(values()), tagIds);
    if (result.status === 'saved') {
      clear();
      setDraft(openDraft());
      setOutcome({ kind: 'added', description, amount });
      announce(`Added ${description}, ${amount}.`);
      inputRef.current?.focus();
    } else if (result.status === 'unconfirmed') {
      setOutcome({ kind: 'unconfirmed', text: sent });
      announce(QUICK_ADD_UNCONFIRMED);
    } else if (result.status === 'refused') {
      setOutcome({ kind: 'refused', text: sent, message: result.message });
    } else {
      // Nothing went out: the draft says why, if anything was wrong with it.
      setOutcome({ kind: 'not-sent', text: sent });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void add();
    } else if (event.key === 'Escape' && text !== '') {
      // Clears the line; the draft keeps any unconfirmed save, so typing it again retries it.
      event.preventDefault();
      clear();
    }
  };

  // A save's outcome shows only while the line is the one it was sent with.
  const current = outcome && outcome.kind !== 'added' && outcome.text === text ? outcome : null;
  const alert =
    current?.kind === 'unconfirmed'
      ? QUICK_ADD_UNCONFIRMED
      : current?.kind === 'refused'
        ? current.message
        : current?.kind === 'not-sent' && draft.error
          ? draft.error
          : null;

  return (
    <>
      <QuickAddView
        text={text}
        onTextChange={(value) => {
          setText(value);
          if (value.trim()) setWantsHistory(true);
          if (outcome?.kind === 'added') setOutcome(null);
        }}
        onKeyDown={onKeyDown}
        onAdd={() => void add()}
        onMoreOptions={() => {
          if (!draft.loading) setFormDraft(draft.edit(values()));
        }}
        model={model}
        saving={draft.loading}
        alert={alert}
        added={!typing && outcome?.kind === 'added' ? outcome : null}
        payers={members.map(({ id, name }) => ({ id, label: id === userId ? 'You' : name }))}
        payerId={payerId}
        onPickPayer={(memberId) => setPayerPick({ said: read.payer.said, memberId })}
        tags={activeTags.map((option) => ({ id: option._id, label: option.name }))}
        tagId={tag?.id ?? null}
        onPickTag={setTagPick}
        inputRef={inputRef}
        announcement={announcement}
      />
      <ExpenseFormDialog
        open={formDraft !== null}
        onClose={() => setFormDraft(null)}
        groupId={groupId}
        group={group}
        userId={userId}
        initialDraft={formDraft}
        onSaved={() => {
          clear();
          setDraft(openDraft());
          setOutcome(null);
          announce('Expense added.');
        }}
      />
    </>
  );
}

export interface QuickAddOption {
  id: string;
  label: string;
}

export interface QuickAddViewProps {
  text: string;
  onTextChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onAdd: () => void;
  onMoreOptions: () => void;
  model: QuickAddModel;
  saving: boolean;
  /** An unconfirmed or refused save, or the draft's own error. */
  alert: string | null;
  /** The Expense just added, shown until typing starts again. */
  added: { description: string; amount: string } | null;
  payers: QuickAddOption[];
  payerId: string | null;
  onPickPayer: (id: string) => void;
  tags: QuickAddOption[];
  tagId: string | null;
  onPickTag: (id: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  announcement: { id: number; text: string };
}

/** The field, its chips and its buttons. Presentational: `QuickAddExpense` owns the state. */
export function QuickAddView({
  text,
  onTextChange,
  onKeyDown,
  onAdd,
  onMoreOptions,
  model,
  saving,
  alert,
  added,
  payers,
  payerId,
  onPickPayer,
  tags,
  tagId,
  onPickTag,
  inputRef,
  announcement,
}: QuickAddViewProps) {
  const id = useId();
  const inputId = `${id}-field`;
  const labelId = `${id}-label`;
  const messageId = `${id}-message`;
  const noteId = `${id}-note`;
  const alertId = `${id}-alert`;
  const typing = text.trim() !== '';
  const describedBy = [typing ? messageId : null, alert ? alertId : null, noteId]
    .filter(Boolean)
    .join(' ');

  const chip = (key: QuickAddChip['key']) => model.chips.find((one) => one.key === key)!;

  return (
    <Box
      component="section"
      aria-labelledby={labelId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        py: 1.25,
        pl: 1.25,
        pr: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: '16px',
        bgcolor: 'background.paper',
        '&:focus-within': {
          borderColor: 'focus.main',
          boxShadow: (theme) => `0 0 0 3px ${theme.palette.focus.ring}`,
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 48 }}>
        <Box
          aria-hidden
          sx={{
            width: 36,
            height: 36,
            flex: 'none',
            borderRadius: '11px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'tint.brand',
            color: 'primary.main',
          }}
        >
          <AddIcon sx={{ fontSize: 18 }} />
        </Box>
        <Typography
          component="label"
          id={labelId}
          htmlFor={inputId}
          sx={{ fontWeight: 600, whiteSpace: 'nowrap', color: 'text.primary' }}
        >
          Quick add
        </Typography>
        <InputBase
          id={inputId}
          value={text}
          onChange={(event) => onTextChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={QUICK_ADD_PLACEHOLDER}
          inputRef={inputRef}
          inputProps={{
            'aria-describedby': describedBy,
            'aria-invalid': typing && model.invalid ? true : undefined,
            autoComplete: 'off',
            enterKeyHint: 'done',
          }}
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 44,
            fontSize: '1rem',
            color: 'text.primary',
            '& input::placeholder': { color: 'text.secondary', opacity: 1 },
            // The card shows focus around the whole field.
            '& input:focus-visible': { outline: 'none', boxShadow: 'none' },
          }}
        />
      </Box>

      {typing ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.25,
            pl: { xs: 0, sm: '48px' },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px 16px',
            }}
          >
            <Box
              component="ul"
              aria-label="How Splitbook reads it"
              sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, m: 0, p: 0, listStyle: 'none' }}
            >
              <li>
                <ReadChip chip={chip('description')} />
              </li>
              <li>
                <ReadChip chip={chip('amount')} money />
              </li>
              <li>
                <MenuChip
                  chip={chip('payer')}
                  options={payers}
                  selected={payerId}
                  onSelect={onPickPayer}
                  empty="No current members."
                />
              </li>
              <li>
                <ReadChip chip={chip('split')} onClick={onMoreOptions} />
              </li>
              <li>
                <ReadChip chip={chip('date')} />
              </li>
              <li>
                <MenuChip
                  chip={chip('tag')}
                  options={tags}
                  selected={tagId}
                  onSelect={onPickTag}
                  empty="No active Tags. Add one in the Group’s settings."
                />
              </li>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              <Button
                variant="contained"
                onClick={onAdd}
                disabled={!model.ready || saving}
                sx={{ minHeight: 44, gap: 1, borderRadius: '12px', textTransform: 'none' }}
              >
                {saving ? <CircularProgress size={18} color="inherit" aria-hidden /> : null}
                Add expense
                <Box
                  component="kbd"
                  aria-hidden
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: 22,
                    height: 22,
                    px: 0.75,
                    borderRadius: '6px',
                    border: 1,
                    borderBottomWidth: 2,
                    borderColor: 'currentColor',
                    fontFamily: FONT_MONO,
                    fontSize: '0.71875rem',
                    fontWeight: 600,
                    lineHeight: 1,
                    opacity: 0.8,
                  }}
                >
                  ↵
                </Box>
              </Button>
              <Button
                variant="text"
                onClick={onMoreOptions}
                aria-haspopup="dialog"
                disabled={saving}
                sx={{ minHeight: 44, borderRadius: '12px', textTransform: 'none' }}
              >
                More options
              </Button>
            </Box>
          </Box>
          <Typography
            id={messageId}
            variant="body2"
            sx={{
              color:
                model.message.tone === 'invalid'
                  ? 'status.negative'
                  : model.message.tone === 'needed'
                    ? 'status.warning'
                    : 'text.primary',
            }}
          >
            {model.message.text}
          </Typography>
        </Box>
      ) : null}

      {alert ? (
        <Box
          id={alertId}
          role="alert"
          sx={{
            ml: { xs: 0, sm: '48px' },
            px: 2,
            py: 1.25,
            borderRadius: '12px',
            bgcolor: 'tint.warning',
            color: 'status.warning',
            fontSize: '0.875rem',
          }}
        >
          {alert}
        </Box>
      ) : null}

      {added ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: { xs: 0, sm: '48px' },
            color: 'status.positive',
            fontSize: '0.875rem',
          }}
        >
          <CheckCircleOutlineIcon aria-hidden sx={{ fontSize: 18 }} />
          <span>
            Added {added.description}, {added.amount}.
          </span>
        </Box>
      ) : null}

      <Typography
        id={noteId}
        variant="caption"
        sx={[
          {
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            pl: { xs: 0, sm: '48px' },
            color: 'text.secondary',
          },
          !typing && visuallyHidden,
        ]}
      >
        <LaptopOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
        {QUICK_ADD_NOTE}
      </Typography>

      <Box role="status" aria-live="polite" aria-atomic="true" sx={visuallyHidden}>
        <span key={announcement.id}>{announcement.text}</span>
      </Box>
    </Box>
  );
}

const chipSx = (state: QuickAddChip['state']) =>
  ({
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: 44,
    px: 1.5,
    py: '3px',
    borderRadius: '10px',
    border: 1,
    borderStyle: state === 'suggested' ? 'dashed' : 'solid',
    borderColor:
      state === 'suggested'
        ? 'info.main'
        : state === 'needed' || state === 'invalid'
          ? 'warning.main'
          : 'border.strong',
    bgcolor:
      state === 'suggested'
        ? 'tint.info'
        : state === 'needed' || state === 'invalid'
          ? 'tint.warning'
          : 'background.paper',
    color: state === 'needed' || state === 'invalid' ? 'status.warning' : 'text.primary',
    textAlign: 'left',
    lineHeight: 1.25,
    font: 'inherit',
  }) as const;

function ChipText({ chip, money = false }: { chip: QuickAddChip; money?: boolean }) {
  const warn = chip.state === 'needed' || chip.state === 'invalid';
  return (
    <>
      <Box
        component="span"
        aria-hidden
        data-chip-part="label"
        sx={{
          fontSize: '0.71875rem',
          fontWeight: chip.state === 'suggested' ? 600 : 500,
          color:
            chip.state === 'suggested' ? 'status.info' : warn ? 'status.warning' : 'text.secondary',
        }}
      >
        {chip.label}
      </Box>
      <Box
        component="span"
        aria-hidden
        data-chip-part="value"
        sx={[
          { fontWeight: 600, fontSize: '0.875rem' },
          money && chip.state === 'read'
            ? (theme) => ({ ...(theme.typography.money as object), fontWeight: 600 })
            : null,
        ]}
      >
        {chip.value}
      </Box>
    </>
  );
}

/** A chip read from the text, or one that opens the full form (the split). */
function ReadChip({
  chip,
  money,
  onClick,
}: {
  chip: QuickAddChip;
  money?: boolean;
  onClick?: () => void;
}) {
  if (onClick)
    return (
      <ButtonBase
        onClick={onClick}
        aria-label={chip.spoken}
        aria-haspopup="dialog"
        sx={chipSx(chip.state)}
      >
        <ChipText chip={chip} money={money} />
      </ButtonBase>
    );
  return (
    <Box component="span" sx={{ ...chipSx(chip.state), position: 'relative' }}>
      <ChipText chip={chip} money={money} />
      <Box component="span" data-chip-part="spoken" sx={visuallyHidden}>
        {chip.spoken}
      </Box>
    </Box>
  );
}

/** A chip that opens a menu: who paid, or the Tag. */
function MenuChip({
  chip,
  options,
  selected,
  onSelect,
  empty,
}: {
  chip: QuickAddChip;
  options: QuickAddOption[];
  selected: string | null;
  onSelect: (id: string) => void;
  empty: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const chipId = useId();
  return (
    <>
      <ButtonBase
        id={chipId}
        aria-label={chip.spoken}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? menuId : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
        sx={{ ...chipSx(chip.state), flexDirection: 'row', alignItems: 'center', gap: 1 }}
      >
        <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column' }}>
          <ChipText chip={chip} />
        </Box>
        <KeyboardArrowDownIcon aria-hidden sx={{ fontSize: 16 }} />
      </ButtonBase>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { 'aria-labelledby': chipId, dense: false } }}
      >
        {options.length === 0 ? (
          <MenuItem disabled sx={{ minHeight: 44 }}>
            {empty}
          </MenuItem>
        ) : (
          options.map((option) => (
            <MenuItem
              key={option.id}
              role="menuitemradio"
              aria-checked={option.id === selected}
              selected={option.id === selected}
              onClick={() => {
                setAnchor(null);
                onSelect(option.id);
              }}
              sx={{ minHeight: 44, gap: 1 }}
            >
              <Box component="span" sx={{ width: 18, display: 'inline-flex' }}>
                {option.id === selected && <CheckIcon sx={{ fontSize: 18 }} />}
              </Box>
              {option.label}
            </MenuItem>
          ))
        )}
      </Menu>
    </>
  );
}
