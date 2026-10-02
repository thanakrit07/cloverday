# Statements are read in the browser, and the app remembers who is who

[ADR-0019](./0019-statements-import-by-line-identity-and-confirm-matches.md)
gave a statement line an identity and put the import behind a review screen,
but left the *reading* of the statement outside the app: a Python script
masked names and account numbers out of the PDF's text so an AI could turn the
rest into a CSV, and a second script put the real values back. Everything that
went wrong afterwards went wrong in that masking. It worked on text as a
whole, so one rule's gap leaked an address, another swallowed a date as an
account number, another let a 20-digit reference through because a date sat
beside it. Each fix was a new pattern, and each was found by looking at the
output rather than by the pattern being wrong in a way a test could name. The
pipeline existed for one reason — keep the household's names and numbers away
from whatever reads the statement — and it could only ever approximate that.

## What changes

**The PDF is read in the browser, and nothing reads it but the household's own
device.** The review screen takes one or more statement PDFs, extracts their
text with pdf.js, turns it into lines, and parses the lines into rows. There is
no masking step because there is nothing outside the device to mask from. The
file, its text and the password it was opened with are never sent anywhere; the
only write is Apply, to the household's own database, as before. pdf.js loads
only when this screen opens and stays out of the PWA precache.

**One parser per statement layout, deterministic, and loud.** CardX/SpeedyCash,
KTC, UOB cards and KBank each get a parser over *lines of text*, so it can be
tested with invented lines and never needs a real PDF in the repository. A line
no parser rule accounts for becomes an error row in the review screen. Nothing
is skipped silently; the old pipeline's worst failures were all quiet ones. A
PDF that matches no known layout says "not supported yet" rather than guessing.
More accounts (Kept, UOB TMRW, UOB Cash Plus, XpressCash) arrive as their
layouts are seen.

**The statement's text lives in `description`, not `note`.** ADR-0019 wrote it
into `note`, but D23 gives `note` to the household: editing a note destroys the
original text, and anything keyed on it — the line's `source_key`, what the app
has learned about it — goes with it. `description` is the column no screen asks
the household to type into. Nothing imported is live yet, so this costs no data
migration.

**The app remembers what it was told.** Two things the old pipeline left as
"Other" for every row:

- *Who a name is.* `counterparties` maps a normalised name from a transfer line
  to a role: one of the household's own accounts or cards, a member, or a
  merchant with a default category. A name the app hasn't met gets a "who is
  this?" action in the review screen; answering once applies to every row with
  that name and is remembered. Transfers between the household's own accounts
  stop being counted as spending and income, which is most of what "Other" held.
- *What a description usually is.* `v_category_hints` groups the household's
  statement-sourced rows by normalised description and category, so a
  description seen before suggests the category it was last given. It is a view
  rather than a client-side count because the API returns at most 1,000 rows per
  request and a count over a truncated list would be wrong without saying so.
  Matching is exact after normalising — lower case, whitespace collapsed — never
  fuzzy; a description with no hint falls back to a keyword list in the code.
  Rows whose category was only ever a guess (the old import's) are not in the
  view, so a guess can't teach the app to repeat it.

**A line's key follows the statement it came from, not how the app has since
classified it.** ADR-0019 keyed a line by its instrument, and the instrument
changes the moment the household says a name is its own other account: the
expense becomes a transfer, and an overlapping statement imported afterwards
would no longer find the line it already has. The key now names the statement
the line was printed on, so reclassifying never moves it. A transfer is the
one exception, because both of its statements describe it differently (a bank
calls it "โอนไป …", the card calls it "Payment received"): it is keyed by its
two ends and its day alone, so the second statement's copy is a duplicate
rather than a second transfer. The cost is a transfer whose two statements
date it a day apart, which stays two lines until someone merges them, and a
line imported as an expense before its name was explained, which stays one.

**The app remembers which files it has seen, and only that.** `statement_files`
holds a file's name with long digit runs removed (the database refuses a name
that still has twelve in a row), a hash of its content, the date range and
instrument it covered, the row count, who uploaded it and when. Choosing a file
whose hash is already there warns and lets the household carry on, since the
line keys already stop it adding anything twice and a reissued statement is a
real thing. Not the PDF, not its text, not a password. The same table gives
the screen a coverage strip per instrument — which months are in, which are
missing — without another source of truth.

**Seeing a layout without seeing the statement.** The one thing that can't be
tested without a real PDF is how pdf.js orders text into lines. `npm run
statements:shape <pdf>` runs the same extraction and prints the lines to the
terminal only, with every word outside a short list of known structural words
replaced by its shape (`<t8>`, `<a5>`) and every digit by `9`. A word missing
from the list is hidden, never shown, so the failure mode of a forgotten entry
is a less useful sample, not a leak. The output is never written to disk.

## Consequences

The Python pipeline (`pdf_statement_mask.py`, `check_masked.py`, the staging
step) and the CSV step of the review screen stay until one real month has been
imported through the new path and matches what the old path produced, then they
are deleted. Until then both routes write the same rows with the same keys.

A bank that changes how its statement looks breaks that bank's parser, visibly,
and someone has to update it. That is the cost of not having a reader that
copes with anything; the old arrangement had a different cost — a reader that
copes with anything, including by being wrong.

The household's own database now holds other people's names, in
`counterparties`, as the key to recognising a transfer. It is household-scoped
by the same policy as every other table and is the same place the transactions
already live.

## Considered options

**Keep masking and tighten the rules.** Tried for a day. Each round fixed the
gap the previous round's check found and opened another, because the approach
is to approximate "the sensitive parts" in free text.

**Run the Python reader on a server.** The PDF and its password would then
leave the device, which is the opposite of what the move is for.

**Let an AI read the PDF.** Fast to build and tolerant of any layout, and it
puts the household's statements in front of a third party on every import.

**Fuzzy category matching.** Would raise the hit rate and bring back the
silent guesses ADR-0014 exists to refuse. An exact match that misses just asks.
