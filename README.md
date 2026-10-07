# Cloversky

A shared personal-finance app for a couple — track income and expenses per person, follow installment plans and credit-card billing cycles, and plan debt payoff.

## Documents

* [docs/SPEC.md](docs/SPEC.md) — product spec from the original conversation (baseline features and the data structure of the existing Google Sheet)
* [docs/DESIGN.md](docs/DESIGN.md) — system analysis and design: tech stack, data model, core financial logic, UX, roadmap

Documentation is in English; the product UI is in Thai.

## Status

Phase 0 (Foundation) done: schema + RLS applied, CI green, auth working, deployed at https://cloversky.vercel.app. Phase 1 (core capture) is next — see the roadmap in DESIGN §10.

## Development

```bash
npm install
npm run dev       # start the Vite dev server
npm run typecheck # tsc --noEmit
npm test          # vitest
```

Supabase schema and migrations live in `supabase/migrations/`.
