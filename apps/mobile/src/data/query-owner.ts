import type { Query, QueryClient } from '@tanstack/query-core';
import {
  groupKey,
  groupBalancesKey,
  groupsKey,
  homeBalancesKey,
  matchGroup,
  matchScope,
  type QueryKey,
  type QueryScope,
  type QueryAccount,
} from '@splitbook/shared/query-keys';

/** A removed query never owns a later answer or deferred saved-row write for the same key. */
export function queryOwner(client: QueryClient, key: QueryKey) {
  const query = client.getQueryCache().build(client, client.defaultQueryOptions({ queryKey: key }));
  return () =>
    client.getQueryCache().get<unknown, Error, unknown, QueryKey>(query.queryHash) === query;
}

/** A network fallback must not turn an invalidated query's older disk row into an early preview. */
export function keepInvalidated(client: QueryClient, key: QueryKey) {
  const query = client.getQueryCache().find({ queryKey: key, exact: true });
  if (!query?.state.isInvalidated) return;
  void query.promise
    ?.then(() => {
      if (client.getQueryCache().get(query.queryHash) === query) query.invalidate();
    })
    .catch(() => undefined);
}

/** Replace response owners; empty successors retain the library's own preview invalidation. */
export function replaceQueries(
  client: QueryClient,
  predicate: (query: Query) => boolean,
  invalidatedKeys: QueryKey[] = [],
) {
  const affected = client.getQueryCache().findAll({ predicate });
  client.removeQueries({ predicate });
  for (const query of affected)
    if (query.state.isInvalidated)
      client
        .getQueryCache()
        .build(client, client.defaultQueryOptions({ queryKey: query.queryKey }))
        .invalidate();
  for (const key of invalidatedKeys)
    client
      .getQueryCache()
      .build(client, client.defaultQueryOptions({ queryKey: key }))
      .invalidate();
}

/** Scope selection is shared with durable distrust; neither holds a response or revision. */
export const inScope = (scope: string) => {
  const [name, groupId] = scope.split(':') as [QueryScope, string?];
  return (key: unknown) =>
    matchScope(name)(key) && (groupId === undefined || matchGroup(groupId)(key));
};

/** Retire the actual response owners, retaining built-in preview invalidation in successors. */
export function replaceScopedQueries(
  client: QueryClient,
  account: QueryAccount,
  scopes: string[],
  invalidate: boolean,
) {
  const predicate = ({ queryKey }: Query) => scopes.some((scope) => inScope(scope)(queryKey));
  const keys: QueryKey[] = [];
  if (invalidate) {
    keys.push(
      ...client
        .getQueryCache()
        .findAll({ predicate })
        .map(({ queryKey }) => queryKey as QueryKey),
    );
    // A disk row can precede the resource's first query in this session.
    for (const scope of scopes) {
      const [name, id] = scope.split(':');
      if (name === 'groups') keys.push(groupsKey(account));
      if (name === 'home') keys.push(homeBalancesKey(account));
      if (id && name === 'group') keys.push(groupKey(account, id));
      if (id && name === 'balances') keys.push(groupBalancesKey(account, id));
    }
  }
  replaceQueries(client, predicate, keys);
}
