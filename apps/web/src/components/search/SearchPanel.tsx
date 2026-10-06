'use client';

import Link from 'next/link';
import { createElement, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import SearchIcon from '@mui/icons-material/Search';
import { highlightSearch, SEARCH_QUERY_MAX_LENGTH } from '@splitbook/shared/search';
import { groupThemeIcon } from '@/components/layout/group-theme-icons';
import { FONT_MONO } from '@/lib/theme/tokens';
import { SEARCH_LABEL } from './search-label';
import type { SearchOption, SearchSection } from './search-options';

/** What the dialog shows under the search field. */
export type SearchPanelState =
  | { status: 'empty' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'none'; query: string }
  | {
      status: 'results';
      sections: SearchSection[];
      /** The words to highlight. */
      terms: string[];
      /** Older results, shown while the newer ones load; they can't be chosen. */
      stale?: boolean;
    };

export interface SearchPanelProps {
  /** Ids from the dialog: its title, the list and each option by its place in the list. */
  ids: { title: string; listbox: string; option: (index: number) => string };
  query: string;
  onQueryChange: (query: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
  state: SearchPanelState;
  /** A newer search is loading. */
  busy?: boolean;
  /** The option the arrow keys are on, by its place in the list. */
  activeIndex: number;
  onActivate?: (index: number) => void;
  onChoose?: (option: SearchOption) => void;
  onRetry?: () => void;
  onClose?: () => void;
  /** What a screen reader hears when results arrive or the search fails. */
  announcement: string;
}

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

/** A keyboard key, as the design canvas draws one (web.css: .kbd). */
export const kbdSx = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  minWidth: 22,
  height: 22,
  px: 0.75,
  borderRadius: '6px',
  border: 1,
  borderBottomWidth: 2,
  borderColor: 'border.strong',
  bgcolor: 'background.paper',
  color: 'text.secondary',
  fontFamily: FONT_MONO,
  fontSize: '0.71875rem',
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
} as const;

/**
 * The search dialog's content (#321): the search field, then the empty, loading, error,
 * no-results or results state. Results are one listbox, in sections (Groups, People,
 * Expenses), driven from the field with the arrow keys: the field keeps focus and points at
 * the active option. Presentational; the dialog owns the query, the read and the keys.
 */
export default function SearchPanel({
  ids,
  query,
  onQueryChange,
  onKeyDown,
  inputRef,
  state,
  busy = false,
  activeIndex,
  onActivate,
  onChoose,
  onRetry,
  onClose,
  announcement,
}: SearchPanelProps) {
  const choosable = state.status === 'results' && !state.stale;
  const optionCount = choosable ? state.sections.reduce((n, s) => n + s.options.length, 0) : 0;
  const expanded = optionCount > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
      <Box component="h2" id={ids.title} sx={visuallyHidden}>
        Search
      </Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          minHeight: 60,
          pl: 2,
          pr: 1,
          borderBottom: '2px solid',
          borderColor: 'divider',
          '&:focus-within': { borderColor: 'primary.main' },
        }}
      >
        <SearchIcon aria-hidden sx={{ fontSize: 22, color: 'text.secondary', flex: 'none' }} />
        <Box
          component="input"
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={SEARCH_LABEL}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? ids.listbox : undefined}
          aria-activedescendant={expanded ? ids.option(activeIndex) : undefined}
          placeholder={SEARCH_LABEL}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          data-search-input=""
          value={query}
          onChange={(event) => onQueryChange((event.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            py: 1.5,
            border: 0,
            bgcolor: 'transparent',
            color: 'text.primary',
            font: 'inherit',
            // 16 px keeps phones from zooming into the field.
            fontSize: '1rem',
            // The row's bottom border shows focus instead.
            '&:focus-visible': { outline: 'none', boxShadow: 'none' },
            '&::placeholder': { color: 'text.secondary', opacity: 1 },
          }}
        />
        {busy ? (
          <CircularProgress aria-hidden size={18} thickness={5} sx={{ flex: 'none' }} />
        ) : null}
        <IconButton
          onClick={onClose}
          aria-label="Close search"
          sx={{
            width: 44,
            height: 44,
            flex: 'none',
            borderRadius: '12px',
            color: 'text.secondary',
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>

      <Box
        sx={{
          flex: '1 1 auto',
          minHeight: 0,
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          p: 1,
        }}
      >
        <PanelBody
          state={state}
          ids={ids}
          activeIndex={choosable ? activeIndex : -1}
          onActivate={choosable ? onActivate : undefined}
          onChoose={onChoose}
          onRetry={onRetry}
        />
      </Box>

      <Box
        aria-hidden
        sx={{
          display: { xs: 'none', sm: 'flex' },
          '@media (hover: none)': { display: 'none' },
          alignItems: 'center',
          gap: 2,
          px: 2,
          py: 1,
          borderTop: 1,
          borderColor: 'divider',
          color: 'text.secondary',
          fontSize: '0.75rem',
        }}
      >
        <KeyHint keys={['↑', '↓']} action="to move" />
        <KeyHint keys={['Enter']} action="to open" />
        <KeyHint keys={['Esc']} action="to close" />
      </Box>

      <Box role="status" aria-live="polite" sx={visuallyHidden}>
        {announcement}
      </Box>
    </Box>
  );
}

function KeyHint({ keys, action }: { keys: string[]; action: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {keys.map((key) => (
        <Box key={key} component="kbd" sx={kbdSx}>
          {key}
        </Box>
      ))}
      <span>{action}</span>
    </Box>
  );
}

interface PanelBodyProps {
  state: SearchPanelState;
  ids: SearchPanelProps['ids'];
  activeIndex: number;
  onActivate?: (index: number) => void;
  onChoose?: (option: SearchOption) => void;
  onRetry?: () => void;
}

function PanelBody({ state, ids, activeIndex, onActivate, onChoose, onRetry }: PanelBodyProps) {
  switch (state.status) {
    case 'empty':
      return (
        <Message
          title="Search your Groups"
          body="Find a Group, someone in your Groups, or an Expense by what it was for."
        />
      );
    case 'loading':
      return (
        <Box aria-hidden sx={{ px: 1.25, py: 1 }}>
          {[0, 1, 2].map((row) => (
            <Box key={row} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 52 }}>
              <Skeleton variant="rounded" width={32} height={32} sx={{ borderRadius: '9px' }} />
              <Box sx={{ flex: 1 }}>
                <Skeleton variant="text" width="60%" />
                <Skeleton variant="text" width="35%" sx={{ fontSize: '0.75rem' }} />
              </Box>
            </Box>
          ))}
        </Box>
      );
    case 'error':
      return (
        <Message
          title="Search didn’t load"
          body="Check your connection, then try again."
          action={
            <Button variant="outlined" onClick={onRetry}>
              Try again
            </Button>
          }
        />
      );
    case 'none':
      return (
        <Message
          title={`No results for “${state.query}”`}
          body="Search finds Group names, people’s names and Expense descriptions with words that start with what you type."
        />
      );
    case 'results': {
      // Each section's first option's place in the whole list.
      const starts = state.sections.map((_, at) =>
        state.sections.slice(0, at).reduce((count, section) => count + section.options.length, 0),
      );
      return (
        <Box
          role="listbox"
          id={ids.listbox}
          aria-label="Search results"
          sx={{ opacity: state.stale ? 0.6 : 1 }}
        >
          {state.sections.map((section, sectionAt) => {
            const headingId = `${ids.listbox}-${section.key}`;
            return (
              <Box key={section.key} role="presentation" sx={{ '& + &': { mt: 1 } }}>
                <Box
                  id={headingId}
                  aria-hidden
                  sx={{
                    px: 1.25,
                    pt: 1,
                    pb: 0.5,
                    fontSize: '0.71875rem',
                    lineHeight: 1.3,
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'text.secondary',
                  }}
                >
                  {section.label}
                </Box>
                <Box role="group" aria-labelledby={headingId}>
                  {section.options.map((option, optionAt) => {
                    const at = starts[sectionAt] + optionAt;
                    return (
                      <OptionRow
                        key={option.key}
                        id={ids.option(at)}
                        option={option}
                        terms={state.terms}
                        active={at === activeIndex}
                        onActivate={onActivate ? () => onActivate(at) : undefined}
                        onChoose={onChoose ? () => onChoose(option) : undefined}
                      />
                    );
                  })}
                </Box>
                {section.more ? (
                  <Box
                    aria-hidden
                    sx={{ px: 1.25, pt: 0.5, fontSize: '0.75rem', color: 'text.secondary' }}
                  >
                    {section.key === 'expenses'
                      ? 'Showing the newest. Type more to narrow the search.'
                      : 'Showing the first few. Type more to narrow the search.'}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      );
    }
  }
}

function Message({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        px: 2,
        py: { xs: 4, sm: 5 },
        textAlign: 'center',
      }}
    >
      <Typography
        component="p"
        variant="subtitle1"
        sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
      >
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 380 }}>
        {body}
      </Typography>
      {action ? <Box sx={{ mt: 1 }}>{action}</Box> : null}
    </Box>
  );
}

interface OptionRowProps {
  id: string;
  option: SearchOption;
  terms: string[];
  active: boolean;
  onActivate?: () => void;
  onChoose?: () => void;
}

function OptionRow({ id, option, terms, active, onActivate, onChoose }: OptionRowProps) {
  return (
    <Box
      component={Link}
      href={option.href}
      prefetch={false}
      id={id}
      role="option"
      // One name, read the same way everywhere: the title, its details and any amount.
      aria-label={[option.title, option.detail, option.kind === 'expense' ? option.amount : null]
        .filter(Boolean)
        .join(', ')}
      aria-selected={active}
      tabIndex={-1}
      data-search-kind={option.kind}
      onMouseMove={active ? undefined : onActivate}
      onClick={(event) => {
        // A click that opens the result in a new tab or window leaves the search open.
        if (
          event.button === 0 &&
          !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        )
          onChoose?.();
      }}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        minHeight: 52,
        px: 1.25,
        py: 0.75,
        borderRadius: '10px',
        color: 'text.primary',
        textDecoration: 'none',
        '&:hover': { bgcolor: 'surface.hover' },
        '&[aria-selected="true"]': {
          bgcolor: 'tint.brand',
          outline: '2px solid',
          outlineColor: 'focus.main',
          outlineOffset: -2,
        },
        '&[aria-selected="true"] .search-option-tile': { bgcolor: 'background.paper' },
      }}
    >
      <OptionTile option={option} />
      <Box sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          component="span"
          sx={{
            fontSize: '0.875rem',
            lineHeight: 1.4,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {highlightSearch(option.title, terms).map((part, at) =>
            part.match ? (
              <Box
                key={at}
                component="mark"
                sx={{ bgcolor: 'transparent', color: 'primary.main', fontWeight: 700 }}
              >
                {part.text}
              </Box>
            ) : (
              <span key={at}>{part.text}</span>
            ),
          )}
        </Box>
        <Box
          component="span"
          sx={{
            fontSize: '0.75rem',
            lineHeight: 1.35,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {option.detail}
        </Box>
      </Box>
      {option.kind === 'expense' && option.amount ? (
        <Box
          component="span"
          sx={(theme) => ({
            ...theme.typography.money,
            flex: 'none',
            fontSize: '0.8125rem',
            color: 'text.primary',
          })}
        >
          {option.amount}
        </Box>
      ) : null}
    </Box>
  );
}

function OptionTile({ option }: { option: SearchOption }) {
  const tile = {
    width: 32,
    height: 32,
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9px',
  } as const;
  if (option.kind === 'group')
    return (
      <Box
        className="search-option-tile"
        aria-hidden
        sx={{ ...tile, bgcolor: 'tint.brand', color: 'primary.main' }}
      >
        {createElement(groupThemeIcon(option.category), { sx: { fontSize: 18 } })}
      </Box>
    );
  if (option.kind === 'person')
    return (
      <Box
        className="search-option-tile"
        aria-hidden
        sx={{
          ...tile,
          borderRadius: '11px',
          bgcolor: 'tint.brand',
          color: 'primary.main',
          fontSize: '0.75rem',
          fontWeight: 600,
        }}
      >
        {option.initials}
      </Box>
    );
  return (
    <Box
      className="search-option-tile"
      aria-hidden
      sx={{ ...tile, bgcolor: 'surface.muted', color: 'text.secondary' }}
    >
      <ReceiptLongOutlinedIcon sx={{ fontSize: 18 }} />
    </Box>
  );
}
