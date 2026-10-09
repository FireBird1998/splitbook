'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import InputBase from '@mui/material/InputBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import SearchIcon from '@mui/icons-material/Search';
import SortIcon from '@mui/icons-material/Sort';
import { formatCurrency, getCurrency } from '@splitbook/shared/currency';
import { parseAmountMinor } from '@splitbook/shared/exact-money';
import { ShortcutHint, useShortcutAria } from '@/components/shortcuts/ShortcutHint';
import { useShortcut } from '@/lib/shortcuts/ShortcutsProvider';
import {
  CLEARED_FILTERS,
  EXPENSE_DATE_WINDOWS,
  EXPENSE_SORTS,
  activeFilterCount,
  customRangeError,
  readAmount,
  type ExpenseListQuery,
} from './expense-list-query';

export interface ToolbarOption {
  id: string;
  label: string;
}

interface ExpenseToolbarProps {
  query: ExpenseListQuery;
  onChange: (change: Partial<ExpenseListQuery>) => void;
  groupName: string;
  currency: string;
  /** The Group's members, the viewer as "You". */
  members: ToolbarOption[];
  /** The Group's active Tags, plus the one in the address if it has been retired since. */
  tags: ToolbarOption[];
  /** Whether to offer today's date quick-filters (not in a Household, whose Month bar does). */
  dateWindows: boolean;
}

/** How long typing pauses before the search goes to the address. */
const SEARCH_PAUSE_MS = 300;

/**
 * Find Expenses (#310, design canvas "GroupExpenses"): search within the Group, filters for
 * Paid by, Tag, the amount and "Involves me", the date window outside a Household, and the
 * sort. It changes only the address; the list reads its view from there.
 */
export default function ExpenseToolbar({
  query,
  onChange,
  groupName,
  currency,
  members,
  tags,
  dateWindows,
}: ExpenseToolbarProps) {
  const filters = activeFilterCount(query);
  const name = (options: ToolbarOption[], id: string | null) =>
    options.find((option) => option.id === id)?.label;

  return (
    <Stack spacing={1.5}>
      <Box
        role="search"
        aria-label={`Find Expenses in ${groupName}`}
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}
      >
        <SearchField
          value={query.search}
          onSearch={(search) => onChange({ search })}
          label={`Search Expenses in ${groupName}`}
          placeholder={`Search ${groupName}`}
        />
        <MenuChip
          label="Paid by"
          value={name(members, query.paidBy) ?? 'Anyone'}
          active={query.paidBy !== null}
          options={[{ id: '', label: 'Anyone' }, ...members]}
          selected={query.paidBy ?? ''}
          onSelect={(id) => onChange({ paidBy: id || null })}
        />
        <MenuChip
          label="Tag"
          value={name(tags, query.tag) ?? 'All'}
          active={query.tag !== null}
          options={[{ id: '', label: 'All' }, ...tags]}
          selected={query.tag ?? ''}
          onSelect={(id) => onChange({ tag: id || null })}
        />
        <AmountChip
          min={query.min}
          max={query.max}
          currency={currency}
          onApply={(min, max) => onChange({ min, max })}
        />
        <Chip
          aria-pressed={query.involvesMe}
          active={query.involvesMe}
          onClick={() => onChange({ involvesMe: !query.involvesMe })}
        >
          {query.involvesMe && <CheckIcon sx={{ fontSize: 16 }} />}
          Involves me
        </Chip>
        {dateWindows && (
          <MenuChip
            label="Date"
            value={name([...EXPENSE_DATE_WINDOWS], query.when) ?? 'Any time'}
            active={query.when !== null}
            options={[{ id: '', label: 'Any time' }, ...EXPENSE_DATE_WINDOWS]}
            selected={query.when ?? ''}
            onSelect={(id) => onChange({ when: (id || null) as ExpenseListQuery['when'] })}
          />
        )}
        <MenuChip
          label="Sort"
          hideLabel
          icon={<SortIcon sx={{ fontSize: 16 }} />}
          value={name([...EXPENSE_SORTS], query.sort) ?? 'Newest first'}
          active={false}
          options={[...EXPENSE_SORTS]}
          selected={query.sort}
          onSelect={(id) => onChange({ sort: id as ExpenseListQuery['sort'] })}
        />
        {filters > 0 && (
          <Button variant="text" onClick={() => onChange(CLEARED_FILTERS)}>
            Clear filters
          </Button>
        )}
      </Box>
      {query.when === 'custom' && (
        <CustomRange from={query.from} to={query.to} onChange={onChange} />
      )}
    </Stack>
  );
}

