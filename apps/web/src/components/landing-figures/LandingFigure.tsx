import 'server-only';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@/components/insights/a11y';
import { FONT_MONO } from '@/lib/theme/tokens';
import FigureTour from './FigureTour';
import { figureCss, type LandingFigure as Figure } from './generated';

/** The plate's corner labels and readout: small mono type, as on the kit's plates. */
const PLATE_LABEL = { fontFamily: FONT_MONO, fontSize: 12, lineHeight: 1.5 } as const;

/** Each legend key's mark, in the drawing's own colours (the figure's stylesheet defines them). */
const SWATCH = {
  bin: { bgcolor: 'text.disabled', borderRadius: '2px' },
  positive: { bgcolor: 'var(--ln-pos)', borderRadius: '2px' },
  negative: { bgcolor: 'var(--ln-neg)', borderRadius: '2px' },
  lamp: { bgcolor: 'var(--ln-lamp)', borderRadius: '50%' },
} as const;

/**
 * A landing figure in its plate (#443, #448): its number and title, the drawing, a readout the live
 * tour writes to, and a legend. The drawing is server-rendered SVG with role="img" and its full
 * description, so the page reads without JavaScript; the figure's markup never reaches a client
 * bundle (its module is server only).
 *
 * The live tour looks for `.ln-stage` (the drawing and a `[data-status]` live region) and
 * `[data-readout]` inside the figure (tools/landing-figures/src/figures/*.tour.js).
 */
export default function LandingFigure({ figure }: { figure: Figure }) {
  const titleId = `fig-${figure.number}-title`;
  return (
    <FigureTour id={figure.id} labelledBy={titleId}>
      <style dangerouslySetInnerHTML={{ __html: figureCss + figure.css }} />
      <Box
        sx={{
          bgcolor: 'var(--anatomy-paper)',
          border: 1,
          borderColor: 'var(--anatomy-faint)',
          borderRadius: '16px',
          overflow: 'hidden',
          boxShadow: 2,
        }}
      >
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1.5, px: 2.5, pt: 2 }}>
          <Typography component="span" sx={{ ...PLATE_LABEL, color: 'var(--anatomy-text)' }}>
            Fig {figure.number}
          </Typography>
          <Typography
            component="span"
            id={titleId}
            sx={{
              ...PLATE_LABEL,
              color: 'var(--anatomy-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {figure.title}
          </Typography>
        </Box>
        <Box
          className="ln-stage"
          sx={{
            borderRadius: 2,
            '&:focus-visible': { outline: '2px solid', outlineColor: 'focus.main' },
          }}
        >
          <div dangerouslySetInnerHTML={{ __html: figure.svg }} />
          <Box
            component="span"
            role="status"
            aria-live="polite"
            data-status=""
            sx={visuallyHidden}
          />
        </Box>
        <Typography
          component="p"
          data-readout=""
          aria-hidden="true"
          color="text.secondary"
          sx={{ ...PLATE_LABEL, m: 0, px: 2.5, pb: 2, textAlign: { xs: 'left', sm: 'right' } }}
        >
          {figure.readout}
        </Typography>
      </Box>
      <Box
        component="figcaption"
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: '10px 24px',
          px: 0.5,
        }}
      >
        <Box
          component="ul"
          sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}
        >
          {figure.legend.map((key) => (
            <Typography
              key={key.mark}
              component="li"
              variant="body2"
              color="text.secondary"
              sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{ width: 10, height: 10, flexShrink: 0, ...SWATCH[key.mark] }}
              />
              {key.label}
            </Typography>
          ))}
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ m: 0 }}>
          {figure.caption}
        </Typography>
      </Box>
    </FigureTour>
  );
}
