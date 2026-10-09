# The palette is Emerald and the type is self-hosted IBM Plex

> **The palette is superseded by [ADR-0022](./0022-tomato-and-marine-on-white.md)** (2026-10).
> The fonts, the focus ring and the verify-every-pair rule still stand.

The app's colour becomes **Emerald** — a green canvas, light and dark, with every
foreground/background pair verified at 4.5:1 or better — and its type becomes one
family in three cuts, bundled with the app rather than fetched: **IBM Plex Sans**
for Latin, **IBM Plex Sans Thai Looped** for Thai, **IBM Plex Mono** for figures.
`--radius` drops from `0.5rem` to `0.4375rem`, the `gradient-love` utility and its
two tokens are deleted, and the app gets a `:focus-visible` ring for the first
time.

This supersedes two decisions.

**[ADR-0005](./0005-english-chrome-buddhist-years-system-fonts.md)'s font rule.**
Its argument was sound and is still sound: Mitr and Prompt were bundled for a
Thai interface that never shipped, and 200 KB of rounded display face has no
business in dense lists of figures. What it missed is that **the user's data is
still Thai** — category names, notes, both members' names — so the app never
escaped needing a Thai text face. It only stopped *choosing* one, and inherited
whatever each device happened to have. A line reading "Food → กาแฟ" was being set
in two unrelated typefaces whose weights and x-heights do not agree, on every
screen, all the time. IBM Plex Sans and IBM Plex Sans Thai Looped are one design
in two scripts, so that line now has a single texture. **Looped** specifically —
the loopless Thai cuts read as display faces to a Thai reader, and this is body
copy.

**The v3.6 colour pass.** "Ember ledger" terracotta, itself a replacement for the
"Sweetheart ledger" blush. ADR-0005 signed off with *"the app's personality lives
in its colour, not its letterforms"*; that was true when the letterforms were the
platform's, and the sentence is what this decision retires. The personality now
lives in both.

## Considered Options

**Google Fonts over a CDN.** Rejected outright. §8 promises the PWA opens and
reads offline, and Workbox precaches what the build emits — a CDN font is not in
that set, so every offline open would silently fall back to a different face, and
Thai would fall back furthest. `@fontsource` packages put the files in the build
output where the service worker can see them.

**Keeping the platform font for Latin and adding a Thai face only.** Cheaper, and
it preserves ADR-0005's download argument. Rejected because it recreates the
exact problem in a new place: two families still meet inside one line, and now
the Latin half varies per device while the Thai half does not, so the mismatch is
different on every phone and untestable.

**Keeping terracotta and changing only the type.** Rejected because the two were
decided together against the same prototypes, and because green carries in/out
without a second signal — an app whose central act is separating money coming in
from money going out gets that for free from the palette.

## Consequences

**Fonts are a real download now**, where ADR-0005's choice cost nothing. Variable
Latin plus four Thai weights plus three mono weights land in the precache
manifest, and the first install is bigger. This is the price of the offline
promise being honest.

**Every colour pair was verified rather than eyeballed** — OKLCH converted to
linear sRGB, relative luminance, contrast ratio, both themes. The tokens are not
to be edited by picking something that looks close.

**`gradient-love` is gone**, and its three consumers (the FAB, `AuthLayout`,
`Keypad`) are flat `bg-primary` instead. A gradient was the one decorative
gesture in a system that had otherwise committed to hairlines and no shadows;
keeping it would have made every other surface look unfinished by comparison.

**`--font-mono` exists and is used for figures.** Money in a ledger is compared
down a column, and proportional digits make that harder than it needs to be.

**A focus ring exists.** App code had fourteen `active:` rules, six `hover:`, and
no `focus-visible` anywhere — keyboard navigation was invisible. This is not
strictly a colour decision, but it is the same edit to the same file and it
blocked the desktop layout ([ADR-0010](./0010-desktop-is-three-regions.md)) from
being usable at all.
