-- A card statement lists two dates per line: when the purchase happened and
-- when the bank posted it, usually a day or two later. `date` stays the
-- purchase date -- what the household jots, what every screen shows. The
-- billing cycle a card row belongs to follows the posting date, though: a
-- purchase on statement day that posts the next day is on the *next* bill.
-- So the posting date is stored alongside, filled from the statement when a
-- line is imported or confirmed against a hand-entered row, and the cycle
-- engine reads it when present (ADR-0019). Null for anything no statement has
-- vouched for yet.
alter table transactions add column posted_date date;

create or replace view v_transactions with (security_invoker = true) as
  select
    id, household_id, date, kind, category_id, category_kind, description,
    amount, owner_id, from_account_id, from_card_id, to_account_id, to_card_id,
    note, source, recurring_rule_id, occurrence_date, confirmed, created_by,
    created_at, updated_at, updated_by, deleted_at, source_key, receipt_id,
    posted_date
  from transactions
  where deleted_at is null;
