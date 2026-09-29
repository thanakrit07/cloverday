# Statements import by line identity, and matches are confirmed, not guessed

[ADR-0014](./0014-bulk-import-is-in-app-insert-only-and-has-no-heuristics.md)
designed import for one event: moving the old sheet into an empty household.
Its key is the CSV row number, and a second run fails on purpose.

Bank and card statements are a different job. They arrive every month, their
periods overlap, and the household also jots spending by hand between
statements to know where it stands now. Importing them through a Python script
(psql, `source = 'import'`, no `source_key`) produced duplicates three ways:
the staged CSV was cumulative, so every run re-sent every earlier month; one
transfer between the household's own accounts appeared on both the bank's and
the card's statement; and card installment periods the app already posts
(D11) arrived again from the statement. A fuzzy "same amount within three days"
filter was bolted on to hide that — the silent guess ADR-0014 exists to forbid.

## What changes

**A statement line has an identity.** `source_key =
stmt:<instrument>:<purchase date>:<amount>:<hash of description>:<n>`, `n`
separating identical lines on the same day. Insert is `ON CONFLICT DO NOTHING`
on the existing `(household_id, source_key)` index, so uploading the same file
again, or two statements whose periods overlap, adds nothing. There is no
record of which file was imported; the keys already in the database are it.

**Import is a review screen in the app.** The unmasked CSV is read in the
browser and written only on Apply — no database password on disk, no Google
Sheet. Rows sit in three tabs: *needs review* (a suggested match with a
hand-entered row, an installment line with no plan, a row categorised "Other",
an error), *new* (with "accept all"), and *already imported*. Rows can be
multi-selected to accept, skip, or set a category.

**A match with a hand-entered row is suggested, never applied.** Same
instrument, same amount, purchase dates within three days: the screen proposes
the pair and the household confirms it. Confirming keeps the hand-entered row —
its category, note and shares are the household's — stamps it with the line's
`source_key`, and takes the statement's amount, date and `posted_date`. The
suggestion is a heuristic; applying one without a person's say-so is what
ADR-0014 rules out, and that still holds.

**Rules the staging step follows, not guesses the app makes:**
- A transfer between own accounts is recorded from the paying side's (bank)
  statement; the card statement's "payment received" line is skipped. Where no
  bank statement covers that period, the card side is kept.
- An installment or IPP-interest line whose plan exists in the app is skipped;
  the plan's periods already include interest. A line with no plan is flagged
  "create the plan first" and not imported.
- A refund is income in the "Refund" category, never a negative expense.

**A card row carries its posting date.** `transactions.posted_date` (nullable)
holds what the statement says the bank posted; `date` stays the purchase date
everywhere it's shown. The billing cycle follows `posted_date ?? date` (§6.1),
so a purchase on statement day that posts next day lands on the bill it
actually appears on. Hand-entered rows have none until a statement confirms
them; the entry form doesn't ask, because nobody knows it at the time.

## Consequences

The 1,171 rows the script imported carry no key and used posting dates, so
they can't be matched. They are soft-deleted once and every statement is
re-imported through the screen; each account is then reconciled (ADR-0013).
Periods with no statement in hand stay empty until one is found.

`scripts/import_csv_to_db.py`, `scripts/reconcile_statement.py` and the
`statements:check` / `statements:import` npm scripts are retired. Masking and
unmasking stay local scripts; the privacy rules around them are unchanged.

## Considered options

**Keep the script, add a fuzzy dedupe.** Fastest, and wrong in both
directions: two genuine coffees at the same price are one row, and a charge
posted three days late is two.

**Review the CSV in a spreadsheet, import with the script.** A spreadsheet
can't see what's already in the database, so it can't show a match with a
hand-entered row, and Google Sheets would hold unmasked financial data.
