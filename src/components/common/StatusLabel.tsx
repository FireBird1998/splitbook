import Chip from '@mui/material/Chip';
import type { SemanticTokens } from '@/lib/theme/tokens';

export interface StatusLabelProps {
  tone: keyof SemanticTokens['status'];
  label: string;
}

/** Meaning is always written out; status colors are presentation, not the label. */
export default function StatusLabel({ tone, label }: StatusLabelProps) {
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        bgcolor: `tint.${tone}`,
        color: `status.${tone}`,
        height: 'auto',
        minHeight: 24,
        '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.25 },
      }}
    />
  );
}
