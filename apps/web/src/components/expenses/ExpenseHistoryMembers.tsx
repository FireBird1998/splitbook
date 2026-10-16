import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import {
  memberMoneyLabel,
  NOT_INCLUDED,
  type MemberMoneyChange,
} from '@splitbook/shared/expense-detail';

interface ExpenseHistoryMembersProps {
  /** The members whose payment or share one edit changed. */
  members: MemberMoneyChange[];
  /** A member's name from their reference, or "Former member"; never "You". */
  nameOf: (person: unknown) => string;
  /** The viewer, whose payment or share is "Your". */
  userId: string;
}

function Amount({ value }: { value: string | null }) {
  // Someone outside the split has no share: a word, not an amount.
  if (value === null) return <>{NOT_INCLUDED}</>;
  return (
    <Box component="span" sx={(theme) => theme.typography.money}>
      {value}
    </Box>
  );
}

/**
 * Under an edit in an Expense's history, each member whose payment or share it changed:
 * "Your share ₹333.00 → ₹600.00", as the side panel and the phone card both read (#456).
 */
export default function ExpenseHistoryMembers({
  members,
  nameOf,
  userId,
}: ExpenseHistoryMembersProps) {
  if (members.length === 0) return null;
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {members.map((member, index) => (
        <Typography
          key={index}
          component="li"
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', overflowWrap: 'anywhere' }}
        >
          {memberMoneyLabel(member, nameOf, userId)} <Amount value={member.before} /> →{' '}
          <Amount value={member.after} />
        </Typography>
      ))}
    </Box>
  );
}
