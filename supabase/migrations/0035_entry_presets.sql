-- D27 / ADR-0021: a Preset is a person's own one-tap fill for the entry form --
-- a category, and optionally a note, an instrument and an amount. It fills the
-- form; it never records anything itself. Who bears and transfers are left out
-- on purpose (D13: a split is decided per transaction, not stamped by a chip).

create table entry_presets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references households(id) on delete cascade,
  -- Per person: a preset names a card, and one person's card is the wrong
  -- default for the other. RLS stays household-wide like every other table;
  -- the app shows each member only their own.
  member_id     uuid not null references household_members(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 40),
  kind          category_kind not null,
  category_id   uuid not null,
  note          text,
  account_id    uuid references accounts(id) on delete set null,
  card_id       uuid references cards(id) on delete set null,
  amount        numeric(14,2) check (amount > 0),
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  constraint one_instrument check (num_nonnulls(account_id, card_id) <= 1),
  -- Composite, like transactions': a preset can't name an income category
  -- under an expense kind. Cascade so a preset never blocks deleting an
  -- unused category (useDeleteCategory relies on FK refusals meaning "in use").
  foreign key (category_id, kind) references categories(id, kind) on delete cascade
);

create index entry_presets_member on entry_presets (member_id, sort_order);

alter table entry_presets enable row level security;
create policy member_all on entry_presets
  for all using (household_id = current_household_id())
  with check (household_id = current_household_id());
