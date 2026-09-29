---
name: local-supabase
description: "Use when the user wants to test a wealth-prof feature against local/mock data before touching production Supabase -- e.g. \"test this locally first\", \"spin up local db\", \"try this with mock data\", or when about to write a new migration that should be verified before applying to prod."
---

# Local Supabase stack for wealth-prof

Runs the full Supabase stack (Postgres + Auth + REST) on this machine via
Docker, isolated from production. `.env.local` always points at prod --
never edit it for this. A separate `.env.development.local` overrides it
only for `npm run dev` (Vite loads both; the `.development.local` one wins).

## Prerequisites (one-time, already done on this machine)

- Colima + docker CLI: `brew install colima docker`
- Supabase CLI: **do not `brew install supabase`** -- this machine's Xcode
  Command Line Tools are too outdated for the brew formula's postinstall
  step. Use `npx -y supabase <command>` for every CLI call instead; it works
  with no CLT dependency.

## Every time: bring the stack up

```bash
colima start                 # skip if `colima status` already shows running
npx -y supabase start        # first run pulls images (~2GB); later runs are fast
```

`supabase start` prints `API_URL`, `ANON_KEY`, etc. Re-fetch anytime with:

```bash
npx -y supabase status -o env
```

If `.env.development.local` doesn't exist yet, create it (gitignored, `.env*` is in `.gitignore`):

```
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_ANON_KEY="<ANON_KEY from status>"
```

Then `npm run dev` picks up local data automatically. Login as one of the
seeded users below.

## Applying a new migration / feature to local before prod

1. Write the migration by hand as `supabase/migrations/NNNN_<name>.sql`,
   numbered one past the highest existing file. This repo numbers
   migrations sequentially, so don't use `supabase migration new` (it
   writes timestamp names), despite what the `supabase` skill says.
2. `npx -y supabase db reset` -- drops the local DB, reapplies **every**
   migration in order, then runs `supabase/seed.sql`. This is the fast,
   safe way to test a new migration from scratch, repeatedly.
3. Add mock rows for the new feature to `supabase/seed.sql` (see existing
   entries for the pattern: fixed UUIDs so rows can reference each other).
   Re-run `npx -y supabase db reset` to pick them up.
4. Sanity-check the schema directly before touching the UI:
   ```bash
   PGPASSWORD=postgres psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "select ..."
   ```
5. Only after it looks right locally, apply the migration to production
   (via `mcp__supabase__apply_migration` or the normal deploy path) -- ask
   the user first, this is the one step that touches shared infrastructure.

## Seeded login (supabase/seed.sql)

- `earth@example.com` / `password123` -- member "เอิร์ธ"
- `ploy@example.com` / `password123` -- member "พลอย"

Both already belong to the same seeded household -- the app should go
straight past the "create household" screen for either login.

## Known gotchas on this machine (arm64 Mac)

- **`[realtime]` and `[studio]` are disabled** in `supabase/config.toml`.
  Both published images (`realtime:v2.120.3`, `studio:2026.07.27-sha-cbb076d`)
  are broken on arm64 upstream (confirmed by re-pulling: same digest, same
  crash both times -- not something a re-pull or cache-clear fixes). Neither
  is needed to test the app (it talks to Postgres/Auth/REST directly).
  `edge_runtime` is disabled too (segfaults; the app has no edge functions
  anyway). Re-enable any of the three only after checking upstream shipped
  a fixed tag.
- **`api.auto_expose_new_tables = true` is required.** Supabase Cloud
  auto-grants table access to `anon`/`authenticated` when a project is
  provisioned -- that's project-level setup, not captured in any migration,
  so a fresh local Postgres doesn't have it and every table 403s with
  `permission denied` until this is set. It's already set in
  `supabase/config.toml`. **This flag only takes effect on a fresh DB
  init** -- if a table ever 403s locally after editing config, run
  `npx -y supabase db reset` (not just `stop`/`start`) to pick it up.
  The flag is deprecated (removal slated 2026-10-30); if it stops working
  after a CLI upgrade, add explicit
  `grant select, insert, update, delete on <table> to authenticated;`
  to the table's own migration instead.
- If disk space runs low, Docker image pulls fail with `ENOSPC` or produce
  silently-truncated layers (looks like a random unrelated crash inside a
  container). Check `df -h /` first if a container misbehaves after a
  fresh pull.

## Shutting down

```bash
npx -y supabase stop   # stops containers, keeps the DB volume (data persists)
colima stop            # frees the VM's CPU/RAM entirely
```

`npx -y supabase stop --no-backup` also discards the DB volume, if you want a
truly clean slate next time instead of `db reset`.
