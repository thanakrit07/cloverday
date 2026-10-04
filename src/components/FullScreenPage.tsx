import type { ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useIsDesktop } from '@/hooks/useIsDesktop'
import { usePushTransition } from '@/hooks/usePushTransition'
import { focusPageOnOpen } from '@/lib/focusPageOnOpen'

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
// Built on Radix's Dialog primitive (unstyled — shadcn's Dialog/Sheet carry
// their own look and enter animation): that's what gives it background
// scroll lock (iOS included), a focus trap, Escape to close, nesting
// (Manage categories opens on top of Settings) and modal semantics for
// screen readers, all of which a hand-rolled overlay would have to
// maintain itself. It also portals to document.body, which matters because
// a `position: fixed` element nested inside a scrolling ancestor doesn't
// reliably stay pinned to the viewport on iOS Safari.
//
// On mobile it behaves like a pushed page in a native app: slides in from
// the right, slides back out on Back, and can be swiped away from the left
// edge (usePushTransition).
export function FullScreenPage({ title, onClose, children, headerActions }: Props) {
  const isDesktop = useIsDesktop()
  const { close, handlers, pageStyle, backdropStyle } = usePushTransition(onClose, !isDesktop)

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-30 bg-black" style={backdropStyle} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={focusPageOnOpen}
          className="fixed inset-0 z-30 flex touch-pan-y flex-col bg-background outline-none"
          style={pageStyle}
          {...handlers}
        >
          <header className="sticky top-0 flex items-center gap-2 border-b bg-background px-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-2">
            <Button variant="ghost" size="icon" onClick={close} aria-label="Back">
              <ChevronLeft className="size-5" />
            </Button>
            <DialogPrimitive.Title className="flex-1 truncate font-heading text-sm font-medium">{title}</DialogPrimitive.Title>
            {headerActions}
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
