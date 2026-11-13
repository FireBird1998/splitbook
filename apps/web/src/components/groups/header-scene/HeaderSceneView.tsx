'use client';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import FlightIcon from '@mui/icons-material/Flight';
import { alpha } from '@mui/material/styles';
import type { HeaderSceneArt } from '@splitbook/shared/header-scene-art';
import type { GroupHeader, headerCard } from '@splitbook/shared/group-header';
import { counted, SEPARATOR } from '@splitbook/shared/separator';
import ScenePicture from './ScenePicture';
import { tripDateRange } from '../group-dates';

export interface HeaderSceneViewProps {
  card: ReturnType<typeof headerCard>;
  art: HeaderSceneArt | null;
  time: Exclude<GroupHeader['time'], 'auto'>;
  motion?: boolean;
  followPointer?: boolean;
}

/** A scene's facts remain real text, independently of the decorative vector drawing. */
export default function HeaderSceneView({
  card,
  art,
  time,
  motion,
  followPointer,
}: HeaderSceneViewProps) {
  return (
    <Box
      component="section"
      data-header-scene
      aria-label={`${card.name} header`}
      sx={{ containerType: 'inline-size', containerName: 'headerScene' }}
    >
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          minHeight: 240,
          p: 2.5,
          overflow: 'hidden',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: '16px',
          bgcolor: 'surface.muted',
          '@container headerScene (max-width: 720px)': { display: 'block', p: 0 },
        }}
      >
        {art ? (
          <ScenePicture art={art} time={time} motion={motion} followPointer={followPointer} />
        ) : (
          <Box
            aria-hidden
            sx={{
              position: 'absolute',
              inset: 0,
              '@container headerScene (max-width: 720px)': { position: 'relative', height: 210 },
            }}
          />
        )}
        <Paper
          variant="outlined"
          sx={(theme) => ({
            position: 'relative',
            zIndex: 1,
            width: 380,
            maxWidth: '100%',
            p: '14px 18px 16px',
            borderRadius: '14px',
            backgroundColor: alpha(theme.palette.background.paper, 0.86),
            backdropFilter: 'blur(14px) saturate(1.2)',
            '@container headerScene (max-width: 720px)': { width: 'auto', m: '-28px 12px 12px' },
          })}
        >
          <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 0.5 }}>
            <Typography
              component="h1"
              sx={{
                fontSize: card.trip ? 12 : 22,
                fontWeight: card.trip ? 500 : 600,
                lineHeight: 1.3,
                overflowWrap: 'anywhere',
                flexBasis: card.trip ? 'auto' : '100%',
              }}
            >
              {card.name}
            </Typography>
            <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary' }}>
              {card.trip ? `${SEPARATOR}${card.theme}` : card.theme}
            </Typography>
          </Box>
          {card.trip && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                my: 1,
                fontSize: 22,
                fontWeight: 600,
                letterSpacing: '0.08em',
              }}
            >
              <span>{card.trip.route.from}</span>
              <Box
                aria-hidden
                sx={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  color: 'text.secondary',
                  '&::before, &::after': { content: '""', flex: 1, borderTop: '1px solid' },
                }}
              >
                <FlightIcon sx={{ fontSize: 18, mx: 1 }} />
              </Box>
              <span>{card.trip.route.to}</span>
            </Box>
          )}
          <Box
            component="dl"
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${card.trip ? 3 : 2}, minmax(0, auto))`,
              rowGap: 1.25,
              m: '8px 0',
              '& > div': { px: 1.75, borderLeft: '1px solid', borderColor: 'divider' },
              '& > div:first-of-type': { pl: 0, borderLeft: 0 },
              '@container headerScene (max-width: 720px)': {
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                '& > div:nth-of-type(3)': { pl: 0, borderLeft: 0 },
              },
              '& dt': { fontSize: 12, color: 'text.secondary' },
              '& dd': { m: '3px 0 0', fontSize: 14, fontWeight: 600 },
            }}
          >
            {card.trip && (
              <Box>
                <Typography component="dt">Dates</Typography>
                <Typography component="dd">
                  {tripDateRange(card.trip.start, card.trip.end) ?? 'Dates not set'}
                </Typography>
              </Box>
            )}
            <Box>
              <Typography component="dt">Members</Typography>
              <Typography component="dd">{counted(card.members, 'member')}</Typography>
            </Box>
            <Box>
              <Typography component="dt">Currencies</Typography>
              <Typography component="dd">{card.currencies.join(SEPARATOR)}</Typography>
            </Box>
          </Box>
          {card.trip && card.trip.days.length > 0 && (
            <Box
              sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}
            >
              <Box
                component="ol"
                aria-label="Trip days"
                sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, p: 0, m: 0, listStyle: 'none' }}
              >
                {card.trip.days.map((day, index) => {
                  const number = index + 1,
                    current = card.trip?.today === number;
                  return (
                    <Box
                      component="li"
                      key={day}
                      aria-current={current ? 'date' : undefined}
                      aria-label={`Day ${number}${current ? ', today' : ''}`}
                      sx={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: 0.5,
                        minWidth: 22,
                        fontSize: 11,
                        color: 'text.secondary',
                      }}
                    >
                      <Box
                        component="span"
                        aria-hidden
                        sx={(theme) => ({
                          width: 12,
                          height: 12,
                          borderRadius: '2px',
                          border: '1px solid',
                          borderColor: current ? 'warning.main' : 'border.strong',
                          bgcolor: current
                            ? 'warning.main'
                            : card.trip?.today && number < card.trip.today
                              ? 'success.main'
                              : 'transparent',
                          boxShadow: current
                            ? `0 0 12px 3px ${alpha(theme.palette.warning.main, 0.5)}`
                            : 'none',
                        })}
                      />
                      <span aria-hidden>{Number(day.slice(-2))}</span>
                    </Box>
                  );
                })}
              </Box>
              {card.trip.today !== null && (
                <Typography variant="caption" color="text.secondary">
                  Day {card.trip.today} of {card.trip.days.length}
                </Typography>
              )}
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
