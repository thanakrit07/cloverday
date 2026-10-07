# Cloversky — notes for AI agents

Read [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) before changing code; the
domain vocabulary is in [CONTEXT.md](./CONTEXT.md).

## Use what exists; ask before building new UI infrastructure

Reuse in this order: an existing component in `src/components/` → a shadcn/ui
component (`src/components/ui/`, or add one with the shadcn CLI) → the library
primitive underneath it (`radix-ui`, `vaul`, `sonner`, `react-day-picker`).

If none of those fits and you would have to write it yourself — an overlay,
scroll lock, focus management, a gesture, a dropdown — or add a new
dependency, **stop and ask the user first**: say what exists, why it doesn't
fit, and what the new code will have to maintain. Details and the example
this came from: "UI building blocks" in docs/ARCHITECTURE.md.

## Checks

`npm run typecheck && npm test && npm run lint`
