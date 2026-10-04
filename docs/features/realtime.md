# Feature: Real-time Sync

## Overview

When multiple group members are viewing the same group, changes (new expenses, settlements, member joins) should appear automatically without manual refresh. We use **polling** for v1 (simple, reliable) with optional upgrade to **Server-Sent Events (SSE)** later.

---

## User Stories

1. **As a user**, when someone adds an expense to a group I'm viewing, it appears automatically.
2. **As a user**, when someone records a settlement, my balance updates.
3. **As a user**, I see a subtle notification when new data arrives.

---

## Strategy: Polling with SWR

### Why Polling First?

| Approach      | Pros                                      | Cons                                      |
| ------------- | ----------------------------------------- | ----------------------------------------- |
| Polling (SWR) | Simple, works everywhere, no server state | Slight delay, unnecessary requests        |
| SSE           | Real-time, server push                    | Needs connection management, more complex |
| WebSocket     | Bi-directional, real-time                 | Most complex, overkill for this use case  |

For v1, SWR's built-in polling (`refreshInterval`) is sufficient and simple.

---

## Implementation

### SWR Auto-Refresh

**There is no hooks layer.** `useSWR` is called directly in each component —
there is no `src/hooks` directory and no `useExpenses` / `useBalances` /
`useActivity` wrapper. The pattern is:

```typescript
// src/components/expenses/ExpenseListView.tsx
const { data, isLoading, isValidating, error, mutate } = useSWR(
  `/api/groups/${groupId}/expenses?${params}`,
  fetcher,
  { refreshInterval: 10_000, keepPreviousData: true },
);
```

`keepPreviousData` is what makes filtering non-blocking — the previous page stays
on screen while the new query resolves, with `isValidating` driving a subtle
loading affordance rather than a full skeleton.

`fetcher` (`src/lib/utils/fetcher.ts`) is a thin wrapper over `fetch` that
returns `res.json()`, falling back to `{}` when the body will not parse. Note the
consequence: an expired session is redirected to `/login` as HTML, which parses
as a failure and surfaces as **empty data rather than an error**.

### Refresh after mutation

There are **no optimistic updates** — no call site passes `optimisticData` or
`rollbackOnError`. After a successful write the component simply calls `mutate()`
and waits for the revalidated response:

```typescript
// src/components/expenses/ExpenseListView.tsx
await fetch(`/api/groups/${groupId}/expenses`, { method: 'POST', body: JSON.stringify(data) });
mutate();
```

The UI therefore lags a write by one round-trip. Adding optimistic updates would
be a real change, not a documentation fix.

### Not implemented

- **"New data" notification** ("🔔 Jane added a new expense"). Polling replaces
  the data silently; nothing diffs successive responses or attributes changes to
  another user.
- Server-Sent Events / WebSockets (see below).

---

## v2: Server-Sent Events (Optional Upgrade)

### SSE Endpoint

```typescript
// GET /api/groups/[id]/events
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  if (!session) return unauthorized();

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send keepalive every 30s
      const keepalive = setInterval(() => {
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 30_000);

      // Listen for group events (from a pub/sub or change stream)
      const listener = (event: GroupEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Subscribe to group events
      eventEmitter.on(`group:${params.id}`, listener);

      // Cleanup
      req.signal.addEventListener('abort', () => {
        clearInterval(keepalive);
        eventEmitter.off(`group:${params.id}`, listener);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

### Client SSE Hook

```typescript
function useGroupEvents(groupId: string) {
  useEffect(() => {
    const eventSource = new EventSource(`/api/groups/${groupId}/events`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      // Trigger SWR revalidation for relevant data
      mutate(`/api/groups/${groupId}/expenses`);
      mutate(`/api/groups/${groupId}/balances`);
    };

    return () => eventSource.close();
  }, [groupId]);
}
```

---

## Refresh Intervals Summary

| Data          | Interval | Trigger                     |
| ------------- | -------- | --------------------------- |
| Expenses      | 10s      | Polling + focus + reconnect |
| Balances tab  | 15s      | Polling + focus             |
| Activity      | 10s      | Polling + focus             |
| Group info    | 30s      | Polling + focus             |
| Groups list   | 30s      | Polling + focus             |
| User balances | 30s      | Polling + focus             |
| Invitations   | 30s      | Polling + focus             |

> **Polling drives writes.** `GET /api/groups/[id]`,
> `GET /api/groups/[id]/expenses` and `GET /api/groups/[id]/balances` all
> materialize due recurring expenses before responding. An open Household group
> page therefore issues a write-capable request every 10–30 seconds. Generation
> is idempotent, so this is safe, but it means these polls are not read-only.
> An archived Group generates nothing, and generation moves none of its markers,
> so a tab left open on an archived Household polls without adding Expenses.
