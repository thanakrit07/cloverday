# A scanned bill proposes a Receipt; it does not record one

Photographing a till slip fills in the Receipt form. It does not write to the
ledger. Every figure the model reads lands in the editable preview the household
already confirms before Apply, and nothing reaches `transactions` until they
press it.

## Context

D22 gave one payment several Categories, and ADR-0015 made splitting an **edit**:
a Transaction is recorded normally, then converted by stamping `receipt_id` on
the row that already exists. Entering the split is still typing — a Makro basket
is three or four amounts read off a slip and retyped into the phone that is
already pointed at it.

The obvious objection is [ADR-0014](./0014-bulk-import-is-in-app-insert-only-and-has-no-heuristics.md),
which deleted every guess from the bulk import: an unmatched category silently
became "Other", a percentage was classified by magnitude, a subscription was
guessed from a list of service names. A model reading a photograph guesses by
definition.

**It does not conflict, and the reason matters.** What ADR-0014 rejected was a
guess *nobody sees* — "a wrong guess is invisible until its effect shows up
somewhere else in the app, while a row that fails to map is visible immediately".
What it chose instead was a screen: "the preview can be edited", "the household
is watching its own data go in, not reading about it after the fact". A scan
whose output lands in that same preview is the shape ADR-0014 picked, applied to
a photograph instead of a CSV. The rule it sets is not "never infer" — it is
**never write an inference the household has not seen**.

## Decision

**The scan proposes; the household confirms; the existing code writes.**

**It groups by Category, not by line item.** A Makro slip has thirty lines; a
Receipt answers how many Categories one payment covered, which is three or four.
Returning thirty rows for the household to bucket by hand is slower than typing
the four they wanted. The model returns subtotals per Category, with the item
names it grouped shown as evidence.

**It only ever names Categories the household already has.** The model is given
the tree and constrained to it; an item it cannot place becomes an explicitly
empty line the user must fill, never "Other" — the exact substitution ADR-0014
deleted.

**The charge is authoritative, not the slip.** `split_transaction_into_receipt`
raises unless the lines sum exactly to the transaction's amount, and OCR against
discounts, VAT and rounding will not always reconcile. The amount that was
actually charged wins, and any gap is shown as a gap for the household to close.
Auto-balancing it into the nearest line would be a silent guess about money —
the one thing ADR-0014 is unambiguous about.

**It writes through the path that already exists.** Scanning fills the ordinary
Transaction form, which saves an ordinary Transaction, which the existing Split
dialog converts by calling `split_transaction_into_receipt` unchanged. Splitting
stays an edit (ADR-0015), the three foreign keys pointing at `transactions.id`
never move, and **no migration is required** — the feature adds no column, no
table and no RPC.

**The cheapest capable model first.** `claude-haiku-4-5`, chosen deliberately
over the stronger Opus tier: reading a till slip is extraction, not reasoning,
and the accuracy question is empirical — if it reads Thai receipts well enough,
the tier above costs roughly eight times as much for nothing. If it does not,
moving up is a one-line change (`claude-sonnet-5`, then `claude-opus-5`), which
is why this is recorded as a starting point rather than a conclusion.

Four consequences a reader porting this to another tier will otherwise trip on,
because Haiku 4.5 predates the current request surface: `output_config.effort`
**errors** on it; adaptive thinking is unavailable (it takes the older
`budget_tokens` form, and this call sends no `thinking` at all — extraction
needs none); server-side `fallbacks` belongs to the Opus 5 / Fable 5 refusal
classifiers and is not sent; and prompt caching silently does nothing, because
Haiku 4.5's minimum cacheable prefix is 4,096 tokens and the category list plus
instructions come to roughly a third of that. Its images also cap at 1568px on
the long edge rather than 2576px — cheaper per scan, and the first thing to
suspect if small print reads badly.

**The photograph is not stored.** It is read and discarded. A bill is a record
of a household's private life, and the app's answer to "where is that image
kept" should be "nowhere".

## Considered Options

**A new "scan" entry mode writing a Receipt directly.** The intuitive shape, and
it reopens what ADR-0015 closed: a second creation path needs its own RPC, its
own validation, and its own answer to what happens when a Split is already
settled. Filling the existing form costs one extra confirmation and reuses every
rule already written.

**Returning line items and letting the user group them.** More faithful to the
slip and worse to use: thirty taps to produce four numbers. The grouping is the
part worth automating.

**Auto-balancing an OCR mismatch into the largest line.** Rejected outright —
see above.

**Calling the model from the app.** An API key in a client bundle is a published
API key. The call goes through a Supabase Edge Function, which is also where the
response is validated before the app ever sees it.

## Consequences

**The project gains a backend surface it has never had.** `supabase/functions/`
is empty today; this adds one function, one secret, and a deployment step that
is not `vercel --prod`. That is a real cost and it is the price of the key
staying secret.

**A model refusal is a state the UI must handle.** Claude returns HTTP 200 with
`stop_reason: "refusal"` rather than an error, so the function checks that
before reading content and the sheet says the scan failed rather than showing an
empty form.

**The scan can be wrong and that is survivable**, because being wrong here means
a preview the household corrects — the same standing the import screen already
has. What it must never do is be wrong *after* Apply.
