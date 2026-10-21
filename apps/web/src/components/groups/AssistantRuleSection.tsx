'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { z } from 'zod';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Paper from '@mui/material/Paper';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import {
  ASSISTANT_RULE_LABELS,
  ASSISTANT_RULES,
  type AssistantRule,
} from '@splitbook/shared/assistant-rule';
import type { GroupReadMember } from '@splitbook/shared/group-read';
import { lastUsedLabel } from '@/components/mcp/last-used';
import { apiFetch } from '@/lib/utils/api-fetch';
import { fetcher } from '@/lib/utils/fetcher';

type Member = Pick<GroupReadMember, 'user' | 'role'>;

interface AssistantRuleSectionProps {
  groupId: string;
  groupName: string;
  /** The Group's saved rule; a Group stored without one is Allowed. */
  rule: AssistantRule;
  members: readonly Member[];
  viewerId: string;
  /** After a save, so the Group's read shows the new rule. */
  onSaved: () => void;
  onNotify: (message: string) => void;
}

const reachResponse = z.object({
  data: z.object({
    reach: z.array(
      z.object({
        member: z.object({ id: z.string(), name: z.string() }),
        assistant: z.string(),
        lastUsedAt: z.string().nullable(),
      }),
    ),
  }),
});
const fetchReach = async (path: string) => reachResponse.parse(await fetcher(path)).data;

/** What each rule means for the Group, as everyone reads it. */
function ruleMeaning(rule: AssistantRule, groupName: string) {
  return rule === 'allowed'
    ? `Members’ assistants can use ${groupName} with the access each member gave them.`
    : `Assistants can’t see ${groupName} at all. Members’ assistants keep working in their other Groups.`;
}

/** What saving a new rule does, shown before the admin saves; null while nothing changed. */
export function assistantRuleChange(
  groupName: string,
  saved: AssistantRule,
  chosen: AssistantRule,
): string | null {
  if (saved === chosen) return null;
  return chosen === 'not_allowed'
    ? `If you save, every member’s assistant loses ${groupName} at once. Drafts members already have stay in their To review.`
    : `If you save, members’ assistants can reach ${groupName} again, except where a member left it out.`;
}

/** "Only admins can change this: you and Priya Shah." */
function whoDecides(members: readonly Member[], viewerId: string) {
  const admins = members
    .filter((member) => member.role === 'admin')
    .sort((a, b) => Number(b.user._id === viewerId) - Number(a.user._id === viewerId))
    .map((member) => (member.user._id === viewerId ? 'you' : (member.user.name ?? 'an admin')));
  return `Only admins can change this: ${new Intl.ListFormat('en', { type: 'conjunction' }).format(admins)}.`;
}

