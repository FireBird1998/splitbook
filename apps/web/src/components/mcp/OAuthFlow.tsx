'use client';

import { apiFetch } from '@/lib/utils/api-fetch';
import { useEffect, useState, type ReactNode } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { PersonAvatar } from '@/components/balances/TabCard';
import { EXPECTED_ACCOUNT_HEADER } from '@/lib/expected-account';
import { ASSISTANT_CANNOT } from '@/lib/mcp/assistant-limits';
import type { AssistantDisplay } from '@/lib/mcp/assistant-name';
import { MCP_DRAFT_SCOPE } from '@/lib/mcp/config';
import { PRODUCT_NAME } from '@/lib/product';
import type { AssistantGroup } from '@/lib/services/assistant-ledger.service';
import { getGroupTheme } from '@splitbook/shared/group-themes';

/** A connection request as the approval page shows it: the assistant, and what it asks for. */
type ConsentDetails = AssistantDisplay & {
  scopes: string[];
  /** The Groups the assistant's live connection leaves out, to start from (#617). */
  excludedGroupIds?: string[];
};

/** The member signed in on this page, who approves or denies. */
type SignedInAccount = { id: string; name: string; email: string };

/**
 * The approval page's heading (#614, #617): the assistant by name, which members check against
 * look-alikes, with its address just under it and the generic title as a label above.
 */
export function ApprovalHeading({ details }: { details: AssistantDisplay }) {
  return (
    <Box>
      <Typography variant="overline" component="p" color="text.secondary">
        Connect an assistant
      </Typography>
      <Typography variant="h5" component="h1" sx={{ overflowWrap: 'anywhere' }}>
        <bdi>{details.name}</bdi> wants to use your {PRODUCT_NAME}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
        {details.address
          ? `${details.address} · identified by its published details`
          : 'Registered by the assistant itself. Its address isn’t published.'}
      </Typography>
    </Box>
  );
}

/**
 * The permissions a connection request asks for, as the approval page lists them: reading the
 * ledger, and, when it asks for them, preparing items for To review and staying connected; then
 * which Groups it reaches (#617) and what it can't do, on every approval.
 */
export function ConsentPermissions({
  details,
  drafts,
  busy,
  onDraftsChange,
  groupChoice,
}: {
  details: ConsentDetails;
  drafts: boolean;
  busy: boolean;
  onDraftsChange: (drafts: boolean) => void;
  /** The Group checklist, between what the assistant can and can't do. */
  groupChoice?: ReactNode;
}) {
  return (
    <>
      <Box>
        <Typography variant="subtitle2" component="h3" sx={{ overflowWrap: 'anywhere' }}>
          What <bdi>{details.name}</bdi> can do
        </Typography>
        <Typography>
          Read only: answer questions about your Groups, balances and Expenses.
        </Typography>
      </Box>
      {details.scopes.includes(MCP_DRAFT_SCOPE) && (
        <FormControlLabel
          control={
            <Checkbox
              checked={drafts}
              onChange={(event) => onDraftsChange(event.target.checked)}
              disabled={busy}
            />
          }
          label="Also let it prepare Expenses for your To review"
        />
      )}
      {details.scopes.includes(MCP_DRAFT_SCOPE) && (
        <Typography variant="body2">
          It can add, change and permanently delete items in your To review. Only you can save them
          as Expenses, in {PRODUCT_NAME}.
        </Typography>
      )}
      {details.scopes.includes('offline_access') && (
        <Typography variant="body2">
          The assistant may stay connected while you are away, until you disconnect it.
        </Typography>
      )}
      {groupChoice}
      <Box>
        <Typography variant="subtitle2" component="h3" sx={{ overflowWrap: 'anywhere' }}>
          What <bdi>{details.name}</bdi> can’t do
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {ASSISTANT_CANNOT.map((limit) => (
            <Typography key={limit} component="li" variant="body2">
              {limit}
            </Typography>
          ))}
        </Box>
      </Box>
    </>
  );
}

