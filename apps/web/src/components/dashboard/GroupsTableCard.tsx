'use client';

import { createElement, useMemo, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Skeleton from '@mui/material/Skeleton';
import { useTheme, type Theme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import AddIcon from '@mui/icons-material/Add';
import type { GroupRead } from '@splitbook/shared/group-read';
import {
  readGroupLastChanges,
  readSpendingThisMonth,
  type GroupLastChangeRead,
  type SpendingThisMonthRead,
} from '@splitbook/shared/user-spending-read';
import ErrorState from '@/components/common/ErrorState';
import { visuallyHidden } from '@/components/common/visually-hidden';
import { groupThemeIcon } from '@/components/layout/group-theme-icons';
import { NEW_GROUP_HREF } from '@/components/layout/shell-nav';
import { useGroups } from '@/lib/hooks/use-groups';
import { HomeCard, HomeCardBody, HomeCardEmpty, HomeCardError, HomeCardLoading } from './HomeCard';
import {
  spendingField,
  useHomeBalances,
  useHomeSpending,
  type CardRead,
  type GroupBalanceAmounts,
} from './home-reads';
import {
  groupsTableRows,
  spentHeading,
  type Figure,
  type GroupBalance,
  type GroupsTableRow,
  type SpentLine,
} from './groups-table';

/*
 * Home's Groups table (#308, design canvas "Web portal"; web.css .tbl): every Group of the
 * member with its Theme, members, what it spent this Month, the member's balance there and
 * when it last changed, with New Group. A row opens its Group. On a phone it collapses to rows
 * with the name, the balance and the last change. The Groups come from the Groups list; each
 * figure from its own read, so a slow or failed read leaves only its column waiting.
 */

/** The card's region is labelled by its heading, `home-groups-heading`. */
const CARD_ID = 'home-groups';
const TILE_SIZE = 36;
const TILE_RADIUS = '11px';
const AVATAR_SIZE = 26;
const AVATAR_RADIUS = '9px';

export default function GroupsTableCard({ userId }: { userId: string }) {
  const theme = useTheme();
  // Rows only render once the Groups list has answered in the browser, so reading the screen
  // width at once can't make the server's markup differ from the first client render.
  const phone = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const groups = useGroups(userId);
  const { byGroup, retry: retryBalances } = useHomeBalances();
  const { read, failed, retry: retrySpending } = useHomeSpending();
  const thisMonth = useMemo(
    () => spendingField(read, failed, readSpendingThisMonth),
    [read, failed],
  );
  const lastChanges = useMemo(
    () => spendingField(read, failed, readGroupLastChanges),
    [read, failed],
  );
  return (
    <GroupsTableView
      userId={userId}
      layout={phone ? 'rows' : 'table'}
      groups={groups.data}
      groupsFailed={Boolean(groups.error)}
      onRetryGroups={() => void groups.mutate()}
      balances={byGroup}
      thisMonth={thisMonth}
      lastChanges={lastChanges}
      onRetryFigures={() => {
        if (byGroup.status === 'error') retryBalances();
        if (thisMonth.status === 'error' || lastChanges.status === 'error') retrySpending();
      }}
    />
  );
}

interface GroupsTableViewProps {
  userId: string;
  /** A table, or on a phone a row per Group. */
  layout?: 'table' | 'rows';
  /** Undefined until the Groups list first answers. */
  groups: GroupRead[] | undefined;
  /** The Groups list's last read failed: nothing to show, or the Groups shown are older. */
  groupsFailed: boolean;
  onRetryGroups: () => void;
  balances: CardRead<Map<string, GroupBalanceAmounts>>;
  thisMonth: CardRead<SpendingThisMonthRead>;
  lastChanges: CardRead<GroupLastChangeRead[]>;
  /** Reads again whichever figures' reads failed. */
  onRetryFigures: () => void;
  /** "Today" and "Yesterday" are counted from here. */
  now?: Date;
}

/** The card for the Groups list and the reads beside it, in whatever state each is in. */
export function GroupsTableView({
  userId,
  layout = 'table',
  groups,
  groupsFailed,
  onRetryGroups,
  balances,
  thisMonth,
  lastChanges,
  onRetryFigures,
  now = new Date(),
}: GroupsTableViewProps) {
  const rows = groups
    ? groupsTableRows({ groups, userId, balances, thisMonth, lastChanges, now })
    : null;
  const figuresFailed = [balances, thisMonth, lastChanges].some((read) => read.status === 'error');

  return (
    <HomeCard
      id={CARD_ID}
      title="Groups"
      aside={
        <Button
          component={Link}
          href={NEW_GROUP_HREF}
          startIcon={<AddIcon />}
          sx={{ minHeight: { xs: 44, sm: 36 }, px: 1.5, borderRadius: '10px', fontWeight: 600 }}
        >
          New Group
        </Button>
      }
    >
      {rows === null ? (
        groupsFailed ? (
          <HomeCardError message="Your Groups could not be loaded." onRetry={onRetryGroups} />
        ) : (
          <HomeCardLoading label="Loading your Groups" blocks={3} height={44} />
        )
      ) : rows.length === 0 ? (
        <HomeCardEmpty
          title="No Groups yet"
          description="Start one with New Group, or join one from an invitation."
        />
      ) : (
        <>
          {groupsFailed ? (
            <HomeCardBody>
              <ErrorState
                severity="warning"
                message="Groups could not be refreshed. Showing previously loaded Groups."
                onRetry={onRetryGroups}
                retryLabel="Try again"
              />
            </HomeCardBody>
          ) : null}
          {layout === 'table' ? (
            <GroupsTable rows={rows} spentHeading={spentHeading(thisMonth)} />
          ) : (
            <GroupRows rows={rows} />
          )}
          {figuresFailed ? (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: 1,
                px: 2.5,
                pt: 1,
                color: 'text.secondary',
                fontSize: '0.8125rem',
              }}
            >
              Some figures could not be loaded.
              <Button size="small" onClick={onRetryFigures} sx={{ minHeight: { xs: 44, sm: 32 } }}>
                Try again
              </Button>
            </Box>
          ) : null}
        </>
      )}
    </HomeCard>
  );
}

