'use client';

import Link from 'next/link';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { kbdSx } from '@/components/search/SearchPanel';
import { SETTINGS_HREF } from '@/components/layout/shell-nav';
import { useShortcutSetting, useShortcutHint } from '@/lib/shortcuts/ShortcutsProvider';
import { footerLines, hintKeys, type ShortcutId } from '@/lib/shortcuts/shortcuts';

/**
 * Hints show where a keyboard is likely: from MUI's md breakpoint (900 px) up, and never on a
 * device whose main pointer can't hover (a phone or tablet held by touch).
 */
const hintDisplay = (display: 'inline-flex' | 'flex') =>
  ({
    display: { xs: 'none', md: display },
    '@media (hover: none)': { display: 'none' },
  }) as const;

/** On a filled button (Add expense) the key takes the button's own colours. */
const onButtonSx = {
  bgcolor: 'transparent',
  borderColor: 'currentColor',
  color: 'inherit',
} as const;

/**
 * The key for a shortcut, beside the control it works (design canvas `.kbd`): hidden from
 * screen readers, which hear it from the control's `aria-keyshortcuts` instead. Nothing shows
 * while the shortcut does nothing (single-key shortcuts off, or not yet read on this device).
 */
export function ShortcutHint({ id, onButton = false }: { id: ShortcutId; onButton?: boolean }) {
  const shortcut = useShortcutHint(id);
  if (!shortcut) return null;
  return (
    <Box
      component="kbd"
      aria-hidden
      data-shortcut-hint={id}
      sx={{ ...kbdSx, ...(onButton ? onButtonSx : {}), ...hintDisplay('inline-flex') }}
    >
      {hintKeys(shortcut, false).join(' ')}
    </Box>
  );
}

/** `aria-keyshortcuts` for a shortcut's control, while the shortcut works. */
export function useShortcutAria(id: ShortcutId): string | undefined {
  return useShortcutHint(id)?.aria.other;
}

/**
 * The Expenses tab's footer (design canvas `.gx-foot`): each shortcut with what it does, and
 * that they pause while the member types. Shown on computers while single-key shortcuts are on.
 */
export function ShortcutsFooter() {
  const { singleKeys } = useShortcutSetting();
  const lines = footerLines(singleKeys);
  if (lines.length === 0) return null;
  return (
    <Box
      component="footer"
      data-shortcuts-footer
      sx={{
        ...hintDisplay('flex'),
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px 20px',
        pt: 0.5,
        fontSize: '0.78125rem',
        color: 'text.secondary',
      }}
    >
      <Box component="h2" sx={visuallyHidden}>
        Keyboard shortcuts
      </Box>
      <Box
        component="dl"
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: '8px 20px',
          m: 0,
          '& dd': { m: 0 },
          '& dt': { display: 'inline-flex', gap: 0.5 },
        }}
      >
        {lines.map((line) => (
          <Box
            key={line.hint}
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, whiteSpace: 'nowrap' }}
          >
            <dt>
              {line.keys.map((key) => (
                <Box key={key} component="kbd" sx={kbdSx}>
                  {key}
                </Box>
              ))}
            </dt>
            <dd>{line.hint}</dd>
          </Box>
        ))}
      </Box>
      <Typography component="p" sx={{ m: 0, fontSize: 'inherit', color: 'inherit' }}>
        Shortcuts pause while you type in a field. You can turn them off in{' '}
        <Box component={Link} href={SETTINGS_HREF} sx={{ color: 'primary.main' }}>
          Settings
        </Box>
        .
      </Typography>
    </Box>
  );
}
