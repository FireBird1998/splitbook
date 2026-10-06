'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import {
  parseHomeBalancesResponse,
  type HomeBalancesRead,
} from '@splitbook/shared/home-balances-read';
import { useGroups } from '@/lib/hooks/use-groups';
import { fetcher } from '@/lib/utils/fetcher';
import { GROUPS_HREF, NEW_GROUP_HREF, groupCurrent, groupsListCurrent } from './shell-nav';
import { groupThemeIcon } from './group-theme-icons';
import {
  moreCurrenciesLabel,
  sidebarBalanceLine,
  type SidebarBalanceLine,
} from './sidebar-balance';

/** Shell sizes from the design canvas (web.css: .side-h, .g-a, .gi). */
const ROW_RADIUS = '10px';
const TILE_RADIUS = '9px';

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  margin: -1,
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

/** The read Home's balances use: the same key and fetcher, so both share one request. */
export const USER_BALANCES_KEY = '/api/user/balances';

function readBalances(raw: unknown): HomeBalancesRead | null {
  try {
    return parseHomeBalancesResponse(raw);
  } catch {
    return null;
  }
}

/** A Group's line: still loading, a figure, or nothing to claim (the read failed or lacks it). */
type RowBalance = SidebarBalanceLine | 'loading' | null;

interface SidebarGroupsProps {
  userId: string;
  pathname: string;
  /** The phone drawer: every target is at least 44 px. */
  touch?: boolean;
  onNavigate?: () => void;
}

/**
 * The sidebar's live Group list: every Group of the member with its Theme, name and the
 * member's balance there. It reads what Home reads (the Groups list and the member's
 * balances), polls with them, and never holds up the page: each read loads, fails and
 * recovers on its own.
 */