/** Ignore a click meant for a link or button inside the row, or one asking for a new tab. */
function opensRow(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !target.closest('a, button')
  );
}

/** The desktop table: web.css .tbl. A wide table scrolls inside the card, never the page. */
function GroupsTable({ rows, spentHeading }: { rows: GroupsTableRow[]; spentHeading: string }) {
  const router = useRouter();
  const cell = {
    px: 1.5,
    py: 1.25,
    height: 56,
    borderBottom: 1,
    borderColor: 'divider',
    textAlign: 'left',
    verticalAlign: 'middle',
    '&:first-of-type': { pl: 2.5 },
    '&:last-of-type': { pr: 2.5 },
  } as const;
  const number = { ...cell, textAlign: 'right', whiteSpace: 'nowrap' } as const;
  const heading = {
    ...cell,
    height: 'auto',
    py: 1.25,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'text.secondary',
  } as const;
  return (
    // May scroll sideways in a narrow card: the keyboard can reach and scroll it.
    <Box
      role="region"
      aria-label="Groups table"
      tabIndex={0}
      sx={{
        overflowX: 'auto',
        '&:focus-visible': { outline: 2, outlineColor: 'focus.main', outlineOffset: -2 },
      }}
    >
      <Box
        component="table"
        aria-labelledby={`${CARD_ID}-heading`}
        sx={{
          width: '100%',
          // Narrower than the canvas's 640 px: on a laptop the headings and Last change wrap
          // before the table scrolls inside the card.
          minWidth: 560,
          borderCollapse: 'collapse',
          fontSize: '0.875rem',
          '& tbody tr:last-of-type > *': { borderBottom: 0 },
          '& tbody tr': { cursor: 'pointer' },
          '& tbody tr:hover > *': { bgcolor: 'surface.hover' },
        }}
      >
        <thead>
          <tr>
            <Box component="th" scope="col" sx={heading}>
              Group
            </Box>
            <Box component="th" scope="col" sx={heading}>
              Members
            </Box>
            <Box component="th" scope="col" sx={{ ...heading, textAlign: 'right' }}>
              {spentHeading}
            </Box>
            <Box component="th" scope="col" sx={{ ...heading, textAlign: 'right' }}>
              Your balance
            </Box>
            <Box component="th" scope="col" sx={heading}>
              Last change
            </Box>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.groupId}
              data-group-id={row.groupId}
              onClick={(event) => {
                if (opensRow(event)) router.push(row.href);
              }}
            >
              <Box component="th" scope="row" sx={{ ...cell, fontWeight: 400, minWidth: 180 }}>
                <GroupLink row={row} />
              </Box>
              <Box component="td" sx={{ ...cell, whiteSpace: 'nowrap' }}>
                <MemberAvatars members={row.members} />
              </Box>
              <Box component="td" sx={number}>
                <SpentCell spent={row.spent} />
              </Box>
              <Box component="td" sx={number}>
                <BalanceCell balance={row.balance} />
              </Box>
              <Box component="td" sx={{ ...cell, color: 'text.secondary' }}>
                <LastChangeCell lastChange={row.lastChange} />
              </Box>
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

/** Phones: a row per Group with its name, the member's balance and when it last changed. */
function GroupRows({ rows }: { rows: GroupsTableRow[] }) {
  return (
    <Box
      component="ul"
      aria-labelledby={`${CARD_ID}-heading`}
      sx={{ listStyle: 'none', m: 0, p: 0 }}
    >
      {rows.map((row) => (
        <Box
          component="li"
          key={row.groupId}
          sx={{ '& + &': { borderTop: 1, borderColor: 'divider' } }}
        >
          <Box
            component={Link}
            href={row.href}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              minHeight: 64,
              px: 2.5,
              py: 1,
              color: 'text.primary',
              textDecoration: 'none',
              outlineOffset: '-2px',
              '&:hover': { bgcolor: 'surface.hover' },
            }}
          >
            <ThemeTile category={row.category} />
            <GroupName row={row} />
            <Box
              sx={{
                flex: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: '2px',
                textAlign: 'right',
              }}
            >
              <BalanceCell balance={row.balance} />
              <Box component="span" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                <LastChangeCell lastChange={row.lastChange} />
              </Box>
            </Box>
          </Box>
        </Box>
      ))}
    </Box>
  );
}

