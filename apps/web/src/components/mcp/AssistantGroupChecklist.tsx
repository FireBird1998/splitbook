import { assistantReachesGroup } from '@splitbook/shared/assistant-reach';
import Box from '@mui/material/Box';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import Typography from '@mui/material/Typography';
import type { ApprovalGroup } from '@/lib/services/assistant-ledger.service';
import { getGroupTheme } from '@splitbook/shared/group-themes';

/** "Trip · INR, EUR", or "Work · EUR · Archived": what a Group is, beside its name. */
function groupMeta(group: ApprovalGroup) {
  return [getGroupTheme(group.theme ?? 'other').label, group.currencies.join(', ')]
    .concat(group.archived ? ['Archived'] : [])
    .join(' · ');
}

/** Why a Not allowed Group can't be ticked: which admin doesn't allow assistants there (#621). */
function notAllowedBy(group: ApprovalGroup, viewerId: string) {
  if (!group.ruleSetBy) return 'This Group’s admins don’t allow assistants';
  return group.ruleSetBy.id === viewerId
    ? 'You don’t allow assistants in this Group'
    : `${group.ruleSetBy.name} doesn’t allow assistants in this Group`;
}

/**
 * Every Group the member could tick is unticked: the assistant would reach none of them now. A
 * Group whose admins don't allow assistants can't be ticked, so it doesn't count (#621).
 */
export function leavesOutEveryGroup(
  groups: readonly Pick<ApprovalGroup, 'id' | 'rule'>[],
  excluded: readonly string[],
) {
  const refs = groups.map((group) => ({ id: group.id, assistantRule: group.rule }));
  return (
    refs.some((group) => assistantReachesGroup(group)) &&
    !refs.some((group) => assistantReachesGroup(group, excluded))
  );
}

/**
 * Which Groups the assistant reaches (#617), on the approval page and on its own page (#620): every Group ticked to start. The ones the member
 * unticks become that connection's Excluded Groups, and Groups joined later are included. A Group
 * whose admins don't allow assistants is greyed out and can't be ticked (#621).
 */
export function AssistantGroupChecklist({
  name,
  viewerId,
  groups,
  excluded,
  disabled,
  onExcludedChange,
}: {
  name: string;
  /** The member approving, who reads as "You" when they stopped assistants in a Group. */
  viewerId: string;
  groups: readonly ApprovalGroup[];
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
          {groups.map((group) => {
            const reachGroup = { id: group.id, assistantRule: group.rule };
            const notAllowed = !assistantReachesGroup(reachGroup);
            return (
              <FormControlLabel
                key={group.id}
                control={
                  <Checkbox
                    checked={assistantReachesGroup(reachGroup, excluded)}
                    disabled={disabled || notAllowed}
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
                    <Typography
                      variant="body2"
                      fontWeight={500}
                      color={notAllowed ? 'text.disabled' : undefined}
                    >
                      {group.name}
                    </Typography>
                    <Typography
                      variant="caption"
                      component="p"
                      color={notAllowed ? 'text.disabled' : 'text.secondary'}
                    >
                      {groupMeta(group)}
                    </Typography>
                    {notAllowed && (
                      <Typography variant="caption" component="p" color="text.secondary">
                        {notAllowedBy(group, viewerId)}
                      </Typography>
                    )}
                  </Box>
                }
              />
            );
          })}
        </FormGroup>
      )}
      {groups.length > 0 && (
        <Typography variant="body2">
          Groups you untick are left out of <bdi>{name}</bdi>’s answers, so its totals won’t include
          them.
        </Typography>
      )}
      {groups.some(
        (group) => !assistantReachesGroup({ id: group.id, assistantRule: group.rule }),
      ) && (
        <Typography variant="body2" color="text.secondary">
          A Group’s admins decide whether assistants can use it.
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
