# A Receipt is a screen you look at

A Receipt has its own screen: the name, the date, what paid for it, and its
lines underneath — read the way the slip in your hand reads. It is where a
receipt is created from a photograph, where an existing transaction is divided,
and where a receipt is corrected afterwards.

## Context

[ADR-0015](./0015-a-receipt-groups-transactions-and-holds-no-money.md) settled
what a Receipt *is*. It said nothing about where you look at one, and the answer
turned out to be nowhere. The ledger row expanded to show its lines and a line
tapped open as an ordinary transaction, so a receipt could be glimpsed but never
opened; splitting happened in a dialog that closed and was gone.

Two things pushed against that. Bill scanning (ADR-0017) routed a photograph
through the entry form and then a split dialog — two screens for one payment,
with nothing on the first to say a second was coming. The household photographed
a slip, saw a correct total and no categories, and could not tell whether the
reading had been lost. (It had, in fact, but for an unrelated reason: the entry
form closed itself in the same tick it announced the new row, unmounting the
flow before the split it had asked for could load. The split screen never
appeared at all.)

And a receipt's shared fields could not be corrected. `transactions_enforce_
receipt_shape` (0029) requires a receipt's rows to share one date and one
instrument, as a BEFORE row trigger — so editing one line left its siblings on
the old value and raised, in either order, and even a single statement covering
the whole receipt failed. A mis-dated receipt could only be deleted and redone.
Nothing in the app could express "this receipt is one thing" because the schema
would not accept an edit to it.

## Decision

**One screen for a receipt, three ways in.** From a scan, from an existing
transaction being split, and from the ledger. It replaces `SplitReceiptDialog`,
which is deleted: two editors for one object would mean two implementations of
the remainder rule, and the day they disagreed would be the day a split stopped
adding up.

**The total is shown, not typed, once the receipt exists.** A Receipt holds no
money (D22), so its total is the sum of its lines and has nowhere else to come
from. A field here would teach the household that a receipt carries a figure,
and the next request would be to store it — which is the parent-row shape
ADR-0015 rejected for reviving a double-count bug the project has shipped twice.
While a receipt is being *created* the amount is a field, because there it is
not the receipt's total at all: it is what the card was charged, it is known
before the lines are, and the lines must reconcile to it.

**The shared fields are edited for the whole receipt at once**, which needed
migration 0032 to defer the shape check to commit. The rule is unchanged; only
the moment it is judged moved.

**Who bears is asked once, for the payment**, and every line inherits it in
proportion. A line borne differently — ADR-0015's halved saucepan among unhalved
snacks — is corrected on that line, where its Split has always lived.

**In the ledger the row gets two targets**: the name opens the receipt, the
chevron still expands it in place. Peeking and editing are different jobs, and
the Categories screen already teaches this gesture (DESIGN §7).

## What this does to ADR-0015

"Splitting is an edit, not an entry mode" stops being literally true: a scanned
bill now becomes a receipt in one press, without the household first recording a
transaction. **Both of that rule's stated reasons survive intact**, which is why
this amends rather than overturns it:

- *the three foreign keys pointing at `transactions.id` never move* — a
  transaction is still created first and then stamped. `split_transaction_into_
  receipt` is called unchanged; it is simply called in the same press.
- *entry stays inside D9's tap budget* — the entry form is not touched. Nothing
  was added to it, and the ฿65 coffee still costs five taps. An inline "add a
  line" button on that form was considered and rejected for exactly this reason.

## Considered Options

**Relabel the Save button and keep two screens.** The cheapest fix for the
complaint as first reported ("I didn't know a second screen was coming"), and it
leaves a receipt with nowhere to be looked at and its date still uncorrectable.

**An "add a line" button on the entry form.** Turns the ordinary form into the
receipt editor, spending screen space on every coffee for a case that is rare —
the tradeoff D17 already made in the other direction.

**Let the total be typed in edit mode too, flowing into a remainder line.**
Uniform across both modes and a smaller component. Rejected: it puts a number on
the receipt, and the difference between "a receipt has a total" and "a receipt's
lines have a sum" is the whole of D22.

## Consequences

Two save paths in one component — create writes a transaction and splits it,
edit updates rows in place and rescales each changed line's shares to keep
`transaction_shares`' sum check satisfied. That is real complexity, held in one
file rather than spread across two that must agree.

The screen cannot look purely like a receipt: it carries a "paid with" row and,
while creating, a "who bears" row, neither of which is printed on any slip.

A scan that finds only one category still goes to the ordinary entry form. One
category is not a receipt; it is a payment that happened to be photographed.
