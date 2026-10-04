import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { useLockDocumentScroll } from '@/hooks/useLockDocumentScroll'
import { usePushTransition } from '@/hooks/usePushTransition'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  headerActions?: ReactNode
}

// The plain full-screen shell — a header with Back, a scrollable body, no
// footer/panel — for pages that are navigated to rather than filled out
// (Settings, Manage categories). EntryPage is the sibling of this for forms,
// which need the shared bottom picker panel FullScreenPage doesn't have.
//
// On mobile it behaves like a pushed page in a native app: slides in from
// the right, slides back out on Back, and can be swiped away from the left
// edge (usePushTransition).
//
// Portalled to document.body for the same reason as EntryPage: this can be
// opened from inside another already-scrollable screen (Manage categories
// opens from inside Settings' own body), and a `position: fixed` element
// nested inside a scrolling ancestor doesn't reliably stay pinned to the
// viewport on iOS Safari.
export function FullScreenPage({ title, onClose, children, headerActions }: Props) {
  const isDesktop = useIsDesktop()
  const { close, handlers, pageStyle, backdropStyle } = usePushTransition(onClose, !isDesktop)
  useLockDocumentScroll()

  return createPortal(
    <div className="fixed inset-0 z-30 touch-pan-y" {...handlers}>
      <div className="absolute inset-0 bg-black" style={backdropStyle} aria-hidden />
      <div className="absolute inset-0 flex flex-col bg-background" style={pageStyle}>
        <header className="sticky top-0 flex items-center gap-2 border-b bg-background px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2">
          <Button variant="ghost" size="icon" onClick={close} aria-label="Back">
            <ChevronLeft className="size-5" />
          </Button>
          <h1 className="flex-1 truncate font-heading text-sm font-medium">{title}</h1>
          {headerActions}
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
