import { useEffect } from 'react'

// On mobile the document itself is what scrolls (AppShell's mobile layout
// is a min-h-svh column, not a fixed-height one), so a full-screen overlay
// sitting on top of it doesn't stop a drag from reaching it: a touch on the
// overlay's header, or a scroll that runs past the overlay body's end,
// chains through and moves the page underneath. Hiding the document's
// overflow while any overlay is open cuts that off.
//
// Counted rather than a plain set/unset because overlays nest (Manage
// categories opens on top of Settings) — closing the inner one mustn't
// unlock the page while the outer one is still up.
let locks = 0

export function useLockDocumentScroll() {
  useEffect(() => {
    if (locks++ === 0) {
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
    }
    return () => {
      if (--locks === 0) {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
      }
    }
  }, [])
}
