'use client';

import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import { addableCurrencies } from '@splitbook/shared/group-currency-settings';
import { RADIUS } from '@/lib/theme/tokens';

/**
 * A new Trip's extra currencies, chosen while it is set up (#723), as the board "Web · New Trip
 * offers extra currencies" shows them: each one added, with Remove, and a menu of the rest, never
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
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const full = value.length >= MAX_EXTRA_CURRENCIES;
  const choices = addableCurrencies([mainCurrency, ...value], '');
  return (
    <Box
      component="section"
      aria-labelledby="extra-currencies-title"
      sx={{ p: 2, borderRadius: `${RADIUS.md}px`, bgcolor: 'action.hover' }}
    >
      {/* A gap, not margins, so the count keeps to the end of the line. */}
      <Stack direction="row" alignItems="center" spacing={1} useFlexGap>
        <Typography id="extra-currencies-title" variant="body2" fontWeight={600}>
          Spending abroad?
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ px: 1, borderRadius: `${RADIUS.sm}px`, bgcolor: 'background.paper' }}
        >
          Optional
        </Typography>
        <Typography variant="caption" color="text.secondary" aria-live="polite" sx={{ ml: 'auto' }}>
          {`${value.length} of ${MAX_EXTRA_CURRENCIES}`}
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
              borderRadius: `${RADIUS.sm}px`,
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
        <Button
          variant="outlined"
          color="inherit"
          startIcon={<AddIcon />}
          aria-haspopup="menu"
          aria-expanded={menu ? true : undefined}
          aria-controls={menu ? 'extra-currencies-menu' : undefined}
          disabled={disabled || full}
          onClick={(event) => setMenu(event.currentTarget)}
          sx={{ minHeight: 40 }}
        >
          Add a currency
        </Button>
        <Menu
          id="extra-currencies-menu"
          anchorEl={menu}
          open={menu !== null}
          onClose={() => setMenu(null)}
          slotProps={{ paper: { sx: { maxHeight: 320 } } }}
        >
          {choices.map((currency) => (
            <MenuItem
              key={currency.code}
              onClick={() => {
                onChange([...value, currency.code]);
                setMenu(null);
              }}
            >
              {currency.code} — {currency.name}
            </MenuItem>
          ))}
        </Menu>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        Anyone in the Group can add more later.
      </Typography>
    </Box>
  );
}
