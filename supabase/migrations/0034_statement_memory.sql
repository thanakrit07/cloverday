-- ADR-0020: the app, not a script, reads statements, and remembers what the
-- household has told it. Three things: which files it has seen, who a name on
-- a transfer line is, and what a description usually is.

-- Which statement files have been uploaded. Metadata only: no PDF, no text, no
-- password. The hash catches the same file under a new name.
create table statement_files (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  -- Name as shown to the household, with long digit runs already removed by the
  -- app (some banks put the full card number in the file name); the check below
  -- is the backstop if a path ever stops doing that.
  file_name     text not null check (length(file_name) <= 200 and file_name !~ '[0-9]{12}'),
  sha256        text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  period_start  date,
  period_end    date,
  account_id    uuid references accounts(id) on delete set null,
  card_id       uuid references cards(id) on delete set null,
  row_count     integer not null check (row_count >= 0),
  uploaded_by   uuid references household_members(id),
  uploaded_at   timestamptz not null default now(),
  unique (household_id, sha256),
  constraint one_instrument check (num_nonnulls(account_id, card_id) <= 1),
  constraint period_ordered check (period_start is null or period_end is null or period_start <= period_end)
);

alter table statement_files enable row level security;
create policy member_all on statement_files
  for all using (household_id = current_household_id())
  with check (household_id = current_household_id());

-- Who a name on a transfer line is. `name_key` is the line's counterparty text,
-- lower-cased with whitespace collapsed -- the same normalisation the app uses
-- (see normalizeStatementText in src/lib/statementImport.ts) and the view below.
create table counterparties (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  name_key      text not null check (length(name_key) between 1 and 300),
  role          text not null check (role in ('own_account', 'member', 'merchant')),
  account_id    uuid references accounts(id) on delete cascade,
  card_id       uuid references cards(id) on delete cascade,
  member_id     uuid references household_members(id) on delete cascade,
  category_id   uuid references categories(id) on delete cascade,
  created_by    uuid references household_members(id),
  created_at    timestamptz not null default now(),
  unique (household_id, name_key),
  -- Exactly the target the role names, and nothing else.
  constraint role_matches_target check (
    case role
      when 'own_account' then num_nonnulls(account_id, card_id) = 1 and member_id is null and category_id is null
      when 'member'      then member_id is not null and num_nonnulls(account_id, card_id, category_id) = 0
      when 'merchant'    then category_id is not null and num_nonnulls(account_id, card_id, member_id) = 0
    end
  )
);

alter table counterparties enable row level security;
create policy member_all on counterparties
  for all using (household_id = current_household_id())
  with check (household_id = current_household_id());

-- What a description usually is. Grouped here, not in the client, because the
-- API returns at most 1,000 rows a request and a count over a truncated list
-- would be wrong without saying so. Only rows that came from a statement line
-- (source_key = stmt:...) count, so a category that was only ever a guess, or
-- text the household typed into a hand-entered row, never teaches anything.
create or replace view v_category_hints with (security_invoker = true) as
  select
    household_id,
    lower(regexp_replace(btrim(description), '\s+', ' ', 'g')) as text_key,
    category_id,
    count(*) as uses
  from transactions
  where deleted_at is null
    and source = 'import'
    and source_key like 'stmt:%'
    and description <> ''
    and category_id is not null
  group by household_id, text_key, category_id;