function ThemeTile({ category }: { category: GroupsTableRow['category'] }) {
  return (
    <Box
      aria-hidden
      data-group-theme={category}
      sx={{
        width: TILE_SIZE,
        height: TILE_SIZE,
        flex: 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: TILE_RADIUS,
        bgcolor: 'tint.brand',
        color: 'primary.main',
      }}
    >
      {createElement(groupThemeIcon(category), { sx: { fontSize: 18 } })}
    </Box>
  );
}

/** The Group's name, and under it the Theme (with a Trip's dates). */
function GroupName({ row }: { row: GroupsTableRow }) {
  return (
    <Box sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <Box
        component="span"
        sx={{ fontWeight: 600, lineHeight: 1.4, overflowWrap: 'anywhere', color: 'text.primary' }}
      >
        {row.name}
      </Box>
      <Box component="span" sx={{ fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' }}>
        {row.themeLine}
      </Box>
    </Box>
  );
}

/** The table's first cell: the Group's link, which the whole row also follows. */
function GroupLink({ row }: { row: GroupsTableRow }) {
  return (
    <Box
      component={Link}
      href={row.href}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1.5,
        minWidth: 0,
        color: 'text.primary',
        textDecoration: 'none',
        borderRadius: '8px',
      }}
    >
      <ThemeTile category={row.category} />
      <GroupName row={row} />
    </Box>
  );
}

