'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR, { useSWRConfig } from 'swr';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import { getCurrency } from '@splitbook/shared/currency';
import { MAX_EXTRA_CURRENCIES } from '@splitbook/shared/group-currencies';
import {
  addableCurrencies,
  alreadyListedNote,
  currencyUseRows,
  groupCurrencySettingsSchema,
  isCurrencyInUse,
  type ExtraCurrencyUse,
  type GroupCurrencySettings,
} from '@splitbook/shared/group-currency-settings';
import { groupCurrenciesPath } from '@splitbook/shared/api-paths';
import { groupCurrenciesKey, type QueryKey } from '@splitbook/shared/query-keys';
import ErrorState from '@/components/common/ErrorState';
import GroupCurrenciesCard from '@/components/groups/GroupCurrenciesCard';
import { OPEN_EXPENSE_PARAM } from '@/components/expenses/expense-list-query';
import { apiFetch } from '@/lib/utils/api-fetch';
import { fetchWebRead } from '@/lib/web-read';
import { WEB_QUERY_ACCOUNT, isWebGroupsRead } from '@/lib/web-query-keys';

interface GroupCurrenciesSectionProps {
  groupId: string;
  groupName: string;
  viewerId: string;
  isAdmin: boolean;
  /** The Group's admins, other than the viewer, a member can ask to remove a currency. */
  adminNames: string[];
  onNotify: (message: string) => void;
}

async function readSettings(key: QueryKey): Promise<GroupCurrencySettings> {
  const payload = (await fetchWebRead(key)) as { data?: unknown };
  return groupCurrencySettingsSchema.parse(payload.data);
}

