# SplitWise Clone — Master Plan

## Overview

A full-featured expense-splitting application built with Next.js (App Router), React, Material UI, MongoDB (Mongoose), and Auth.js. Supports Google login, real-time sync, multi-currency, smart debt simplification, and rich expense management.

---

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Framework   | Next.js 16 (App Router, Turbopack)  |
| Language    | TypeScript 5                        |
| UI          | React 19 + Material UI v7 (Emotion) |
| Auth        | Auth.js v5 (Google OAuth)           |
| Database    | MongoDB (Atlas or local)            |
| ODM         | Mongoose v9                         |
| Validation  | Zod v4                              |
| Data Fetch  | SWR v2                              |
| Real-time   | SWR polling (refreshInterval)       |
| Package Mgr | pnpm                                |

---

## Documentation Index

### Core Architecture

| Doc                                  | Description                              |
| ------------------------------------ | ---------------------------------------- |
| [architecture.md](./architecture.md) | Folder structure, data flow, conventions |
| [database.md](./database.md)         | MongoDB schemas and relationships        |
| [api.md](./api.md)                   | All REST API endpoints                   |
| [auth.md](./auth.md)                 | Auth.js: demo personas + Google OAuth    |
| [testing.md](./testing.md)           | Unit / integration / browser test layers |
| [ui.md](./ui.md)                     | Design system, theme, components         |

> **Private-beta status (feat/private-beta):** demo persona auth (Alex, Sam,
> Priya) with an idempotent seeded Goa trip is the active entry path; Google
> OAuth stays dormant behind `AUTH_MODE` until Phase 7. Each trip uses a
> single currency; dashboard balances aggregate in separate currency buckets.
> Receipts, email delivery, FX conversion, and realtime sync are deferred —
> see [features/realtime.md](./features/realtime.md) and
> [features/receipts.md](./features/receipts.md) for their future scope.

### Feature Specs

| Doc                                                      | Description                           |
| -------------------------------------------------------- | ------------------------------------- |
| [features/groups.md](./features/groups.md)               | Create, manage, archive groups        |
| [features/invitations.md](./features/invitations.md)     | Email invites + invite link           |
| [features/expenses.md](./features/expenses.md)           | Add expense, split methods, tags      |
| [features/settlements.md](./features/settlements.md)     | Settle up + smart debt simplification |
| [features/balances.md](./features/balances.md)           | Group balance summary, who owes whom  |
| [features/activity-feed.md](./features/activity-feed.md) | Group activity timeline               |
| [features/dashboard.md](./features/dashboard.md)         | Expense dashboard + filters           |
| [features/currency.md](./features/currency.md)           | Multi-currency support                |
| [features/receipts.md](./features/receipts.md)           | Receipt image upload                  |
| [features/realtime.md](./features/realtime.md)           | Real-time sync across clients         |

### Page Specs

| Doc                                              | Description            |
| ------------------------------------------------ | ---------------------- |
| [pages/landing.md](./pages/landing.md)           | Public landing page    |
| [pages/login.md](./pages/login.md)               | Login page             |
| [pages/dashboard.md](./pages/dashboard.md)       | Main dashboard         |
| [pages/group-detail.md](./pages/group-detail.md) | Group detail page      |
| [pages/add-expense.md](./pages/add-expense.md)   | Add/edit expense modal |
| [pages/settings.md](./pages/settings.md)         | User settings          |

---

## Feature Scope (v1)

### Core (User's original 9)

1. ✅ User can create group
2. ✅ Invite people to group
3. ✅ Add expense
4. ✅ Predefined items + tagging for expense
5. ✅ Login flow (Google OAuth)
6. ✅ Automatically sync updates in a group
7. ✅ Default currency + 2 alternate currencies per group
8. ✅ Expense dashboard with filters (date range, tag, regex search)
9. ✅ Quick expense filters (previous week, this week, etc.)

### MVP+ Additions

10. ✅ Settle up / Record payment
11. ✅ Smart debt simplification (minimize transactions)
12. ✅ Multiple split methods (equal, unequal, percentage, shares, exact)
13. ✅ Group balance summary (who owes whom)
14. ✅ Group activity feed / timeline
15. ✅ Invite via shareable link
16. ✅ Receipt attachment per expense

---

## Build Order

### Phase 1 — Foundation

1. Project setup (Next.js + MUI) ← DONE
2. Auth.js + Google OAuth + MongoDB connection
3. Database models (User, Group, Expense, Settlement, Activity, Invitation)
4. Auth middleware + protected routes

### Phase 2 — Core Features

5. Group CRUD APIs + UI
6. Invitation system (email + link)
7. Expense CRUD APIs + UI (with split methods)
8. Currency configuration per group

### Phase 3 — Advanced Features

9. Balance calculation engine
10. Smart debt simplification algorithm
11. Settlement recording
12. Activity feed
13. Receipt upload

### Phase 4 — Dashboard & Polish

14. Expense dashboard with filters
15. Quick filters (this week, last week, etc.)
16. Real-time sync (SSE)
17. Responsive design + UX polish

---

## Conventions

- **API routes**: `/api/groups/[id]/expenses` — RESTful, nested under group
- **Services**: Business logic lives in `src/lib/services/`, not in route handlers
- **Models**: Mongoose models in `src/lib/models/`
- **Validation**: Zod schemas for request validation
- **Error handling**: Consistent JSON error responses `{ error: string, status: number }`
- **Auth guard**: All API routes (except auth) require authenticated session
- **Dates**: Always store as UTC, display in user's timezone
- **Soft deletes**: Expenses use `isDeleted` flag, never hard delete
