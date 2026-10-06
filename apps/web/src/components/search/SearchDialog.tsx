'use client';

import { useCallback, useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import Dialog from '@mui/material/Dialog';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { normalizeSearchQuery, searchTerms } from '@splitbook/shared/search';
import type { SearchRead } from '@splitbook/shared/search-read';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue, useSearch } from '@/lib/hooks/use-search';
import SearchPanel, { type SearchPanelState } from './SearchPanel';
import { resultsSummary, searchSections, type SearchOption } from './search-options';

interface SearchDialogProps {
  open: boolean;
  /** What the field holds when the dialog opens: a key typed on the top bar's field, or nothing. */
  initialQuery: string;
  onClose: () => void;
}

/**
 * Search across the member's Groups (#321): a dialog with one field, results grouped into
 * Groups, People and Expenses, the arrow keys to move, Enter to open and Escape to close. It
 * opens near the top of the screen, and fills it on a phone.
 */
export default function SearchDialog({ open, initialQuery, onClose }: SearchDialogProps) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('sm'));
  const titleId = useId();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={phone}
      aria-labelledby={titleId}
      sx={{ '& .MuiDialog-container': { alignItems: phone ? 'stretch' : 'flex-start' } }}
      slotProps={{
        paper: {
          sx: phone
            ? { bgcolor: 'surface.elevated', backgroundImage: 'none', borderRadius: 0 }
            : {
                width: 640,
                maxWidth: 'calc(100% - 32px)',
                maxHeight: 'min(640px, calc(100% - 14vh))',
                mt: '10vh',
                mx: 2,
                bgcolor: 'surface.elevated',
                backgroundImage: 'none',
                border: 1,
                borderColor: 'divider',
                overflow: 'hidden',
              },
        },
      }}
    >
      {/* Mounted while open, so each opening starts from its own query. */}
      <SearchDialogBody titleId={titleId} initialQuery={initialQuery} onClose={onClose} />
    </Dialog>
  );
}

interface SearchDialogBodyProps {
  titleId: string;
  initialQuery: string;
  onClose: () => void;
}

function SearchDialogBody({ titleId, initialQuery, onClose }: SearchDialogBodyProps) {
  const router = useRouter();
  const baseId = useId();
  const ids = useMemo(
    () => ({
      title: titleId,
      listbox: `${baseId}-results`,
      option: (index: number) => `${baseId}-option-${index}`,
    }),
    [titleId, baseId],
  );

  const [query, setQuery] = useState(initialQuery);
  const normalized = normalizeSearchQuery(query);
  const settled = useDebouncedValue(normalized, SEARCH_DEBOUNCE_MS);
  const searched = normalized ? settled : '';
  const search = useSearch(searched);

  // SWR keeps the previous query's results while the next ones load.
  const read: SearchRead | undefined = searched ? search.data : undefined;
  const current = read && read.query === searched ? read : undefined;
  const sections = useMemo(() => (read ? searchSections(read) : []), [read]);
  const options = useMemo(
    () => (current ? sections.flatMap((s) => s.options) : []),
    [current, sections],
  );

  // The arrow keys' place in the current results, which starts at the top for each search.
  const [active, setActive] = useState({ query: '', index: 0 });
  const activeIndex =
    active.query === current?.query ? Math.min(active.index, options.length - 1) : 0;
  const moveTo = (index: number) => setActive({ query: current?.query ?? '', index });

  useEffect(() => {
    if (options.length === 0) return;
    document.getElementById(ids.option(activeIndex))?.scrollIntoView({ block: 'nearest' });
  }, [ids, activeIndex, options.length]);

  let state: SearchPanelState;
  if (!normalized) state = { status: 'empty' };
  else if (current)
    state =
      sections.length > 0
        ? { status: 'results', sections, terms: searchTerms(current.query) }
        : { status: 'none', query: current.query };
  else if (search.error) state = { status: 'error' };
  else if (read && sections.length > 0)
    state = { status: 'results', sections, terms: searchTerms(read.query), stale: true };
  else state = { status: 'loading' };

  const busy = Boolean(normalized) && !search.error && (!current || normalized !== searched);
  const announcement = current
    ? resultsSummary(sections)
    : state.status === 'error'
      ? 'Search didn’t load.'
      : '';

  // Focus the field as the dialog opens, once; the dialog hands focus back when it closes.
  const focusOnOpen = useCallback((input: HTMLInputElement | null) => input?.focus(), []);

  function choose(option: SearchOption) {
    onClose();
    router.push(option.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || options.length === 0) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      moveTo((activeIndex + step + options.length) % options.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(options[activeIndex]);
    }
  }

  return (
    <SearchPanel
      ids={ids}
      query={query}
      onQueryChange={setQuery}
      onKeyDown={onKeyDown}
      inputRef={focusOnOpen}
      state={state}
      busy={busy}
      activeIndex={activeIndex}
      onActivate={moveTo}
      // A click follows the link itself, so a new tab or window works as on any link.
      onChoose={onClose}
      onRetry={() => void search.mutate()}
      onClose={onClose}
      announcement={announcement}
    />
  );
}