/** Each member, and the assistants of theirs that reach the Group. */
function WhoIsConnected({
  groupId,
  groupName,
  rule,
  members,
  viewerId,
}: Pick<AssistantRuleSectionProps, 'groupId' | 'groupName' | 'rule' | 'members' | 'viewerId'>) {
  // A Not allowed Group is out of every assistant's reach, so there's nothing to read.
  const reachRead = useSWR(
    rule === 'allowed' ? `/api/groups/${groupId}/assistant-reach` : null,
    fetchReach,
  );
  if (rule === 'not_allowed')
    return (
      <Typography variant="body2" color="text.secondary">
        No assistant can reach {groupName} while assistants are Not allowed.
      </Typography>
    );
  if (reachRead.error)
    return (
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="body2" color="text.secondary">
          Who’s connected couldn’t be loaded.
        </Typography>
        <Button size="small" onClick={() => void reachRead.mutate()}>
          Retry
        </Button>
      </Stack>
    );
  if (!reachRead.data) return <Skeleton variant="rounded" height={96} />;
  const { reach } = reachRead.data;
  return (
    <Stack component="ul" spacing={1.5} sx={{ m: 0, p: 0, listStyle: 'none' }}>
      {members.map((member) => {
        const assistants = reach.filter((row) => row.member.id === member.user._id);
        return (
          <Stack key={member.user._id} component="li" direction="row" spacing={1.5}>
            <Avatar
              src={member.user.image ?? undefined}
              sx={{ width: 32, height: 32, fontSize: 13 }}
            >
              {member.user.name?.[0]}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={500} color="text.primary">
                {member.user._id === viewerId ? 'You' : member.user.name}{' '}
                <Typography component="span" variant="caption" color="text.secondary">
                  {member.role === 'admin' ? 'Admin' : 'Member'}
                </Typography>
              </Typography>
              {assistants.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  No assistant connected
                </Typography>
              ) : (
                assistants.map((row, index) => (
                  <Typography
                    key={`${row.assistant}-${index}`}
                    variant="body2"
                    color="text.secondary"
                    sx={{ overflowWrap: 'anywhere' }}
                  >
                    <bdi>{row.assistant}</bdi> · {lastUsedLabel(row.lastUsedAt)}
                  </Typography>
                ))
              )}
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}

/**
 * A Group's Assistant rule (#621): admins choose whether members' Connected assistants may reach
 * the Group at all and see whose assistants do; other members read the rule.
 */
export default function AssistantRuleSection(props: AssistantRuleSectionProps) {
  const { groupId, groupName, rule, members, viewerId, onSaved, onNotify } = props;
  const [choice, setChoice] = useState<AssistantRule | null>(null);
  const [saving, setSaving] = useState(false);
  const chosen = choice ?? rule;
  const change = assistantRuleChange(groupName, rule, chosen);
  const isAdmin = members.some((m) => m.user._id === viewerId && m.role === 'admin');

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/groups/${groupId}/assistant-rule`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule: chosen }),
      });
      if (!res.ok) {
        onNotify('Assistants setting couldn’t be saved');
        return;
      }
      setChoice(null);
      onSaved();
      onNotify(`Connected assistants set to ${ASSISTANT_RULE_LABELS[chosen]}`);
    } catch {
      onNotify('Assistants setting couldn’t be saved');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3 }} id="assistants">
      <Typography variant="subtitle1" fontWeight={600} color="text.primary" sx={{ mb: 1 }}>
        Assistants
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {whoDecides(members, viewerId)}
      </Typography>
      {!isAdmin ? (
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            Assistants in {groupName}
          </Typography>
          <Typography fontWeight={600} color="text.primary">
            {ASSISTANT_RULE_LABELS[rule]}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {ruleMeaning(rule, groupName)}
          </Typography>
        </Stack>
      ) : (
        <Stack spacing={2}>
          <Box>
            <Typography
              id="assistant-rule-label"
              variant="subtitle2"
              color="text.primary"
              sx={{ mb: 1 }}
            >
              Assistants in {groupName}
            </Typography>
            <RadioGroup
              aria-labelledby="assistant-rule-label"
              name="assistant-rule"
              value={chosen}
              onChange={(event) => setChoice(event.target.value as AssistantRule)}
            >
              {ASSISTANT_RULES.map((value) => (
                <FormControlLabel
                  key={value}
                  value={value}
                  disabled={saving}
                  control={<Radio />}
                  sx={{ alignItems: 'flex-start', mb: 1 }}
                  label={
                    <Box sx={{ pt: 1 }}>
                      <Typography color="text.primary">{ASSISTANT_RULE_LABELS[value]}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {ruleMeaning(value, groupName)}
                      </Typography>
                    </Box>
                  }
                />
              ))}
            </RadioGroup>
          </Box>
          {change && (
            <Typography
              variant="body2"
              color="text.primary"
              role="status"
              sx={{ bgcolor: 'surface.muted', borderRadius: 2, px: 1.5, py: 1 }}
            >
              {change}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            This limits every member’s assistant. Each member still chooses what their own assistant
            may do.
          </Typography>
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button color="inherit" disabled={!change || saving} onClick={() => setChoice(null)}>
              Cancel
            </Button>
            <Button variant="contained" disabled={!change || saving} onClick={() => void save()}>
              {saving ? <CircularProgress size={20} /> : 'Save changes'}
            </Button>
          </Stack>
          <Divider />
          <Box>
            <Typography variant="subtitle2" color="text.primary">
              Who’s connected here
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Only admins see this list.
            </Typography>
            <WhoIsConnected
              groupId={groupId}
              groupName={groupName}
              rule={rule}
              members={members}
              viewerId={viewerId}
            />
          </Box>
        </Stack>
      )}
    </Paper>
  );
}