/** The API's answer to a write: its settings on success, otherwise its refusal. */
async function answerOf(res: Response) {
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

/**
 * A Group's Currencies section in its settings (#721): it reads the Group's currencies with what
 * uses each one, adds one from a search, removes an unused one after asking, and explains a
 * removal that is refused while something still uses the currency.
 */
export default function GroupCurrenciesSection({
  groupId,
  groupName,
  viewerId,
  isAdmin,
  adminNames,
  onNotify,
}: GroupCurrenciesSectionProps) {
  const { mutate: refreshReads } = useSWRConfig();
  const {
    data: settings,
    error,
    mutate,
  } = useSWR(groupCurrenciesKey(WEB_QUERY_ACCOUNT, groupId), readSettings);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [refused, setRefused] = useState<{ code: string; use: ExtraCurrencyUse } | null>(null);

  if (!settings)
    return error ? (
      <Paper variant="outlined" sx={{ p: 3 }}>
        <ErrorState message="Currencies could not be loaded." onRetry={() => void mutate()} />
      </Paper>
    ) : (
      <Skeleton variant="rounded" height={320} />
    );

  /** Show the saved settings, and refresh the Group reads the Expense form takes its list from. */
  const saved = async (next: GroupCurrencySettings) => {
    await mutate(next, { revalidate: false });
    void refreshReads(isWebGroupsRead);
  };

  const add = async (code: string) => {
    setBusy(true);
    setAddError('');
    try {
      const answer = await answerOf(
        await apiFetch(groupCurrenciesPath(groupId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currency: code }),
        }),
      );
      if (!answer.settings) {
        setAddError(answer.message);
        void mutate();
        return;
      }
      await saved(answer.settings);
      setAdding(false);
      onNotify(`${code} added.`);
    } catch {
      setAddError('Couldn’t add the currency. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (code: string) => {
    setBusy(true);
    try {
      const answer = await answerOf(
        await apiFetch(`${groupCurrenciesPath(groupId)}/${code}`, { method: 'DELETE' }),
      );
      setConfirming(null);
      if (answer.use) {
        setRefused({ code, use: answer.use });
        void mutate();
        return;
      }
      if (!answer.settings) {
        onNotify(answer.message);
        void mutate();
        return;
      }
      await saved(answer.settings);
      onNotify(`${code} removed.`);
    } catch {
      onNotify('Couldn’t remove the currency. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const changeMainCurrency = async (code: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultCurrency: code }),
      });
      // The Group's answer, not this section's read: only its refusal is read here.
      onNotify(res.ok ? `The main currency is now ${code}.` : (await answerOf(res)).message);
      void mutate();
      void refreshReads(isWebGroupsRead);
    } catch {
      onNotify('Couldn’t change the main currency. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const askToRemove = (code: string) => {
    const setting = settings.extraCurrencies.find((extra) => extra.code === code);
    if (setting && isCurrencyInUse(setting.use)) setRefused({ code, use: setting.use });
    else setConfirming(code);
  };

  const listed = [settings.mainCurrency.code, ...settings.extraCurrencies.map(({ code }) => code)];
  const removable = settings.extraCurrencies.find(
    (extra) => extra.code !== refused?.code && !isCurrencyInUse(extra.use),
  );

  return (
    <>
      <GroupCurrenciesCard
        groupName={groupName}
        settings={settings}
        viewerId={viewerId}
        isAdmin={isAdmin}
        adminNames={adminNames}
        busy={busy}
        onAdd={() => {
          setAddError('');
          setAdding(true);
        }}
        onRemove={askToRemove}
        onChangeMainCurrency={(code) => void changeMainCurrency(code)}
      />
      {adding && (
        <AddCurrencyDialog
          groupName={groupName}
          listed={listed}
          extraCount={settings.extraCurrencies.length}
          busy={busy}
          error={addError}
          onCancel={() => setAdding(false)}
          onAdd={(code) => void add(code)}
        />
      )}
      <Dialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Remove {confirming}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.primary">
            {confirming} ({confirming ? getCurrency(confirming)?.name : ''}) leaves {groupName}’s
            currencies. Nothing uses it, so no amount changes. Activity shows that you removed it.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button color="inherit" disabled={busy} onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={busy}
            onClick={() => confirming && void remove(confirming)}
          >
            Remove {confirming}
          </Button>
        </DialogActions>
      </Dialog>
      {refused && (
        <CurrencyInUseDialog
          groupId={groupId}
          groupName={groupName}
          code={refused.code}
          use={refused.use}
          removable={removable?.code ?? null}
          onClose={() => setRefused(null)}
        />
      )}
    </>
  );
}

/** "Add a currency": a search of the supported currencies the Group doesn't list yet. */
function AddCurrencyDialog({
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

/** A removal refused while something uses the currency: what uses it, and what to do. */
function CurrencyInUseDialog({
  groupId,
  groupName,
  code,
  use,
  removable,
  onClose,
}: {
  groupId: string;
  groupName: string;
  code: string;
  use: ExtraCurrencyUse;
  /** Another extra currency nothing uses, which can be removed now. */
  removable: string | null;
  onClose: () => void;
}) {
  const [showExpenses, setShowExpenses] = useState(false);
  const { count, items } = use.expenses;

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{code} can’t be removed yet</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.primary" sx={{ mb: 2 }}>
          {groupName} still uses {code}. Change these to another currency, or delete them, then
          remove it.
        </Typography>
        <Stack
          sx={{ border: 1, borderColor: 'divider', borderRadius: 2 }}
          divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}
        >
          {currencyUseRows(code, use).map((row) => (
            <Box key={row.kind} sx={{ px: 2, py: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={600} color="text.primary">
                    {row.title}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.detail}
                  </Typography>
                </Box>
                {row.kind === 'expenses' && (
                  <Button
                    size="small"
                    aria-expanded={showExpenses}
                    onClick={() => setShowExpenses((shown) => !shown)}
                  >
                    {showExpenses ? 'Hide them' : 'Show them'}
                  </Button>
                )}
                {row.kind === 'yours' && (
                  <Button size="small" component={Link} href={`/groups/${groupId}/review`}>
                    Open To review
                  </Button>
                )}
              </Stack>
              {row.kind === 'expenses' && showExpenses && (
                <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                  {items.map((item) => (
                    <li key={item._id}>
                      <Typography
                        variant="body2"
                        component={Link}
                        href={`/groups/${groupId}/expenses?${OPEN_EXPENSE_PARAM}=${item._id}`}
                        color="primary"
                      >
                        {item.description}
                      </Typography>
                    </li>
                  ))}
                  {count > items.length && (
                    <Typography component="li" variant="caption" color="text.secondary">
                      and {count - items.length} more
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          ))}
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {removable ? `Removing ${removable} works now, because nothing uses it. ` : ''}
          Removing asks you to confirm, and Activity shows who removed it.
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button variant="contained" onClick={onClose}>
          OK
        </Button>
      </DialogActions>
    </Dialog>
  );
}