/** "Trip · INR", or "Work · EUR · Archived": what a Group is, beside its name. */
function groupMeta(group: AssistantGroup) {
  return [getGroupTheme(group.theme ?? 'other').label, group.currency]
    .concat(group.archived ? ['Archived'] : [])
    .join(' · ');
}

/** Every one of the member's Groups unticked: the assistant would reach none of them now. */
export function leavesOutEveryGroup(
  groups: readonly AssistantGroup[],
  excluded: readonly string[],
) {
  return groups.length > 0 && groups.every((group) => excluded.includes(group.id));
}

/**
 * Which Groups the assistant reaches (#617): every Group ticked to start. The ones the member
 * unticks become that connection's Excluded Groups, and Groups joined later are included.
 */
export function ConsentGroups({
  name,
  groups,
  excluded,
  disabled,
  onExcludedChange,
}: {
  name: string;
  groups: readonly AssistantGroup[];
  excluded: readonly string[];
  disabled: boolean;
  onExcludedChange: (excluded: string[]) => void;
}) {
  return (
    <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
      <Typography component="legend" variant="subtitle2" sx={{ p: 0 }}>
        Which Groups
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Groups you join later are included.
      </Typography>
      {groups.length > 0 && (
        <FormGroup>
          {groups.map((group) => (
            <FormControlLabel
              key={group.id}
              control={
                <Checkbox
                  checked={!excluded.includes(group.id)}
                  disabled={disabled}
                  onChange={(event) =>
                    onExcludedChange(
                      event.target.checked
                        ? excluded.filter((id) => id !== group.id)
                        : [...excluded, group.id],
                    )
                  }
                />
              }
              label={
                <Box sx={{ py: 0.5 }}>
                  <Typography variant="body2" fontWeight={500}>
                    {group.name}
                  </Typography>
                  <Typography variant="caption" component="p" color="text.secondary">
                    {groupMeta(group)}
                  </Typography>
                </Box>
              }
            />
          ))}
        </FormGroup>
      )}
      {groups.length > 0 && (
        <Typography variant="body2">
          Groups you untick are left out of <bdi>{name}</bdi>’s answers, so its totals won’t include
          them.
        </Typography>
      )}
      {leavesOutEveryGroup(groups, excluded) && (
        <Typography variant="body2" role="status" sx={{ color: 'status.negative' }}>
          Pick at least one Group.
        </Typography>
      )}
    </Box>
  );
}

/**
 * The consent the page submits: the scopes allowed and, with an Allow, the Groups left out
 * (#617). A Deny says nothing about Groups.
 */
export function consentRequest({
  query,
  accept,
  scopes,
  drafts,
  excluded,
}: {
  query: string;
  accept: boolean;
  scopes: readonly string[];
  drafts: boolean;
  excluded: readonly string[];
}) {
  return {
    oauth_query: query,
    accept,
    scope: scopes.filter((scope) => scope !== MCP_DRAFT_SCOPE || drafts).join(' '),
    ...(accept ? { excluded_groups: excluded } : {}),
  };
}

/** Who is approving: the signed-in member, by name and email (#614). */
function SignedInAs({ account }: { account: SignedInAccount }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        p: 1.5,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
      }}
    >
      <PersonAvatar name={account.name || account.email} />
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" component="p" color="text.secondary">
          Signed in as
        </Typography>
        {account.name && (
          <Typography variant="body2" fontWeight={500}>
            {account.name}
          </Typography>
        )}
        <Typography
          variant="caption"
          component="p"
          color="text.secondary"
          sx={{ overflowWrap: 'anywhere' }}
        >
          {account.email}
        </Typography>
      </Box>
    </Box>
  );
}

/**
 * Allow or Deny, with the caution beside them: allow only an assistant the member asked to
 * connect just now, named once the request's details arrive (#614).
 */
