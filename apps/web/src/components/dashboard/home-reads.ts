'use client';

import { WEB_QUERY_ACCOUNT } from '@/lib/web-query-keys';
import { useSyncExternalStore } from 'react';
import useSWR from 'swr';
import {
  homeBalancesKey,
  invitationsKey,
  userSpendingKey,
  queryKeyPath,
  type AccountQueryKey,
} from '@splitbook/shared/query-keys';
import { homeCurrencyBalances, type HomeCurrencyBalance } from '@splitbook/shared/dashboard';
import {
  parseHomeBalancesResponse,
  readHomeSuggestedPayments,
  type HomeSuggestedPaymentRead,
} from '@splitbook/shared/home-balances-read';
import { SPENDING_MONTHS } from '@splitbook/shared/insights';
import type { GroupCategory } from '@splitbook/shared/types';
import {
  parseUserSpendingResponse,
  type UserSpendingRead,
} from '@splitbook/shared/user-spending-read';
import { isTimeZone } from '@splitbook/shared/zoned-calendar';
import { fetcher } from '@/lib/utils/fetcher';
import { fetchWebHomeBalances, fetchWebRead } from '@/lib/web-read';

/**
 * Home's reads (#306). Each card calls the hook for what it shows; SWR shares one request per
 * read between them and with the sidebar, which uses the same keys and fetcher. A card is in
 * one of three states, and fails on its own: a read that answered once keeps showing its last
 * answer if a later poll fails.
 */
export type CardRead<T> =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: T };

/** Polled like the sidebar, so Home follows changes made elsewhere. */
const readOptions = { refreshInterval: 30_000 };

export const HOME_BALANCES_KEY = homeBalancesKey(WEB_QUERY_ACCOUNT);
export const HOME_INVITATIONS_KEY = invitationsKey(WEB_QUERY_ACCOUNT);

interface SWRState {
  data: unknown;
  error: unknown;
}

function cardRead<T>({ data, error }: SWRState, read: (data: unknown) => T): CardRead<T> {
  if (data === undefined) return error ? { status: 'error' } : { status: 'loading' };
  try {
    return { status: 'ready', value: read(data) };
  } catch {
    // An answer the shared decoder or the exact-money reader refuses is a failure, never a
    // figure: the card offers Try again rather than show something it can't stand behind.
    return { status: 'error' };
  }
}

/** Home's balance per currency, and whether the member is in any Group at all. */
export interface HomeBalances {
  currencies: HomeCurrencyBalance[];
  /** How many Groups the member is in; 0 shows the "no Groups yet" empty state. */
  groupCount: number;
}

/** The member's balance in one Group, per currency, as the balances read sends it (major units). */
export type GroupBalanceAmounts = readonly { currency: string; balance: number }[];

/**
 * The balances read, for Your balances, Needs you's suggested payments and the Groups table's
 * balance in each Group.
 */
export function useHomeBalances() {
  const result = useSWR(HOME_BALANCES_KEY, fetchWebHomeBalances, readOptions);
  const retry = () => void result.mutate();
  return {
    balances: cardRead<HomeBalances>(result, (data) => {
      const home = parseHomeBalancesResponse(data);
      const groups = home.groups ?? [];
      return { currencies: homeCurrencyBalances(home.buckets, groups), groupCount: groups.length };
    }),
    payments: cardRead<HomeSuggestedPaymentRead[]>(result, (data) =>
      readHomeSuggestedPayments(parseHomeBalancesResponse(data)),
    ),
    byGroup: cardRead<Map<string, GroupBalanceAmounts>>(
      result,
      (data) =>
        new Map(
          (parseHomeBalancesResponse(data).groups ?? []).map((group) => [
            group.groupId,
            group.balances,
          ]),
        ),
    ),
    retry,
  };
}

/** A Group invitation waiting for the member, as Needs you shows it. */
export interface HomeInvitation {
  id: string;
  groupName: string;
  category: GroupCategory | null;
  invitedByName: string | null;
}

/** The invitations read's answer, keeping only what Needs you shows. Throws when malformed. */
export function readInvitations(data: unknown): HomeInvitation[] {
  const list = (data as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) throw new Error('Unexpected invitations read');
  return list.map((item) => {
    const invitation = item as {
      _id?: unknown;
      group?: { name?: unknown; category?: unknown } | null;
      invitedBy?: { name?: unknown } | null;
    };
    if (typeof invitation._id !== 'string' || typeof invitation.group?.name !== 'string')
      throw new Error('Unexpected invitation');
    return {
      id: invitation._id,
      groupName: invitation.group.name,
      category:
        typeof invitation.group.category === 'string'
          ? (invitation.group.category as GroupCategory)
          : null,
      invitedByName:
        typeof invitation.invitedBy?.name === 'string' ? invitation.invitedBy.name : null,
    };
  });
}

/** The member's pending invitations, for Needs you. */
export function useHomeInvitations() {
  const result = useSWR(HOME_INVITATIONS_KEY, fetchWebRead, readOptions);
  return {
    invitations: cardRead(result, readInvitations),
    retry: () => void result.mutate(),
  };
}

/** The viewer's own time zone, read in the browser only: the server's would be wrong. */
const noSubscription = () => () => {};
function browserTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : 'UTC';
}
function useViewerTimeZone(): string | null {
  return useSyncExternalStore(noSubscription, browserTimeZone, () => null);
}

async function fetchSpending(key: AccountQueryKey): Promise<UserSpendingRead> {
  return parseUserSpendingResponse(await fetcher(queryKeyPath(key)));
}

/**
 * The spending read (#307): six Months in the viewer's time zone, so it waits for the browser.
 * The spending chart, "Where it went" and the Groups table (#308) share its one request; each
 * reads its own fields from the answer and fails on its own.
 */
export function useHomeSpending() {
  const timeZone = useViewerTimeZone();
  const { data, error, mutate } = useSWR(
    timeZone
      ? userSpendingKey(WEB_QUERY_ACCOUNT, { months: SPENDING_MONTHS.default, timeZone })
      : null,
    fetchSpending,
    readOptions,
  );
  return { read: data, failed: !data && Boolean(error), retry: () => void mutate() };
}

/**
 * One of the fields #308 adds to the spending read, decoded on its own: a field the decoder
 * refuses fails only the card or column that shows it, never the spending chart.
 */
export function spendingField<T>(
  read: UserSpendingRead | undefined,
  failed: boolean,
  field: (read: UserSpendingRead) => T,
): CardRead<T> {
  if (!read) return failed ? { status: 'error' } : { status: 'loading' };
  try {
    return { status: 'ready', value: field(read) };
  } catch {
    return { status: 'error' };
  }
}
