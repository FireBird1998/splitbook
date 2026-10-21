'use client';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import { CURRENCIES } from '@splitbook/shared/currency';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';

/**
 * A new Trip's extra currencies, chosen while it is set up (#723), as the board "Web · New Trip
 * offers extra currencies" shows them: each one added, with Remove, and a list of the rest, never
 * the main currency, until there are 4. Nothing is converted; members add more later.
 */
export default function ExtraCurrenciesStep({
  mainCurrency,
  value,
  onChange,
  disabled = false,
}: {
  mainCurrency: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const full = value.length >= MAX_EXTRA_CURRENCIES;
  const choices = CURRENCIES.filter(
    (currency) => currency.code !== mainCurrency && !value.includes(currency.code),
  );
  return (
    <Box
      component="section"
      aria-labelledby="extra-currencies-title"
      sx={{ p: 2, borderRadius: 3, bgcolor: 'action.hover' }}
    >
      {/* A gap, not margins, so the count keeps to the end of the line. */}
      <Stack direction="row" alignItems="center" spacing={1} useFlexGap>
        <Typography id="extra-currencies-title" variant="body2" fontWeight={600}>
          Spending abroad?
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 1, borderRadius: 1, bgcolor: 'background.paper' }}
        >
          Optional
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {value.length} of {MAX_EXTRA_CURRENCIES}
        </Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Add each currency you’ll pay in. Expenses keep the amount on the receipt; nothing is
        converted.
      </Typography>
      <Stack direction="row" flexWrap="wrap" alignItems="center" gap={1} sx={{ mt: 1.5 }}>
        {value.map((code) => (
          <Box
            key={code}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              minHeight: 40,
              pl: 1.5,
              pr: 0.5,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: 'primary.main',
              bgcolor: 'tint.brand',
              color: 'primary.main',
              fontWeight: 600,
            }}
          >
            {code}
            <IconButton
              size="small"
              aria-label={`Remove ${code}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((item) => item !== code))}
              sx={{ color: 'primary.main' }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        <TextField
          select
          size="small"
          value=""
          disabled={disabled || full}
          onChange={(event) => {
            if (event.target.value) onChange([...value, event.target.value]);
          }}
          slotProps={{ select: { native: true }, htmlInput: { 'aria-label': 'Add a currency' } }}
          sx={{ minWidth: 220 }}
        >
          <option value="">{full ? `${MAX_EXTRA_CURRENCIES} added` : 'Add a currency'}</option>
          {choices.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code} — {currency.name}
            </option>
          ))}
        </TextField>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Anyone in the Group can add more later.
      </Typography>
    </Box>
  );
}