export function ConsentChoice({
  name,
  disabled,
  allowBlocked = false,
  onAllow,
  onDeny,
}: {
  name: string | null;
  disabled: boolean;
  /** Allow waits for a Group to be picked (#617); Deny never does. */
  allowBlocked?: boolean;
  onAllow: () => void;
  onDeny: () => void;
}) {
  return (
    <Stack spacing={1}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <Button variant="outlined" fullWidth disabled={disabled} onClick={onDeny}>
          Deny
        </Button>
        <Button variant="contained" fullWidth disabled={disabled || allowBlocked} onClick={onAllow}>
          Allow connection
        </Button>
      </Box>
      {name && (
        <Typography variant="body2" color="text.secondary">
          Only allow this if you asked <bdi>{name}</bdi> to connect just now.
        </Typography>
      )}
    </Stack>
  );
}

export default function OAuthFlow({
  query,
  consent,
  account,
  groups = [],
}: {
  query: string;
  consent: boolean;
  account: SignedInAccount;
  /** The member's Groups, for the approval page to tick or leave out (#617). */
  groups?: readonly AssistantGroup[];
}) {
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [drafts, setDrafts] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!consent) return;
    const controller = new AbortController();
    apiFetch(`/api/auth/mcp/consent-details?${new URLSearchParams({ oauth_query: query })}`, {
      headers: { [EXPECTED_ACCOUNT_HEADER]: account.id },
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            'This connection request is invalid, expired, or unavailable to your account. Restart from your assistant.',
          );
        return response.json();
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        setDetails(value);
        setExcluded(value.excludedGroupIds ?? []);
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [query, consent, account.id]);

  async function submit(accept = true) {
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/auth/oauth2/${consent ? 'consent' : 'continue'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [EXPECTED_ACCOUNT_HEADER]: account.id },
        body: JSON.stringify(
          consent
            ? consentRequest({ query, accept, scopes: details?.scopes ?? [], drafts, excluded })
            : { oauth_query: query, selected: true },
        ),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          'Connection could not continue. Restart from your assistant and try again.',
        );
      const destination = result.url ?? result.redirect_uri;
      if (typeof destination !== 'string')
        throw new Error('No callback was returned. Restart from your assistant.');
      // Only the authorization server supplies this validated OAuth callback.
      window.location.assign(destination);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connection failed. Try again.');
      setBusy(false);
    }
  }

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', p: 3, py: 6 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack spacing={2}>
          {consent && details ? (
            <ApprovalHeading details={details} />
          ) : (
            <Typography variant="h5" component="h1">
              {consent ? 'Connect an assistant' : `Continue connecting to ${PRODUCT_NAME}`}
            </Typography>
          )}
          {error && <Alert severity="error">{error}</Alert>}
          {consent ? (
            <>
              <SignedInAs account={account} />
              {details && (
                <ConsentPermissions
                  details={details}
                  drafts={drafts}
                  busy={busy}
                  onDraftsChange={setDrafts}
                  groupChoice={
                    <ConsentGroups
                      name={details.name}
                      groups={groups}
                      excluded={excluded}
                      disabled={busy}
                      onExcludedChange={setExcluded}
                    />
                  }
                />
              )}
              <Alert severity="info">
                Prepared items don’t change Balances until you save them.
              </Alert>
              <Typography variant="body2">
                Disconnect at any time in Settings. Your To review items stay yours; disconnecting
                cannot erase information already shared with the assistant.
              </Typography>
              <Typography variant="body2">
                {PRODUCT_NAME} checks your access on every request.
              </Typography>
              <ConsentChoice
                name={details?.name ?? null}
                disabled={busy || !details}
                allowBlocked={leavesOutEveryGroup(groups, excluded)}
                onAllow={() => void submit()}
                onDeny={() => void submit(false)}
              />
            </>
          ) : (
            <>
              <Typography>
                You are signed in. Continue to review the permissions requested by your assistant.
              </Typography>
              <Button variant="contained" disabled={busy} onClick={() => void submit()}>
                Continue
              </Button>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
