# Fork notes: public trips

This fork adds **public trips with join requests** on top of upstream TREK. This page is
what to know when moving a database from the 3.4-based fork to a build of this branch.

## What the fork adds

- An owner can publish a trip. Any signed-in user then sees it on their dashboard as a
  read-only "Public trip" and can open the itinerary (days, places, bookings, stays) with
  notes, booking codes, traveller names and links removed.
- A visitor can ask to join, and take the request back while it is pending. The owner is
  notified (Accept / Reject buttons) or decides in the members dialog. The requester is told
  the outcome either way.
- Budget, packing, to-dos, files, chat, members, the offline bundle and the calendar export
  stay members-only.

Where it lives: `server/src/nest/trip-public/` (module), `@ViewerReadable()` in
`permissions/trip-access.guard.ts`, `TripsService.listWithPublic` / `getWithPublic`, and
`DatabaseService.canViewPublicTrip`. `canAccessTrip`, `TripsService.list` and `.get` are
deliberately **unchanged**: the MCP tools and the plugin RPC call them, and they must keep
meaning "trips this principal belongs to".

## Upgrading an existing fork database  (important)

Migrations are a positional, append-only array; the stored `schema_version` is an index
into it. The 3.4-based fork added its two tables at positions 176 and 177, which in upstream
are *different* migrations. A fork database therefore reads `schema_version = 177`, and
upstream's own migrations #176 and #177 would be **skipped without any error** — they
rebuild `vacay_shares` and add `vacay_entries.fraction`, so the Vacay addon would break
later.

Before the first start of a build of this branch on a database that ran the fork:

```sql
-- check first: this applies only if it prints 177
SELECT version FROM schema_version;
UPDATE schema_version SET version = 175;
```

(`sqlite3 /app/data/travel.db`, with the container stopped; take a backup first.)

That makes the server run upstream #176–#244 and then this fork's two steps (#245, #246).
The fork's steps are `CREATE TABLE IF NOT EXISTS`, so the existing public flags and join
requests are kept. This was checked by building a database with the fork's own code at
version 177, upgrading copies with and without the reset, and comparing each against a
fresh install: with the reset the schema is identical and the data survives; without it,
`vacay_shares` and `vacay_entries.fraction` are missing.

A database that never ran the fork (a fresh one, or plain upstream) needs nothing.

## Translations

`trips.public.*`, `trips.joinRequests.*`, `notif.trip_join_*` and the three
`settings.notifyTripJoin*` labels are translated in `pl`; the other locales carry the
English text so the parity gate (`npm run i18n:parity:strict --workspace=shared`) passes.

## Keeping up with upstream

`.forgejo/workflows/build.yml` rebases this branch onto `origin/main` before every build and
stops if that conflicts. The patch is kept small and mostly in new files; the places that can
conflict are `trips.service.ts`, `trips.controller.ts`, `trip-access.guard.ts`,
`database.service.ts`, `useDashboard.ts`, `DashboardPage.tsx` and the migrations array
(append the fork's steps last, again).
