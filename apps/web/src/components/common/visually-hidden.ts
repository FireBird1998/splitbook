/**
 * Text read aloud by assistive technology but never seen, for MUI's `sx`. The sizes are pixel
 * strings on purpose: in `sx` a width or height of 1 means 100% and a margin of -1 means one
 * spacing unit (−8px), which would leave the text on screen at full width. Padding and border
 * are zero either way.
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
