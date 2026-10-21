import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { CURRENCIES, getCurrency } from '@splitbook/shared/currency';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import {
  extraCurrencyRow,
  type GroupCurrencySettings,
} from '@splitbook/shared/group-currency-settings';

export interface GroupCurrenciesCardProps {
  groupName: string;
  settings: GroupCurrencySettings;
  viewerId: string;
  isAdmin: boolean;
  /** The Group's admins a member can ask to remove a currency. */
  adminNames: string[];
  now?: Date;
  /** A change is being saved, so the controls wait. */
  busy: boolean;
  onAdd: () => void;
  onRemove: (code: string) => void;
  onChangeMainCurrency: (code: string) => void;
}

const nameOf = (code: string) => getCurrency(code)?.name ?? code;
const orList = (names: string[]) =>
  names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;

/**
 * A Group's Currencies section in its settings (#721): the main currency and its lock, then each
 * extra currency with what uses it and who added it. Any member adds one; an admin removes one.
 */
export default function GroupCurrenciesCard({
  groupName,
  settings,
  viewerId,
  isAdmin,
  adminNames,
  now,
  busy,
  onAdd,
  onRemove,
  onChangeMainCurrency,
}: GroupCurrenciesCardProps) {
  const { mainCurrency, extraCurrencies } = settings;
  const listed = [mainCurrency.code, ...extraCurrencies.map(({ code }) => code)];
  const room = MAX_EXTRA_CURRENCIES - extraCurrencies.length;

  return (
    <Paper
      component="section"
      aria-labelledby="group-currencies-heading"
      variant="outlined"
      sx={{ p: 3 }}
    >
      <Typography
        id="group-currencies-heading"
        component="h2"
        variant="subtitle1"
        fontWeight={600}
        color="text.primary"
      >
        Currencies
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        Expenses and payments in {groupName} can use any of these. Nothing is converted.
      </Typography>

      <Typography variant="caption" fontWeight={600} color="text.secondary" component="h3">
        Main currency
      </Typography>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 0.5 }}>
        <Typography fontWeight={700}>{mainCurrency.code}</Typography>
        <Typography color="text.primary">{nameOf(mainCurrency.code)}</Typography>
        {mainCurrency.locked && (
          <Chip size="small" variant="outlined" icon={<LockOutlinedIcon />} label="Locked" />
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {mainCurrency.locked
          ? `Money is already recorded in ${mainCurrency.code}, so the main currency can’t change.`
          : isAdmin
            ? 'Nothing is recorded yet, so the main currency can still change.'
            : 'Nothing is recorded yet, so an admin can still change the main currency.'}
      </Typography>
      {!mainCurrency.locked && isAdmin && (
        <MainCurrencyChoice
          current={mainCurrency.code}
          extras={listed.slice(1)}
          busy={busy}
          onChange={onChangeMainCurrency}
        />
      )}

      <Stack
        direction="row"
        alignItems="baseline"
        justifyContent="space-between"
        sx={{ mt: 3, mb: 1 }}
      >
        <Typography variant="caption" fontWeight={600} color="text.secondary" component="h3">
          Extra currencies
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {extraCurrencies.length} of {MAX_EXTRA_CURRENCIES}
        </Typography>
      </Stack>
      {extraCurrencies.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          None yet.
        </Typography>
      ) : (
        <Box
          component="ul"
          aria-label="Extra currencies"
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'grid', gap: 1 }}
        >
          {extraCurrencies.map((setting) => {
            const row = extraCurrencyRow(setting, { viewerId, now });
            return (
              <Box
                component="li"
                key={setting.code}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  py: 1,
                  px: 1.5,
                  borderRadius: 2,
                  border: 1,
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                    <Typography fontWeight={700}>{setting.code}</Typography>
                    <Typography color="text.primary">{nameOf(setting.code)}</Typography>
                    {row.inUse && (
                      <Chip size="small" color="primary" variant="outlined" label="In use" />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {row.line}
                  </Typography>
                </Box>
                {isAdmin && (
                  <Button
                    size="small"
                    color="error"
                    aria-label={`Remove ${setting.code}`}
                    disabled={busy}
                    onClick={() => onRemove(setting.code)}
                  >
                    Remove
                  </Button>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      {room > 0 ? (
        <Box sx={{ mt: 1.5 }}>
          <Stack direction="row" spacing={1} alignItems="stretch">
            <Button
              variant="outlined"
              color="inherit"
              aria-haspopup="dialog"
              disabled={busy}
              onClick={onAdd}
              sx={{
                flex: 1,
                justifyContent: 'flex-start',
                textAlign: 'left',
                textTransform: 'none',
                borderColor: 'divider',
                display: 'block',
              }}
            >
              <Typography component="span" variant="caption" color="text.secondary" display="block">
                Currency to add
              </Typography>
              <Typography component="span" variant="body2" color="text.secondary" display="block">
                Choose a currency
              </Typography>
            </Button>
            <Button variant="contained" aria-haspopup="dialog" disabled={busy} onClick={onAdd}>
              Add
            </Button>
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {room} more can be added
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          {MAX_EXTRA_CURRENCIES} extra currencies is the most a Group can have.
        </Typography>
      )}

      <Box
        component="section"
        aria-labelledby="group-currencies-who"
        sx={{ mt: 3, p: 2, borderRadius: 2, bgcolor: 'action.hover' }}
      >
        <Typography
          id="group-currencies-who"
          component="h3"
          variant="body2"
          fontWeight={600}
          color="text.primary"
          sx={{ mb: 1 }}
        >
          Who can change them
        </Typography>
        <Stack spacing={0.75}>
          <Typography variant="body2" color="text.primary">
            <strong>Anyone in the Group</strong> can add a currency, up to {MAX_EXTRA_CURRENCIES}{' '}
            extra.
          </Typography>
          <Typography variant="body2" color="text.primary">
            <strong>Only admins</strong> can remove one, and only while no Expense, Settlement or To
            review item uses it.
          </Typography>
          <Typography variant="body2" color="text.primary">
            <strong>Nobody</strong> can change the main currency once money is recorded.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Activity shows who added or removed which currency.
          </Typography>
        </Stack>
      </Box>

      {!isAdmin && adminNames.length > 0 && (
        <Alert severity="info" role="status" sx={{ mt: 2 }}>
          Only admins can remove a currency. Ask {orList(adminNames)}.
        </Alert>
      )}
    </Paper>
  );
}

/** While nothing is recorded, an admin picks another main currency, then changes it. */
function MainCurrencyChoice({
  current,
  extras,
  busy,
  onChange,
}: {
  current: string;
  extras: string[];
  busy: boolean;
  onChange: (code: string) => void;
}) {
  const [chosen, setChosen] = useState(current);
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
      <TextField
        select
        label="Main currency"
        value={chosen}
        onChange={(event) => setChosen(event.target.value)}
        disabled={busy}
        size="small"
        sx={{ minWidth: 260 }}
      >
        {CURRENCIES.filter(({ code }) => !extras.includes(code)).map(({ code, name }) => (
          <MenuItem key={code} value={code}>
            {code} — {name}
          </MenuItem>
        ))}
      </TextField>
      <Button
        variant="outlined"
        disabled={busy || chosen === current}
        onClick={() => onChange(chosen)}
      >
        Change main currency
      </Button>
    </Stack>
  );
}
