# The palette is tomato and marine on white

The app's colour becomes **Tomato**: a white canvas, marine-navy text, and tomato
red as the interactive colour — buttons, the active tab, the selected chip, the
focus ring. Money coming in is **marine blue**. `--radius` goes from `0.4375rem`
to `0.875rem`. This supersedes the palette half of
[ADR-0009](./0009-emerald-and-self-hosted-ibm-plex.md); its fonts, its focus ring
and its rule that every pair is verified rather than eyeballed all stand.

Pure tomato (`#FF6347`) is 2.95:1 on white, so it cannot carry text. Light mode
uses a deeper tomato of the same hue for `--primary` (white on it is 4.9:1), and
the pure colour stays where nothing is read on it: `--chart-1`, and `--primary`
in dark mode, where it sits on navy. Marine is `#0B3B75` as given.

## Considered Options

Chosen on the real Records page from four rounds of token-only variants
(`prototype/theme-records` branch): pastel green/blue (Mint Mist, Sky Ledger,
Seafoam Soft), five user-supplied lime/sage palettes, and three white/tomato/
marine treatments.

**Marine as the primary, tomato only for expenses** (R1). The most restrained of
the three and the one recommended at the time; passed over for Tomato, which has
more personality — the reason ADR-0009 gave for leaving terracotta still applies
in reverse: the palette is where the app's character lives.

**Navy text with tomato blush accents and square corners** (R3). Read as a
uniform rather than an app.

**Keeping `--good` on the primary hue**, as ADR-0009 did on purpose. Not
possible here: a red "money in" beside red buttons would say the opposite of what
it means. In/out is now blue/red instead of green/red.

## Consequences

**`--primary` and `--good` no longer share a hue.** ADR-0009 called that pairing
the app's personality; it is retired with the green.

**Primary and expenses are both red-family.** `--destructive` is pushed toward
crimson (hue 20 vs 32) so Delete reads differently from an ordinary primary
button, and the 2026-10 redesign already moves ordinary expense amounts to the
foreground colour, keeping red for warnings and a negative net.

**The app icon is still the old pink heart** — it was stale under Emerald too, and
a new icon is a separate decision.
