import 'server-only';
import type { CSSProperties } from 'react';
import Box from '@mui/material/Box';
import { FONT_MONO } from '@/lib/theme/tokens';
import { quietFigureCss, type QuietFigure } from './generated/quiet';

/** Server-rendered decoration. The page's pre-paint theme also chooses the reduced-motion PNG. */
export default function QuietDrawing({
  figure,
  placement,
}: {
  figure: QuietFigure;
  placement: 'hero' | 'settle' | 'assist';
}) {
  const css =
    (quietFigureCss + figure.css)
      .replaceAll('.iso[data-theme="light"]', ':root:not([data-theme="dark"]) .iso')
      .replaceAll(
        '.iso[data-quiet][data-theme="light"]',
        ':root:not([data-theme="dark"]) .iso[data-quiet]',
      )
      .replaceAll(
        '.iso[data-quiet][data-theme="dark"]',
        ':root[data-theme="dark"] .iso[data-quiet]',
      ) +
    '@media(prefers-reduced-motion:reduce){:root[data-theme="dark"] .sbq-still-light{display:none}:root[data-theme="dark"] .sbq-still-dark{display:block}}';
  return (
    <Box
      inert
      aria-hidden="true"
      data-quiet-figure={figure.id}
      className={placement === 'hero' ? 'sbq-hero' : `sbq-art sbq-${placement}`}
    >
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <Box
        className="iso sbq-image"
        data-quiet=""
        style={{ '--anatomy-mono': FONT_MONO } as CSSProperties}
      >
        <div data-stage="" className="sbq-stage" dangerouslySetInnerHTML={{ __html: figure.svg }} />
        {/* These are decoration, not Next image optimisation requests; source PNGs keep their alpha. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          loading="lazy"
          className="sbq-still sbq-still-light"
          src={figure.stills.light}
          width={figure.width}
          height={figure.height}
          alt=""
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          loading="lazy"
          className="sbq-still sbq-still-dark"
          src={figure.stills.dark}
          width={figure.width}
          height={figure.height}
          alt=""
        />
      </Box>
    </Box>
  );
}