const chipSx = (active: boolean) =>
  ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    minHeight: 44,
    px: '12px',
    borderRadius: '12px',
    border: 1,
    borderColor: active ? 'primary.main' : 'border.strong',
    bgcolor: active ? 'tint.brand' : 'background.paper',
    color: active ? 'primary.main' : 'text.primary',
    font: 'inherit',
    fontSize: '0.875rem',
    fontWeight: 500,
    whiteSpace: 'nowrap',
    '&:hover': { bgcolor: active ? 'tint.brand' : 'surface.hover' },
  }) as const;

/** A filter chip (design canvas `.fchip`); `active` when it narrows the list. */
function Chip({
  active,
  children,
  ...props
}: {
  active: boolean;
  children: ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  'aria-pressed'?: boolean;
  'aria-haspopup'?: 'menu' | 'dialog';
  'aria-expanded'?: boolean;
  'aria-controls'?: string;
  'aria-label'?: string;
  id?: string;
}) {
  return (
    <ButtonBase {...props} sx={chipSx(active)}>
      {children}
    </ButtonBase>
  );
}

function ChipValue({ active, children }: { active: boolean; children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={{ color: active ? 'primary.main' : 'text.secondary', fontWeight: active ? 600 : 500 }}
    >
      {children}
    </Box>
  );
}

