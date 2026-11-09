'use client';

import { useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import { quietTours, QUIET_TOUR_SPEED } from './generated/quiet-tours';
import type { QuietTourControl } from './generated/quiet-figure';

/** One page-lifetime control; lazy arrivals inherit the current pause choice. */
export default function QuietTours() {
  const [paused, setPaused] = useState(false);
  const [moving, setMoving] = useState(false);
  const pausedRef = useRef(false);
  const controls = useRef(new Map<HTMLElement, QuietTourControl>());
  const pending = useRef(new Map<HTMLElement, (root: HTMLElement) => QuietTourControl>());
  useEffect(() => {
    const roots = [...document.querySelectorAll<HTMLElement>('[data-quiet-figure]')];
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const active = controls.current;
    const waiting = pending.current;
    const loading = new Set<HTMLElement>();
    let left = false;
    let generation = 0;
    const near = new IntersectionObserver(
      (entries) => {
        if (media.matches) return;
        for (const entry of entries) {
          const root = entry.target as HTMLElement;
          if (!entry.isIntersecting || active.has(root) || waiting.has(root) || loading.has(root))
            continue;
          const load = quietTours[root.dataset.quietFigure!];
          if (!load) continue;
          loading.add(root);
          const started = generation;
          load().then(
            ({ play }) => {
              if (!left && !media.matches && started === generation && !active.has(root)) {
                if (pausedRef.current) waiting.set(root, play);
                else active.set(root, play(root));
              }
            },
            () => {
              loading.delete(root);
            },
          );
        }
      },
      { rootMargin: '200px 0px' },
    );
    const observe = () => {
      generation++;
      near.disconnect();
      loading.clear();
      for (const control of active.values()) control.stop();
      active.clear();
      waiting.clear();
      setMoving(!media.matches);
      if (!media.matches) for (const root of roots) near.observe(root);
    };
    observe();
    media.addEventListener('change', observe);
    return () => {
      left = true;
      near.disconnect();
      media.removeEventListener('change', observe);
      for (const control of active.values()) control.stop();
      active.clear();
      waiting.clear();
    };
  }, []);
  return (
    <Button
      type="button"
      className="sbq-pause"
      disableRipple
      hidden={!moving}
      data-tour-speed={QUIET_TOUR_SPEED}
      aria-pressed={paused}
      onClick={() => {
        const value = !pausedRef.current;
        pausedRef.current = value;
        setPaused(value);
        for (const control of controls.current.values()) control.setPaused(value);
        if (!value) {
          for (const [root, play] of pending.current) controls.current.set(root, play(root));
          pending.current.clear();
        }
      }}
      sx={{
        position: 'absolute',
        zIndex: 2,
        right: { xs: 16, md: 32 },
        bottom: 12,
        typography: 'caption',
        color: 'text.secondary',
        textTransform: 'none',
        '&[hidden]': { display: 'none' },
        '@media (prefers-reduced-motion: reduce)': { display: 'none' },
      }}
    >
      {paused ? 'Play animation' : 'Pause animation'}
    </Button>
  );
}
