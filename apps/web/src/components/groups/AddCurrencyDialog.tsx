import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import {
  addableCurrencies,
  alreadyListedNote,
  groupCurrencySettingsSchema,
  type ExtraCurrencyUse,
} from '@splitbook/shared/group-currency-settings';

/** The API's answer to a write: its settings on success, otherwise its refusal. */
export async function answerOf(res: Response) {
  const body = (await res.json().catch(() => null)) as {
    data?: unknown;
    error?: unknown;
    code?: unknown;
    use?: ExtraCurrencyUse;
  } | null;
  return {
    settings: res.ok ? groupCurrencySettingsSchema.parse(body?.data) : null,
    message: typeof body?.error === 'string' && body.error ? body.error : 'Something went wrong.',
    use: body?.code === 'CURRENCY_IN_USE' ? body.use : undefined,
  };
}

/** "Add a currency": a search of the supported currencies the Group doesn't list yet. */
export default function AddCurrencyDialog({
  groupName,
  listed,
  extraCount,
  busy,
  error,
  onCancel,
  onAdd,
}: {
  groupName: string;
  listed: string[];
  extraCount: number;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onAdd: (code: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const found = addableCurrencies(listed, search);

  return (
    <Dialog open onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>Add a currency</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {groupName} · {extraCount} of {MAX_EXTRA_CURRENCIES} extra currencies
        </Typography>
        <TextField
          label="Search currencies"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          size="small"
          fullWidth
          autoFocus
        />
        {found.length ? (
          <List
            role="listbox"
            aria-label="Currencies you can add"
            dense
            sx={{ mt: 1, maxHeight: 280, overflowY: 'auto' }}
          >
            {found.map(({ code, name }) => (
              <ListItemButton
                key={code}
                role="option"
                aria-selected={chosen === code}
                selected={chosen === code}
                onClick={() => setChosen(code)}
                sx={{ borderRadius: 1, gap: 1.5 }}
              >
                <Typography fontWeight={700} sx={{ minWidth: 40 }}>
                  {code}
                </Typography>
                <Typography sx={{ flex: 1 }}>{name}</Typography>
                {chosen === code && <CheckIcon fontSize="small" color="primary" />}
              </ListItemButton>
            ))}
          </List>
        ) : (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No currency you can add matches “{search.trim()}”.
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          {alreadyListedNote(listed)}
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button color="inherit" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || !chosen || !found.some(({ code }) => code === chosen)}
          onClick={() => chosen && onAdd(chosen)}
        >
          {chosen ? `Add ${chosen}` : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
