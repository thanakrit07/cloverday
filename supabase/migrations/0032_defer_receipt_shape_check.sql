-- A receipt's date and instrument cannot currently be changed at all.
--
-- `transactions_enforce_receipt_shape` (0029, search_path pinned in 0030)
-- enforces that a receipt's transactions share one date and one instrument,
-- as a BEFORE row trigger. That works when a row joins a receipt, and makes
-- the shared fields immovable afterwards: editing one line's date leaves its
-- siblings on the old one, so the trigger raises. Editing them in the other
-- order raises too. Even a single statement covering the whole receipt --
-- `update transactions set date = ... where receipt_id = ...` -- fails, because
-- a row-level BEFORE trigger fires once per row and each firing still sees its
-- siblings' pre-update values.
--
-- So the only way to correct a mis-dated receipt today is to delete it and
-- enter it again. The rule is right; the moment it is checked is wrong.
--
-- Deferring the check to commit time fixes it: every row in the statement has
-- its final value by then, so a whole-receipt update is judged as the one
-- change it actually is. `trg_transaction_shares_check_sum` (0022) is deferred
-- for the same reason -- it judges a sum that is only correct once every row
-- of the change has landed -- and 0029's own comment notes that deferral is
-- what lets the split RPC clear and rewrite shares mid-transaction.
--
-- The rule itself is unchanged: same fields, same message, same refusal. Only
-- when it runs moves.

-- AFTER rather than BEFORE, so the return value is discarded; a constraint
-- trigger must not attempt to modify the row.
create or replace function transactions_enforce_receipt_shape()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sibling record;
begin
  if new.receipt_id is null then
    return null;
  end if;

  select date, from_account_id, from_card_id into v_sibling
  from transactions
  where receipt_id = new.receipt_id
    and id <> new.id
    and deleted_at is null
  limit 1;

  if not found then
    return null;
  end if;

  if v_sibling.date is distinct from new.date then
    raise exception 'A receipt''s transactions must share one date (% vs %)', v_sibling.date, new.date;
  end if;

  if v_sibling.from_account_id is distinct from new.from_account_id
     or v_sibling.from_card_id is distinct from new.from_card_id then
    raise exception 'A receipt''s transactions must share one instrument';
  end if;

  return null;
end;
$$;

drop trigger if exists trg_transactions_enforce_receipt_shape on transactions;

-- No `update of (...)` column list: a constraint trigger is cheap to enter and
-- leaves immediately when `receipt_id` is null, which is almost every row in
-- the table. Listing columns would save nothing worth the risk of missing one.
create constraint trigger trg_transactions_enforce_receipt_shape
after insert or update on transactions
deferrable initially deferred
for each row execute function transactions_enforce_receipt_shape();
