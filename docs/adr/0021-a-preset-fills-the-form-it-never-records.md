# A Preset fills the entry form; it never records anything

The entry form's chip row (v3.9 F) showed the six categories used most in the
last 90 days, ordered by count. It answered "which category" and, through the
last-used instrument, "which card", but never "what note" or "how much", and its
order moved whenever the counts changed, so a chip could not be found by where
the thumb remembered it. The ask was to make entry faster, and to make the chips
something the household sets rather than something the app guesses.

## What changes

**A Preset is a person's own named fill for the entry form.** It holds a Kind
(expense or income) and a Category, and optionally a note, an Instrument and an
amount. It lives in `entry_presets`, one row per preset, ordered by
`sort_order`, which the person sets by dragging in Settings → Presets.

**The chip row shows Presets and nothing else.** The frequency chips are gone;
`useCategoryUsage` keeps only the last-used instrument per category, which the
form still uses as its default. A preset whose category is archived is left off
the form. With no presets, the row is a single "+ Preset" chip. The Category row
and its full grid are unchanged (D17).

**A tap fills the form; Save is still a tap of its own.** Category and
Instrument, which the tap asks for, replace what is there. Note and amount fill
only an empty field, so nothing typed is lost. A filled amount is replaced by
the first digit typed, the way selected text is. A coffee preset with its price
is three taps: FAB → preset → Save. Saving on the tap would make it two, but a
wrong amount recorded without a look changes every figure in the app quietly,
and the price is rarely the same twice.

**Presets belong to one Member.** A preset names a card, and one person's card
is the wrong default for the other. `member_id` is on the row; RLS stays
household-wide like every other table, and the app shows each person only their
own.

**Who bears and Transfers are left out.** D13 makes sharing a decision made per
Transaction; a chip that carried "split evenly" would raise a Debt on every tap
without anyone deciding it. Transfers use a different form (from and to, no
category) and would double the work for a case that was not asked for.

**Presets are made from what was typed, or from scratch.** The bookmark on the
form's header saves the current Kind, Category, note and Instrument under a
name; the amount is included only when ticked, unticked by default. Settings →
Presets creates and edits presets on a page with the entry form's own rows and
bottom panel, where only the name, Kind and Category are required: an empty
amount fills no amount, and an unset Instrument leaves the form's last-used
default in charge. The same screen reorders by drag, deletes by swipe, and lists
up to five suggestions: a Category and note this person recorded at least three
times in 90 days, with the newest Instrument and the amount only if it never
varied.

## Considered and not done

- **Pinned categories** (favourites without note, Instrument or amount). Stable
  positions, but it fills less than the frequency chips already did.
- **Showing presets and frequency chips together.** Brings back the moving part.
- **Repeat-a-row from Records, and a home-screen shortcut.** Both are faster
  entry points; neither was needed once presets exist, and either can come later.