/** A chip that opens a menu of choices, one of them checked. */
function MenuChip({
  label,
  hideLabel = false,
  icon,
  value,
  active,
  options,
  selected,
  onSelect,
}: {
  label: string;
  /** Show only the value (the sort), while still naming the chip. */
  hideLabel?: boolean;
  icon?: ReactNode;
  value: string;
  active: boolean;
  options: ToolbarOption[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const chipId = useId();
  return (
    <>
      <Chip
        id={chipId}
        active={active}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? menuId : undefined}
        aria-label={hideLabel ? `${label}: ${value}` : undefined}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        {icon}
        {!hideLabel && label}
        <ChipValue active={active}>{value}</ChipValue>
        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
      </Chip>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { 'aria-labelledby': chipId, dense: false } }}
      >
        {options.map((option) => (
          <MenuItem
            key={option.id}
            role="menuitemradio"
            aria-checked={option.id === selected}
            selected={option.id === selected}
            onClick={() => {
              setAnchor(null);
              if (option.id !== selected) onSelect(option.id);
            }}
            sx={{ minHeight: 44, gap: 1 }}
          >
            <Box component="span" sx={{ width: 18, display: 'inline-flex' }}>
              {option.id === selected && <CheckIcon sx={{ fontSize: 18 }} />}
            </Box>
            {option.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** "₹500 – ₹2,000", "₹500 or more", "Up to ₹2,000", or "Any". */
export function amountRangeLabel(min: string | null, max: string | null, currency: string) {
  const money = (value: string) => formatCurrency(Number(value), currency);
  if (min !== null && max !== null) return `${money(min)} – ${money(max)}`;
  if (min !== null) return `${money(min)} or more`;
  if (max !== null) return `Up to ${money(max)}`;
  return 'Any';
}

/** The amount range: a chip that opens a small form for the lowest and highest amount. */
function AmountChip({
  min,
  max,
  currency,
  onApply,
}: {
  min: string | null;
  max: string | null;
  currency: string;
  onApply: (min: string | null, max: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const dialogId = useId();
  const titleId = useId();
  const active = min !== null || max !== null;
  const symbol = getCurrency(currency)?.symbol ?? currency;

  const open = (target: HTMLElement) => {
    setLow(min ?? '');
    setHigh(max ?? '');
    setProblem(null);
    setAnchor(target);
  };
  const apply = (event: FormEvent) => {
    event.preventDefault();
    const lowest = low.trim() ? readAmount(low, currency) : null;
    const highest = high.trim() ? readAmount(high, currency) : null;
    if ((low.trim() && !lowest) || (high.trim() && !highest)) {
      setProblem(`Enter amounts like 500 or 1249.50, in ${currency}.`);
      return;
    }
    if (
      lowest &&
      highest &&
      parseAmountMinor(lowest, currency) > parseAmountMinor(highest, currency)
    ) {
      setProblem('The lowest amount must not be more than the highest.');
      return;
    }
    setAnchor(null);
    onApply(lowest, highest);
  };

  return (
    <>
      <Chip
        active={active}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? dialogId : undefined}
        onClick={(event) => open(event.currentTarget)}
      >
        Amount
        <ChipValue active={active}>{amountRangeLabel(min, max, currency)}</ChipValue>
        <KeyboardArrowDownIcon sx={{ fontSize: 16 }} />
      </Chip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        slotProps={{
          paper: {
            id: dialogId,
            role: 'dialog',
            'aria-labelledby': titleId,
            sx: { mt: 0.5, p: 2, width: 300, maxWidth: 'calc(100vw - 32px)' },
          },
        }}
      >
        <Box component="form" noValidate onSubmit={apply}>
          <Typography id={titleId} component="h2" variant="subtitle2" sx={{ mb: 1.5 }}>
            Amount range
          </Typography>
          <Stack direction="row" spacing={1}>
            <AmountField label="From" symbol={symbol} value={low} onChange={setLow} autoFocus />
            <AmountField label="To" symbol={symbol} value={high} onChange={setHigh} />
          </Stack>
          {problem && (
            <Typography
              role="alert"
              variant="caption"
              sx={{ display: 'block', mt: 1, color: 'status.negative' }}
            >
              {problem}
            </Typography>
          )}
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 2 }}>
            <Button
              onClick={() => {
                setAnchor(null);
                if (active) onApply(null, null);
              }}
            >
              Clear
            </Button>
            <Button type="submit" variant="contained">
              Apply
            </Button>
          </Stack>
        </Box>
      </Popover>
    </>
  );
}

function AmountField({
  label,
  symbol,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  symbol: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoFocus={autoFocus}
      size="small"
      slotProps={{
        htmlInput: { inputMode: 'decimal', autoComplete: 'off' },
        input: {
          startAdornment: (
            <Typography component="span" aria-hidden sx={{ mr: 0.5, color: 'text.secondary' }}>
              {symbol}
            </Typography>
          ),
        },
      }}
    />
  );
}

/**
 * The search box (design canvas `.search.gx-search`), which waits for a pause in typing. / puts
 * the cursor in it (#322), and the box shows the key until it has focus.
 */
function SearchField({
  value,
  onSearch,
  label,
  placeholder,
}: {
  value: string;
  onSearch: (search: string) => void;
  label: string;
  placeholder: string;
}) {
  const [text, setText] = useState(value);
  // The address's search the box last matched, and the last one it sent there.
  const [seen, setSeen] = useState(value);
  const [sent, setSent] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  useShortcut('search-group', () => {
    input.current?.focus();
    input.current?.select();
  });
  const keyShortcuts = useShortcutAria('search-group');
  if (value !== seen) {
    // A change from elsewhere (a search link, Back) replaces what's typed; our own doesn't.
    setSeen(value);
    if (value !== sent) {
      setSent(value);
      setText(value);
    }
  }
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (next: string) => {
    setText(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setSent(next);
      onSearch(next);
    }, SEARCH_PAUSE_MS);
  };

  return (
    <Box
      sx={{
        flex: '1 1 240px',
        maxWidth: 360,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        minHeight: 44,
        pl: '14px',
        pr: 1,
        borderRadius: '12px',
        border: 1,
        borderColor: 'border.strong',
        bgcolor: 'background.paper',
        color: 'text.secondary',
        '&:focus-within': {
          borderColor: 'focus.main',
          boxShadow: (theme) => `0 0 0 3px ${theme.palette.focus.ring}`,
        },
        // In the box, / types a slash.
        '&:focus-within [data-shortcut-hint]': { display: 'none' },
      }}
    >
      <SearchIcon sx={{ fontSize: 18 }} aria-hidden />
      <InputBase
        type="search"
        value={text}
        onChange={(event) => change(event.target.value)}
        placeholder={placeholder}
        inputRef={input}
        inputProps={{ 'aria-label': label, 'aria-keyshortcuts': keyShortcuts, maxLength: 200 }}
        sx={{
          flex: 1,
          minWidth: 0,
          color: 'text.primary',
          fontSize: '0.875rem',
          '& input::placeholder': { color: 'text.secondary', opacity: 1 },
          '& input:focus-visible': { outline: 'none', boxShadow: 'none' },
        }}
      />
      <ShortcutHint id="search-group" />
    </Box>
  );
}

/** A custom date window's first and last day. */
function CustomRange({
  from,
  to,
  onChange,
}: {
  from: string | null;
  to: string | null;
  onChange: (change: Partial<ExpenseListQuery>) => void;
}) {
  const problem = customRangeError({ when: 'custom', from, to });
  return (
    <Box
      role="group"
      aria-label="Custom date range"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        gap: 1.5,
        p: 2,
        border: 1,
        borderColor: 'divider',
        borderRadius: '12px',
        bgcolor: 'background.paper',
      }}
    >
      <TextField
        label="First day"
        type="date"
        size="small"
        value={from ?? ''}
        onChange={(event) => onChange({ when: 'custom', from: event.target.value || null, to })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <TextField
        label="Last day"
        type="date"
        size="small"
        value={to ?? ''}
        onChange={(event) => onChange({ when: 'custom', from, to: event.target.value || null })}
        slotProps={{ inputLabel: { shrink: true } }}
      />
      <Typography
        variant="caption"
        role={problem ? 'alert' : undefined}
        sx={{ alignSelf: 'center', color: problem ? 'status.negative' : 'text.secondary' }}
      >
        {problem ?? 'Up to 31 days.'}
      </Typography>
    </Box>
  );
}
