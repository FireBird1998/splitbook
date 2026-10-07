/**
 * Read aloud, never seen. Sizes are strings: in `sx`, a width or height of 1 means 100% and a
 * margin of -1 means one spacing unit, which would stretch the span down the page.
 */
export const visuallyHidden = {
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
