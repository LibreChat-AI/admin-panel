import * as Dialog from '@radix-ui/react-dialog';
import type * as t from '@/types';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { useLocalize, useMediaQuery } from '@/hooks';
import { CloseButton } from '@/components/shared';
import { cn } from '@/utils';

/**
 * Side drawer the custom endpoint editor opens in (WS10 CE-7), so the list
 * stays in view behind it. Edits are staged on the page as they are made;
 * closing never discards them. While creating, a close request goes to
 * `onRequestClose` so a filled-in draft can be confirmed first. Closing
 * returns focus to `returnFocus()` (the endpoint's row, or Create). On a
 * phone the notice scrolls away with the form, leaving it the screen.
 */
export function EndpointDrawer({
  open,
  onClose,
  onRequestClose,
  title,
  badges,
  subtitle,
  notice,
  footer,
  children,
  bodyRef,
  returnFocus,
}: t.EndpointDrawerProps) {
  const localize = useLocalize();
  const requestClose = onRequestClose ?? onClose;
  const isPhone = useMediaQuery('(max-width: 639.98px)');

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-(--z-overlay) bg-black/30 backdrop-blur-[1px]',
            'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
          )}
        />
        <Dialog.Content
          data-endpoint-drawer
          onCloseAutoFocus={(event) => {
            const target = returnFocus?.();
            if (!target) return;
            event.preventDefault();
            target.focus();
          }}
          className={cn(
            'fixed top-0 inset-e-0 z-(--z-overlay) flex h-full w-full flex-col bg-(--cui-color-background-panel) shadow-xl',
            'border-s border-(--cui-color-stroke-default) sm:w-[min(56rem,calc(100vw-3rem))]',
            'will-change-transform',
            'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-(--cui-color-stroke-default) px-4 py-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Dialog.Title className="m-0 max-w-full truncate text-base font-semibold text-(--cui-color-text-default)">
                  {title}
                </Dialog.Title>
                {badges}
              </div>
              <Dialog.Description asChild>
                <div className="m-0 min-w-0 text-xs wrap-break-word text-(--cui-color-text-muted)">
                  {subtitle ?? localize('com_config_ce_drawer_desc')}
                </div>
              </Dialog.Description>
            </div>
            <CloseButton onClick={requestClose} label={localize('com_ui_close')} />
          </header>
          {notice && !isPhone && <div className="flex flex-col gap-2 px-4 pt-3">{notice}</div>}
          <RowFilterContext.Provider value={null}>
            <div
              ref={bodyRef}
              className="settings-content min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8"
            >
              {notice && isPhone && <div className="mb-8 flex flex-col gap-2">{notice}</div>}
              {children}
            </div>
          </RowFilterContext.Provider>
          <footer className="flex flex-wrap items-center gap-2 border-t border-(--cui-color-stroke-default) px-4 py-3">
            {footer}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
