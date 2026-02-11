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

| Approach | Pros | Cons |
| -------- | ---- | ---- |
| Polling (SWR) | Simple, works everywhere, no server state | Slight delay, unnecessary requests |
| SSE | Real-time, server push | Needs connection management, more complex |
| WebSocket | Bi-directional, real-time | Most complex, overkill for this use case |

For v1, SWR's built-in polling (`refreshInterval`) is sufficient and simple.

---

## Implementation

### SWR Auto-Refresh

```typescript
// Expenses list — auto-refresh every 10 seconds when tab is focused
function useExpenses(groupId: string, filters: ExpenseFilters) {
  return useSWR(
    `/api/groups/${groupId}/expenses?${buildParams(filters)}`,
    fetcher,
    {
      refreshInterval: 10_000,        // Poll every 10s
      revalidateOnFocus: true,        // Refresh when tab gets focus
      revalidateOnReconnect: true,    // Refresh after network recovery
      dedupingInterval: 5_000,        // Dedupe requests within 5s
    }
  );
}

// Balances — auto-refresh every 15 seconds
function useBalances(groupId: string) {
  return useSWR(
    `/api/groups/${groupId}/balances`,
    fetcher,
    {
      refreshInterval: 15_000,
      revalidateOnFocus: true,
    }
  );
}

// Activity feed — auto-refresh every 10 seconds
function useActivity(groupId: string, page: number) {
  return useSWR(
    `/api/groups/${groupId}/activity?page=${page}`,
    fetcher,
    {
      refreshInterval: 10_000,
      revalidateOnFocus: true,
    }
  );
}
```

### Optimistic Updates

When the current user adds an expense, update the UI immediately before the server responds:

```typescript
async function addExpense(groupId: string, data: CreateExpenseInput) {
  // Optimistically add to SWR cache
  mutate(
    `/api/groups/${groupId}/expenses`,
    async (current) => {
      const response = await fetch(`/api/groups/${groupId}/expenses`, {
        method: "POST",
        body: JSON.stringify(data),
      });
      const result = await response.json();
      return {
        ...current,
        expenses: [result.data, ...(current?.expenses ?? [])],
      };
    },
    { optimisticData: (current) => ({
        ...current,
        expenses: [{ ...data, _id: "temp", createdAt: new Date() }, ...(current?.expenses ?? [])],
      }),
      rollbackOnError: true,
    }
  );
}
```

---

## New Data Notification

When polling detects new data that the user didn't create:

```
┌──────────────────────────────────────────┐
│ 🔔 Jane added a new expense             │
│ [View] [Dismiss]                         │
└──────────────────────────────────────────┘
```

### Detection Logic

```typescript
// Compare previous and new data
function detectNewItems(prev: Expense[], next: Expense[], currentUserId: string) {
  const prevIds = new Set(prev.map(e => e._id));
  const newItems = next.filter(e => !prevIds.has(e._id) && e.createdBy !== currentUserId);
  return newItems;
}
```

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
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 30_000);

      // Listen for group events (from a pub/sub or change stream)
      const listener = (event: GroupEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Subscribe to group events
      eventEmitter.on(`group:${params.id}`, listener);

      // Cleanup
      req.signal.addEventListener("abort", () => {
        clearInterval(keepalive);
        eventEmitter.off(`group:${params.id}`, listener);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
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

| Data        | Interval | Trigger                    |
| ----------- | -------- | -------------------------- |
| Expenses    | 10s      | Polling + focus + reconnect |
| Balances    | 15s      | Polling + focus             |
| Activity    | 10s      | Polling + focus             |
| Group info  | 30s      | Polling + focus             |
| Groups list | 30s      | Polling + focus             |

