'use client';
import Box from '@mui/material/Box';
import Radio from '@mui/material/Radio';
import Typography from '@mui/material/Typography';
import { RADIUS } from '@/lib/theme/tokens';

export type ExportChoice = 'csv' | 'json' | 'statement';

/** The formats in the board's order, each with its one line (design canvas "Export"). */
const FORMATS: { value: ExportChoice; label: string; badge: string; description: string }[] = [
  {
    value: 'csv',
    label: 'CSV files',
    badge: '.csv',
    description: 'Plain rows for any spreadsheet or tool.',
  },
  {
    value: 'statement',
    label: 'Printable statement',
    badge: 'PDF',
    description: 'A readable summary of one Group, to print or save as PDF.',
  },
  {
    value: 'json',
    label: 'Full backup',
    badge: '.json',
    description: 'Everything in the chosen Groups, all time, in one JSON file.',
  },
];

/**
 * The form's first choice: what to export, as radio cards (#646). Each card is the radio's
 * label, so the whole card picks it; the radio is named by its title and described by its line.
 */
export default function ExportFormatOptions({
  value,
  onChange,
}: {
  value: ExportChoice;
  onChange: (value: ExportChoice) => void;
}) {
  return (
    <Box component="fieldset" sx={{ m: 0, p: 0, border: 0, minWidth: 0 }}>
      <Typography
        component="legend"
        sx={{
          p: 0,
          mb: 1,
          fontSize: '0.8125rem',
          lineHeight: 1.4,
          fontWeight: 600,
          color: 'text.primary',
        }}
      >
        Format
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {FORMATS.map((format) => {
          const checked = value === format.value;
          const id = `export-format-${format.value}`;
          return (
            <Box
              key={format.value}
              component="label"
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                minHeight: 48,
                px: 1.5,
                py: 1,
                cursor: 'pointer',
                border: 1,
                borderColor: checked ? 'primary.main' : 'divider',
                borderRadius: `${RADIUS.md}px`,
                bgcolor: checked ? 'tint.brand' : 'background.paper',
                // The selected card keeps a 2 px edge without shifting its content.
                boxShadow: (theme) =>
                  checked
                    ? `inset 0 0 0 1px ${(theme.vars ?? theme).palette.primary.main}`
                    : 'none',
                '&:hover': checked ? undefined : { borderColor: 'border.strong' },
              }}
            >
              <Radio
                checked={checked}
                onChange={() => onChange(format.value)}
                value={format.value}
                name="export-format"
                slotProps={{
                  input: { 'aria-labelledby': `${id}-label`, 'aria-describedby': `${id}-line` },
                }}
                sx={{ p: 0.75, ml: -0.75, mt: -0.25 }}
              />
              <Box
                sx={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, pt: 0.25 }}
              >
                <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 1 }}>
                  <Typography
                    id={`${id}-label`}
                    component="span"
                    sx={{ fontSize: '0.9375rem', fontWeight: 600, color: 'text.primary' }}
                  >
                    {format.label}
                  </Typography>
                  {/* The file type, beside the title but outside the radio's name (#646). */}
                  <Box
                    component="span"
                    aria-hidden
                    data-format-badge=""
                    sx={(theme) => ({
                      ...theme.typography.money,
                      px: 0.75,
                      py: '1px',
                      fontSize: '0.6875rem',
                      lineHeight: 1.4,
                      borderRadius: `${RADIUS.sm}px`,
                      bgcolor: 'surface.muted',
                      color: 'text.secondary',
                    })}
                  >
                    {format.badge}
                  </Box>
                </Box>
                <Typography
                  id={`${id}-line`}
                  component="span"
                  sx={{ fontSize: '0.75rem', lineHeight: 1.4, color: 'text.secondary' }}
                >
                  {format.description}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
