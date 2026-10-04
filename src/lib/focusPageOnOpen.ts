// For FullScreenPage and EntryPage's Radix Dialog `onOpenAutoFocus`.
//
// Radix moves focus to the first tabbable element on open, which on these
// pages is Back — harmless, but on a form it can be an input and pop the
// system keyboard (see the "No autoFocus" notes in the entry sheets). Focus
// the page itself instead, unless a child already took focus with autoFocus.
export function focusPageOnOpen(e: Event) {
  e.preventDefault()
  const page = e.currentTarget as HTMLElement
  if (!page.contains(document.activeElement)) page.focus()
}