export default function SidebarGroups({
  userId,
  pathname,
  touch = false,
  onNavigate,
}: SidebarGroupsProps) {
  const groups = useGroups(userId);
  const balances = useSWR(USER_BALANCES_KEY, fetcher, { refreshInterval: 30_000 });

  const balanceRead = useMemo(
    () => (balances.data === undefined ? undefined : readBalances(balances.data)),
    [balances.data],
  );
  const balancesByGroup = useMemo(
    () => new Map((balanceRead?.groups ?? []).map((group) => [group.groupId, group.balances])),
    [balanceRead],
  );
  const balancesFailed = balanceRead === null || (balanceRead === undefined && !!balances.error);

  function rowBalance(groupId: string, currency: string): RowBalance {
    if (balanceRead === undefined) return balances.error ? null : 'loading';
    const amounts = balancesByGroup.get(groupId);
    return amounts ? sidebarBalanceLine(amounts, currency) : null;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5,
          minHeight: touch ? 44 : 28,
        }}
      >
        <Box
          component={Link}
          href={GROUPS_HREF}
          onClick={onNavigate}
          aria-current={groupsListCurrent(pathname)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            alignSelf: 'stretch',
            borderRadius: '6px',
            fontSize: '0.71875rem',
            lineHeight: 1.3,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            textDecoration: 'none',
            color: 'text.secondary',
            '&:hover': { color: 'text.primary', textDecoration: 'underline' },
            '&[aria-current="page"]': { color: 'primary.main' },
          }}
        >
          Groups
        </Box>
        <IconButton
          component={Link}
          href={NEW_GROUP_HREF}
          onClick={onNavigate}
          aria-label="New Group"
          sx={{
            width: touch ? 44 : 36,
            height: touch ? 44 : 36,
            borderRadius: '12px',
            color: 'text.secondary',
            '&:hover': { bgcolor: 'surface.muted', color: 'text.primary' },
          }}
        >
          <AddIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>

      <Box
        component="nav"
        aria-label="Your Groups"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
          minHeight: 0,
          overflowY: 'auto',
          // Room inside the scrolling box for each link's focus ring.
          p: 0.5,
          m: -0.5,
        }}
      >
        {groups.data ? (
          groups.data.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
              Create or join a Group to see it here.
            </Typography>
          ) : (
            groups.data.map((group) => {
              const Icon = groupThemeIcon(group.category);
              return (
                <Box
                  key={group._id}
                  component={Link}
                  href={`/groups/${group._id}`}
                  onClick={onNavigate}
                  aria-current={groupCurrent(pathname, group._id)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    minHeight: 48,
                    px: '10px',
                    py: 0.5,
                    borderRadius: ROW_RADIUS,
                    color: 'text.primary',
                    textDecoration: 'none',
                    '&:hover': { bgcolor: 'surface.hover' },
                    '&[aria-current]': { bgcolor: 'tint.brand' },
                    '&[aria-current] .sidebar-group-tile': { bgcolor: 'background.paper' },
                  }}
                >
                  <Box
                    className="sidebar-group-tile"
                    data-group-theme={group.category}
                    aria-hidden
                    sx={{
                      width: 30,
                      height: 30,
                      flex: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: TILE_RADIUS,
                      bgcolor: 'tint.brand',
                      color: 'primary.main',
                    }}
                  >
                    <Icon sx={{ fontSize: 18 }} />
                  </Box>
                  <Box
                    sx={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column' }}
                  >
                    <Box
                      component="span"
                      sx={{
                        fontSize: '0.875rem',
                        lineHeight: 1.4,
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {group.name}
                    </Box>
                    <BalanceLine balance={rowBalance(group._id, group.defaultCurrency)} />
                  </Box>
                </Box>
              );
            })
          )
        ) : groups.error ? (
          <Box sx={{ px: 1.5, py: 1 }}>
            <Typography variant="body2" color="text.secondary">
              Your Groups didn&apos;t load.
            </Typography>
            <Button
              size="small"
              onClick={() => void groups.mutate()}
              sx={{ ml: -1, minHeight: touch ? 44 : 36 }}
            >
              Retry
            </Button>
          </Box>
        ) : (
          <Box role="status" aria-label="Loading your Groups" sx={{ px: '10px' }}>
            {[0, 1, 2].map((row) => (
              <Box
                key={row}
                aria-hidden
                sx={{ display: 'flex', alignItems: 'center', gap: '10px', minHeight: 48 }}
              >
                <Skeleton
                  variant="rounded"
                  width={30}
                  height={30}
                  sx={{ borderRadius: TILE_RADIUS }}
                />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width="70%" />
                  <Skeleton variant="text" width="45%" sx={{ fontSize: '0.75rem' }} />
                </Box>
              </Box>
            ))}
          </Box>
        )}
        {groups.data && groups.data.length > 0 && balancesFailed ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, pt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">
              Balances unavailable.
            </Typography>
            <Button
              size="small"
              onClick={() => void balances.mutate()}
              sx={{ minHeight: touch ? 44 : 28, minWidth: 0, px: 1 }}
            >
              Retry
            </Button>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function BalanceLine({ balance }: { balance: RowBalance }) {
  if (balance === null) return null;
  if (balance === 'loading')
    return <Skeleton aria-hidden variant="text" width="55%" sx={{ fontSize: '0.75rem' }} />;
  if (balance.tone === 'settled')
    return (
      <Box component="span" sx={{ fontSize: '0.75rem', lineHeight: 1.35, color: 'text.secondary' }}>
        {balance.text}
      </Box>
    );
  return (
    <Box
      component="span"
      sx={(theme) => ({
        ...theme.typography.money,
        fontSize: '0.78125rem',
        lineHeight: 1.3,
        letterSpacing: '-0.02em',
        overflowWrap: 'anywhere',
        color: balance.tone === 'negative' ? 'status.negative' : 'status.positive',
      })}
    >
      {balance.text}
      {balance.more > 0 ? (
        <>
          <span aria-hidden> · +{balance.more}</span>
          <Box component="span" sx={visuallyHidden}>
            , {moreCurrenciesLabel(balance.more)}
          </Box>
        </>
      ) : null}
    </Box>
  );
}
