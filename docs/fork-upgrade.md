# Fork notes: public trips

This fork adds **public trips with join requests** on top of upstream TREK. This page is
what to know when moving a database from an earlier build of the fork to a build of this
branch (upstream 5.0.0), and what to expect when rebasing onto newer upstream.

## What the fork adds

- An owner can publish a trip. Any signed-in user then sees it on their dashboard as a
  read-only "Public trip" and can open the itinerary (days, places, bookings, stays) with
  notes, booking codes, traveller names, ratings and links removed.
- A visitor can ask to join, and take the request back while it is pending. The owner is
  notified (Accept / Reject buttons) or decides in the trip's Settings dialog. The requester
  is told the outcome either way.
- Budget, packing, to-dos, files, chat, members, the offline bundle and the calendar export
  stay members-only.

Where it lives:

| Piece | Place |
|---|---|
| Tables | `db/migrations/Migration20200101900100_public_trips_with_join_requests.ts`, entities and repositories `TripPublicVisibility`, `TripJoinRequests` |
| Join-request lifecycle, routes | `server/src/nest/trip-public/` |
| Who may read a public trip | `@ViewerReadable()` and the visitor branch in `permissions/trip-access.guard.ts`, `permissions/public-trip-access.service.ts` |
| Redaction of what a visitor reads | `nest/common/viewer-redaction.ts`, called by the days, places, reservations and accommodations list handlers |
| Dashboard / planner payload | `TripPublicVisibilityRepository.listTrips` / `findTrip`, served by `TripsController` through `TripPublicService` |
| Client | `components/Trips/usePublicTrip.ts` and `TripPublicSections.tsx` (owner), `pages/tripPlanner/useTripJoinRequest.ts` and `TripPlannerNavbar.tsx` (visitor), `repo/tripPublicRepo.ts` |

`TripAccessService`, `TripsService.list` / `.get` and everything the MCP tools and the plugin
RPC call are deliberately **unchanged**: they must keep meaning "trips this principal belongs
to". Visitors are admitted only by `TripAccessGuard`, only for GET handlers carrying
`@ViewerReadable()`; every other route answers 403 "Read-only access".

## Upgrading an existing fork database  (important)

Upstream 5.0 retired the positional migration list. A database still carrying a
`schema_version` row is adopted by `db/legacy-baseline.ts`: the migrations for steps
`1..schema_version` are recorded as done, everything after runs. The fork's tables are **not**
a numbered step, so the fork migration always runs; it is `CREATE TABLE IF NOT EXISTS`, which
is why existing public flags and join requests survive.

The fork's earlier builds appended their tables to upstream's numbered list, so their
`schema_version` counts them (246 on the 4.3.3 build, 177 on the 3.4 one) and upstream's own
steps of those numbers (Web Push, a trigger fix, and others) would be recorded as done without
running. `db/fork-legacy-fixup.ts` therefore reads such a database as upstream's last step
(**244**, or **175**) before the baseline looks at it. It acts only on a database that has
the fork's `trip_join_requests` table, is still managed by the old runner (no migrator rows
yet) and sits at exactly 246 or 177, so plain upstream installs and anything already migrated
are untouched, and it does nothing after the first start. It also runs when a backup from a
fork build is restored. No manual step is needed.

`tests/integration/fork-upgrade-v244.test.ts` boots the v4.3.3 fixture plus the fork's tables
and rows, at 246, on this release: the schema ends identical to a fresh install and the
published trip and the pending request survive. `tests/unit/db/fork-legacy-fixup.test.ts`
covers the 177 case and the cases it must leave alone. The 177 path was not run against a
full 5.0 boot.

From here on the fork's tables are an ordinary named migration, so later upstream releases
need nothing of the kind.

The server copies the database next to itself before it migrates a file that holds anything
(`pre-migrate-<schema>-<time>.db`), so the first boot is recoverable.

## Translations

Every non-`en` locale carries a real translation of the fork's strings:
`trips.public.*`, `trips.joinRequests.*`, `notif.trip_join_*`, `notif.action.reject`, the
three `settings.notifyTripJoin*` labels and the three `trip_join_*` external notifications.
Added by hand, so a native speaker's correction is welcome.

## Keeping up with upstream

`.forgejo/workflows/build.yml` rebases this branch onto `origin/main` before every build and
stops if that conflicts. `sync.yml` fast-forwards `main` every eight hours and dispatches the
build when upstream moved. The dispatch needs `Content-Type: application/json`; without it
Forgejo answers `ref is empty` and nothing is built, and the step now fails loudly on a
rejected dispatch.

The patch is mostly new files. Upstream files it touches, which are where a rebase can
conflict:

- server: `app.module.ts` (one import, one list entry), `permissions/trip-access.guard.ts`,
  `permissions/permissions.module.ts`, `db/orm.ts` (one call), the days / places / reservations / accommodations
  controllers (the list handler only), `trips/trips.controller.ts` and `trips.module.ts`,
  `db/repositories/Trips.repository.ts` (one word: `tripSelectQuery` is no longer private),
  `notifications/*` (three events, `registerAction`), `plugins/protocol/manifest-rules.ts`
  and its generated copy;
- client: `Navbar.tsx`, `TripShareDialog.tsx`, `MTripSettingsSheet.tsx`, `MMehrSheet.tsx`,
  `DashboardPage.tsx`, `MDashboard.tsx`, `useDashboard.ts`, `TripPlannerPage.tsx`,
  `useTripPlanner.ts`, `permissionsStore.ts`, `tripStore.ts`, `tripSyncManager.ts`.

After resolving, regenerate rather than hand-edit: `npm run gen:entities` / `gen:db-types`
(server) if the fork's tables change, `npm run gen:plugin-facts` if the notification event
list moves, and re-run `lint:boundaries`, `lint:size`, `lint:response-contracts` and the
i18n parity gate. Three upstream ratchet files carry one entry for the fork:
`server/scripts/repository-owners.json`, `server/scripts/test-mocks-baseline.json` and the
`src/nest/trip-public` coverage line in `server/vitest.config.ts`.
