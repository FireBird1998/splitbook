'use client';

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import { useTheme } from '@mui/material/styles';
import { FONT_MONO } from '@/lib/theme/tokens';
import { tours } from './generated/tours';

/** The kit's mono face, for the drawing's screens and counters, is the app's. */
const FIGURE_FONT = { '--anatomy-mono': FONT_MONO } as CSSProperties;

interface FigureTourProps {
  id: string;
  /** The id of the figure's title. */
  labelledBy: string;
  children: ReactNode;
}

/**
 * A landing figure in the page's theme, with its live tour (#448). The server renders the drawing;
 * this loads the tour's own chunk only once the figure comes near the screen, after the headline
 * and actions have painted, and stops it when the page leaves. If the chunk can't load, the
 * drawing stays as it is.
 */
export default function FigureTour({ id, labelledBy, children }: FigureTourProps) {
  const ref = useRef<HTMLElement>(null);
  const mode = useTheme().palette.mode;

  useEffect(() => {
    const root = ref.current;
    const load = tours[id];
    if (!root || !load) return;
    let stop: (() => void) | undefined;
    let left = false;
    const near = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        near.disconnect();
        load().then(
          ({ play }) => {
            if (!left) stop = play(root);
          },
          () => {},
        );
      },
      { rootMargin: '200px 0px' },
    );
    near.observe(root);
    return () => {
      left = true;
      near.disconnect();
      stop?.();
    };
  }, [id]);

  return (
    <Box
      ref={ref}
      component="figure"
      className="iso"
      data-theme={mode}
      aria-labelledby={labelledBy}
      style={FIGURE_FONT}
      sx={{ m: 0, display: 'flex', flexDirection: 'column', gap: 1.5 }}
    >
      {children}
    </Box>
  );
}