/** Avatars, viewer first, with "+N" past the first few; read out as the members' names. */
function MemberAvatars({ members }: { members: GroupsTableRow['members'] }) {
  return (
    <Box role="img" aria-label={members.label} sx={{ display: 'inline-flex' }}>
      {members.shown.map((person) => (
        <Avatar key={person.id} src={person.image} alt="" aria-hidden sx={avatarSx}>
          {person.initials}
        </Avatar>
      ))}
      {members.more > 0 ? (
        <Avatar aria-hidden sx={avatarSx}>
          +{members.more}
        </Avatar>
      ) : null}
    </Box>
  );
}

const avatarSx = {
  width: AVATAR_SIZE,
  height: AVATAR_SIZE,
  borderRadius: AVATAR_RADIUS,
  bgcolor: 'tint.brand',
  color: 'primary.main',
  fontSize: '0.65625rem',
  fontWeight: 600,
  // A ring in the card's colour separates the overlapping avatars.
  boxShadow: (theme: Theme) => `0 0 0 2px ${theme.palette.background.paper}`,
  '&:not(:first-of-type)': { ml: '-6px' },
} as const;

/** A figure whose read is loading or failed: a placeholder, or a dash read as "Not available". */
function PendingFigure({ figure }: { figure: Figure<unknown> }) {
  if (figure.status === 'loading')
    return <Skeleton aria-hidden variant="text" width={72} sx={{ display: 'inline-block' }} />;
  return <Dash spoken="Not available" />;
}

function Dash({ spoken }: { spoken: string }) {
  return (
    <>
      <Box component="span" aria-hidden sx={{ color: 'text.secondary' }}>
        –
      </Box>
      <Box component="span" sx={visuallyHidden}>
        {spoken}
      </Box>
    </>
  );
}

/** Money in the theme's mono type, one line per currency. */
function MoneyLines({ children }: { children: ReactNode }) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        ...theme.typography.money,
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        fontSize: '0.875rem',
        lineHeight: 1.4,
      })}
    >
      {children}
    </Box>
  );
}

function SpentCell({ spent }: { spent: Figure<SpentLine[]> }) {
  if (spent.status !== 'ready') return <PendingFigure figure={spent} />;
  return (
    <MoneyLines>
      {spent.value.map((line) => (
        <Box
          component="span"
          key={line.currency}
          sx={{ color: line.zero ? 'text.secondary' : 'text.primary' }}
        >
          {line.text}
        </Box>
      ))}
    </MoneyLines>
  );
}

function BalanceCell({ balance }: { balance: Figure<GroupBalance> }) {
  if (balance.status !== 'ready') return <PendingFigure figure={balance} />;
  if (balance.value.kind === 'settled')
    return (
      <Box
        component="span"
        sx={{ fontSize: '0.8125rem', color: 'text.secondary', whiteSpace: 'nowrap' }}
      >
        Settled up
      </Box>
    );
  return (
    <MoneyLines>
      {balance.value.lines.map((line) => (
        <Box
          component="span"
          key={line.currency}
          sx={{ color: line.tone === 'negative' ? 'status.negative' : 'status.positive' }}
        >
          <span aria-hidden>{line.text}</span>
          <Box component="span" sx={visuallyHidden}>
            {line.spoken}
          </Box>
        </Box>
      ))}
    </MoneyLines>
  );
}

function LastChangeCell({ lastChange }: { lastChange: GroupsTableRow['lastChange'] }) {
  if (lastChange.status !== 'ready') return <PendingFigure figure={lastChange} />;
  if (!lastChange.value) return <Dash spoken="No changes yet" />;
  return <time dateTime={lastChange.value.at}>{lastChange.value.text}</time>;
}
