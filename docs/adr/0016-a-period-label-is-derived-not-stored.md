# An Installment Period's label is derived, not stored

A posted period's ledger label — `<plan name> (งวดที่ n/total)` — is composed
when the row is rendered, from the plan it belongs to and the `source_key` the
row already carries. It is not written into `transactions.note`, and no
transaction is rewritten when a plan is renamed.

## Context

The materialiser wrote the label into `note`, which is also the free-text field
the user types into. One column held two authors' text with nothing to
distinguish them, and that single fact produced every difficulty that followed:

- Renaming a plan left its posted periods quoting the old name, because the
  name had been copied rather than referenced.
- Fixing that meant propagating the rename, which meant deciding which notes
  were the app's to overwrite — a question answerable only by pattern-matching
  prose.
- The first guard compared each note against the name the plan was being
  renamed *from*. A plan already out of sync carries a name it no longer holds,
  so nothing matched, and the two plans in the household that most needed the
  repair were the two it could never reach.

Each fix was sound given the one before it. The stored label was the mistake
underneath all of them.

## Decision

Derive it. `source = 'installment'` and `source_key = installment:<id>:<n>`
already identify the period exactly; `installments` already holds the name and
the count. Composing the label from those at render time makes a rename visible
everywhere on the next render, with no write, no propagation and no guard.

`note` returns to holding only what the user wrote. In the entry form the
period appears as a **read-only row** above it, so the label is stated as a fact
about the charge rather than offered as editable text — editing it there would
mean editing one period's copy of a name every other period also carries.

## Considered Options

- **Keep the label in `note` and improve the matcher.** Shipped, and it works
  for the cases it can see. But it is a heuristic standing in for a fact the
  schema could simply hold, and every future format change re-opens the same
  question of which prose the app owns.
- **A second column for the generated label.** Removes the ambiguity but keeps
  the copy: a rename still has to find and rewrite N rows, and a half-finished
  propagation still leaves the ledger disagreeing with itself.
- **Lock part of the Note field in the UI.** A text input cannot lock a
  substring without `contenteditable` and hand-managed selection, which is
  fragile under a Thai IME on a phone — and it would not have changed what the
  database stores, which is where the problem lived.

## Consequences

The plan lookup reads the **base `installments` table, not `v_installments`**,
which filters `deleted_at`. D15 leaves a plan's settled periods in the ledger
when the plan is deleted; labelling from the view would blank the name on
exactly those rows, so history would lose its description because the plan
explaining it had been tidied away.

Search has to search the composed label, not the column — `note` no longer
contains the plan's name, so a household searching "Notebook" would otherwise
find nothing.

A one-time migration (0031) clears the labels already written. Nothing is lost:
a cleared note is exactly reproducible from the plan and the row's own
`source_key`, which is the same property that makes deriving it correct.

**D15 is whole again.** The v4.3 amendment carved the name out of "plans are
immutable" so it could be propagated; with nothing propagating, the carve-out
is withdrawn and the outcome it wanted is kept.
