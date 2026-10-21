'use client';

import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';

export interface CurrencyTab {
  currency: string;
  main: boolean;
  id: string;
  figure: ReactNode;
  accessibleName: string;
}

/** Currency cards shared by Balances, Insights and the Trip summary. */
export default function CurrencySwitch({
  tabs,
  value,
  onChange,
  label,
  note,
  panelId,
  noteMaxWidth = 320,
}: {
  tabs: readonly CurrencyTab[];
  value: string;
  onChange: (currency: string) => void;
  label: string;
  note?: string;
  panelId?: string;
  /** Preserve the page's note wrapping beside the tabs. */
  noteMaxWidth?: number;
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1.5,
      }}
    >
      <Tabs
        value={value}
        onChange={(_event, currency: string) => onChange(currency)}
        aria-label={label}
        sx={{
          // Cards on the page, not the theme's segmented track.
          minHeight: 0,
          p: 0,
          borderRadius: 0,
          bgcolor: 'transparent',
          '& .MuiTabs-indicator': { display: 'none' },
          '& .MuiTabs-flexContainer': { flexWrap: 'wrap', gap: 1 },
        }}
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.currency}
            value={tab.currency}
            id={tab.id}
            aria-controls={panelId}
            aria-label={tab.accessibleName}
            disableRipple
            label={
              <>
                <Box
                  component="span"
                  sx={(theme) => ({
                    ...theme.typography.money,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: tab.currency === value ? 'primary.main' : 'text.secondary',
                  })}
                >
                  {tab.currency}
                  {tab.main && (
                    <Box
                      component="span"
                      sx={{
                        fontFamily: (theme) => theme.typography.fontFamily,
                        fontWeight: 500,
                        ml: 0.75,
                      }}
                    >
                      · main
                    </Box>
                  )}
                </Box>
                {tab.figure}
              </>
            }
            sx={{
              minWidth: 150,
              minHeight: 0,
              px: 2,
              py: 1.25,
              gap: '1px',
              alignItems: 'flex-start',
              textAlign: 'left',
              textTransform: 'none',
              color: 'text.primary',
              opacity: 1,
              border: 1,
              borderColor: 'border.strong',
              borderRadius: '12px',
              bgcolor: 'background.paper',
              '&.Mui-selected': {
                color: 'text.primary',
                borderColor: 'primary.main',
                bgcolor: 'tint.brand',
                boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}`,
              },
            }}
          />
        ))}
      </Tabs>
      {note ? (
        <Typography
          component="p"
          sx={{ m: 0, maxWidth: noteMaxWidth, fontSize: '0.75rem', color: 'text.secondary' }}
        >
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}
