'use client';

import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import SearchIcon from '@mui/icons-material/Search';
import SearchDialog from './SearchDialog';
import { kbdSx } from './SearchPanel';
import { SEARCH_LABEL } from './search-label';
import {
  isApplePlatform,
  isSearchShortcut,
  isTypingTarget,
  searchShortcutKeys,
  searchShortcutLabel,
} from './search-shortcut';

const noSubscription = () => () => {};

/** Whether this is an Apple device; unknown (null) on the server and while hydrating. */
function useApplePlatform(): boolean | null {
  return useSyncExternalStore(noSubscription, isApplePlatform, () => null);
}

/** A single printable character typed with no modifier but Shift. */
const isPrintable = (event: KeyboardEvent) =>
  event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey;

/**
 * Search in the top bar (#321): a field from MUI's md breakpoint (900 px) up, and an icon button
 * below it, where the bar also holds the menu button, the logo and Add expense; each opens the
 * search dialog, which ⌘K (Ctrl+K off Apple devices) also opens from anywhere, except while the
 * member is typing in another field. Fills the space at the start of the bar.
 */
export default function SearchLauncher() {
  const apple = useApplePlatform();
  const [open, setOpen] = useState(false);
  const [initialQuery, setInitialQuery] = useState('');

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.defaultPrevented || !isSearchShortcut(event)) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // In the search field itself the shortcut closes the search; in any other field it types.
      const inSearch = target?.matches('[data-search-input]') ?? false;
      if (!inSearch && isTypingTarget(target)) return;
      event.preventDefault();
      setInitialQuery('');
      setOpen((wasOpen) => !wasOpen);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const openSearch = (query = '') => {
    setInitialQuery(query);
    setOpen(true);
  };

  const shortcut = apple === null ? undefined : searchShortcutKeys(apple);

  return (
    <Box
      sx={{
        flex: '1 1 auto',
        minWidth: 0,
        display: 'flex',
        justifyContent: { xs: 'flex-end', md: 'flex-start' },
      }}
    >
      <ButtonBase
        disableRipple
        onClick={() => openSearch()}
        // Typing on the focused field starts the search with that character.
        onKeyDown={(event) => {
          if (!isPrintable(event)) return;
          event.preventDefault();
          openSearch(event.key);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={shortcut}
        sx={{
          display: { xs: 'none', md: 'flex' },
          flex: '1 1 320px',
          minWidth: 0,
          maxWidth: 560,
          minHeight: 44,
          justifyContent: 'flex-start',
          gap: 1.25,
          pl: 1.75,
          pr: 1,
          borderRadius: '12px',
          border: 1,
          borderColor: 'transparent',
          bgcolor: 'surface.muted',
          color: 'text.secondary',
          // A button keeps the browser's own font unless told to take the page's (Outfit).
          fontFamily: 'inherit',
          fontSize: '0.875rem',
          textAlign: 'left',
          '&:hover': { borderColor: 'border.strong' },
        }}
      >
        <SearchIcon aria-hidden sx={{ fontSize: 18, flex: 'none' }} />
        <Box
          component="span"
          sx={{
            flex: '1 1 auto',
            minWidth: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {SEARCH_LABEL}
        </Box>
        {apple === null ? null : (
          <Box
            component="kbd"
            aria-hidden
            sx={{ ...kbdSx, '@media (hover: none)': { display: 'none' } }}
          >
            {searchShortcutLabel(apple)}
          </Box>
        )}
      </ButtonBase>
      <IconButton
        onClick={() => openSearch()}
        aria-label={SEARCH_LABEL}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={shortcut}
        sx={{
          display: { xs: 'inline-flex', md: 'none' },
          width: 44,
          height: 44,
          flex: 'none',
          borderRadius: '12px',
          color: 'text.secondary',
          '&:hover': { bgcolor: 'surface.muted', color: 'text.primary' },
        }}
      >
        <SearchIcon />
      </IconButton>
      <SearchDialog open={open} initialQuery={initialQuery} onClose={() => setOpen(false)} />
    </Box>
  );
}
