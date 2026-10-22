import type { Theme } from '@mui/material/styles';

/** A theme, or the part of one a style override is given. */
type ThemeLike = Omit<Theme, 'components'>;

/** The keyboard focus ring: a focus.main outline and a soft focus.ring halo around it (#830). */
export const focusRing = (theme: ThemeLike) => ({
  outline: `2px solid ${(theme.vars ?? theme).palette.focus.main}`,
  outlineOffset: 2,
  boxShadow: `0 0 0 4px ${(theme.vars ?? theme).palette.focus.ring}`,
});

/**
 * The ring for a control whose parent clips with overflow: hidden: the outline alone, drawn
 * just inside the control's edge, where the parent can't cut it off (#834).
 */
export const insetFocusRing = (theme: ThemeLike) => ({
  outline: `2px solid ${(theme.vars ?? theme).palette.focus.main}`,
  outlineOffset: -2,
});

/**
 * sx for a control built on a bare ButtonBase, which keeps outline: 0: the ring on keyboard
 * focus only, as MUI's own controls take it, so a mouse click draws none (#834).
 */
export const keyboardFocusRing = (theme: Theme) => ({ '&.Mui-focusVisible': focusRing(theme) });

/** keyboardFocusRing drawn inside the control, for one whose parent clips (#834). */
export const insetKeyboardFocusRing = (theme: Theme) => ({
  '&.Mui-focusVisible': insetFocusRing(theme),
});
