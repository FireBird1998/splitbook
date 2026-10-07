'use client';

import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';

interface SegmentedControlProps<T extends string> {
  /** Names the group for assistive technology, such as "View as" or "Currency". */
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/**
 * A row of pressed / not-pressed buttons with exactly one pressed, styled as the design
 * canvas's segmented control (`.seg`): a muted track and the chosen option on the surface.
 * Charts use it for Chart/Table and for the currency.
 */
export default function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <ToggleButtonGroup
      exclusive
      value={value}
      aria-label={label}
      // Pressing the chosen option again keeps it chosen.
      onChange={(_event, next: T | null) => {
        if (next !== null) onChange(next);
      }}
      sx={{
        bgcolor: 'surface.muted',
        borderRadius: '12px',
        p: '3px',
        gap: '3px',
        '& .MuiToggleButtonGroup-grouped': {
          border: 0,
          borderRadius: '9px !important',
          m: 0,
        },
      }}
    >
      {options.map((option) => (
        <ToggleButton
          key={option.value}
          value={option.value}
          disableRipple
          sx={{
            minHeight: { xs: 44, sm: 38 },
            px: 1.75,
            py: 0,
            color: 'text.secondary',
            fontSize: '0.875rem',
            lineHeight: 1.2,
            whiteSpace: 'nowrap',
            '&:hover': { bgcolor: 'surface.hover' },
            '&.Mui-selected, &.Mui-selected:hover': {
              bgcolor: 'background.paper',
              color: 'text.primary',
              boxShadow: 1,
            },
          }}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
