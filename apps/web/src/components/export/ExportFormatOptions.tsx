'use client';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
export type ExportChoice = 'csv' | 'json' | 'statement';
/** The three export entry points share the Group chooser and period controls. */
export default function ExportFormatOptions({
  value,
  onChange,
}: {
  value: ExportChoice;
  onChange: (value: ExportChoice) => void;
}) {
  return (
    <Box>
      <TextField
        select
        fullWidth
        label="Format"
        value={value}
        onChange={(event) => onChange(event.target.value as ExportChoice)}
        slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
      >
        <option value="csv">CSV files</option>
        <option value="statement">Printable statement</option>
        <option value="json">JSON backup</option>
      </TextField>
    </Box>
  );
}
