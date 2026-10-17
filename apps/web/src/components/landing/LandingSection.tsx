import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@/components/insights/a11y';
import { RADIUS } from '@/lib/theme/tokens';

/** The landing page's side gutter, as its frame has it (#444). */
export const LANDING_GUTTER = { px: { xs: 2, sm: 3 } } as const;

/** A card on the landing page: the elevated surface with the design system's border and radius. */
export const landingCard = {
  bgcolor: 'background.paper',
  border: 1,
  borderColor: 'divider',
  borderRadius: `${RADIUS.lg}px`,
  p: { xs: 2.5, md: 3 },
  minWidth: 0,
} as const;

/**
 * One section of the landing page (#446): an eyebrow, its heading and a lead line, then its
 * content. `hiddenTitle` names a section that shows no heading of its own, for screen readers.
 */
export default function LandingSection({
  id,
  elevated = false,
  eyebrow,
  title,
  hiddenTitle = false,
  intro,
  children,
}: {
  id?: string;
  elevated?: boolean;
  eyebrow?: string;
  title: string;
  hiddenTitle?: boolean;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <Box
      component="section"
      id={id}
      aria-label={hiddenTitle ? title : undefined}
      sx={{
        py: { xs: 7, md: 13 },
        ...(elevated && {
          bgcolor: 'surface.elevated',
          borderTop: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }),
      }}
    >
      <Container maxWidth="lg" sx={LANDING_GUTTER}>
        <Stack spacing={1.5} sx={{ mb: hiddenTitle ? 0 : { xs: 4, md: 6 }, maxWidth: 760 }}>
          {eyebrow && (
            <Typography variant="overline" color="primary.main" sx={{ fontWeight: 600 }}>
              {eyebrow}
            </Typography>
          )}
          <Typography
            variant="displaySmall"
            component="h2"
            color="text.primary"
            sx={{ m: 0, ...(hiddenTitle && visuallyHidden) }}
          >
            {title}
          </Typography>
          {intro && (
            <Typography variant="lead" component="p" color="text.secondary">
              {intro}
            </Typography>
          )}
        </Stack>
        {children}
      </Container>
    </Box>
  );
}
