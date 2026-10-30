import { Button } from '@clickhouse/click-ui';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState } from 'react';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { useLocalize, useReturnFocus, useConfigPreview, useConfigFeatures } from '@/hooks';
import { CloseButton, DecorativeIcon } from '@/components/shared';
import { cn, restoreFocus, formatScopeName } from '@/utils';
import { Banner } from '../sections/endpoints/Banner';
import { getScopeTypeConfig } from '@/constants';
import { PreviewPicker } from './Picker';
import { PreviewLayers } from './Layers';
import { PreviewConfig } from './Config';
import { sourceLabel } from '../values';

function targetLabel(target: t.PreviewTarget, localize: t.LocalizeFn): string {
  if (target.type === 'BASE') return localize('com_config_preview_everyone_base');
  const { principalType } = target.principal;
  return sourceLabel('scope', localize, { principalType, name: formatScopeName(target.principal) });
}

/** The notice of a preview the panel estimates (no `resolvedApi`): what it leaves out. */
function EstimateNotice({ target }: t.PreviewTargetProps) {
  const localize = useLocalize();
  const isUser =
    target.type === 'PRINCIPAL' && target.principal.principalType === PrincipalType.USER;
  return (
    <Banner tone="info" role="status">
      <span className="flex flex-col gap-1">
        <span>{localize('com_config_preview_estimate')}</span>
        {isUser && <span>{localize('com_config_preview_estimate_user')}</span>}
      </span>
    </Banner>
  );
}

function PreviewBody({ target }: t.PreviewTargetProps) {
  const localize = useLocalize();
  const state = useConfigPreview(target);
  if (state.errorKey) {
    return (
      <Banner
        tone="danger"
        role="alert"
        action={
          <Button
            htmlType="button"
            type="secondary"
            label={localize('com_ui_retry')}
            onClick={state.retry}
          />
        }
      >
        {localize(state.errorKey)}
      </Banner>
    );
  }
  if (state.isLoading || !state.preview) {
    return (
      <p
        role="status"
        className="m-0 flex items-center gap-2 text-sm text-(--cui-color-text-muted)"
      >
        <DecorativeIcon name="loading-animated" size="sm" />
        {localize('com_config_preview_loading')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {state.preview.source === 'panel' && <EstimateNotice target={target} />}
      <PreviewLayers preview={state.preview} target={target} />
      <PreviewConfig preview={state.preview} />
    </div>
  );
}

/**
 * "Preview": the configuration a role, group or user (or everyone) actually
 * gets, in a side drawer. A server with `resolvedApi` resolves it the way
 * requests resolve it and says what it leaves out of each document; an older
 * one gets the panel's estimate from Base and the principal's own profile.
 * It shows saved configuration: pending edits are not part of it.
 */
export function PreviewDrawer({ open, onClose, initialTarget }: t.PreviewDrawerProps) {
  const localize = useLocalize();
  const returnFocus = useReturnFocus(open);
  const { resolvedApi } = useConfigFeatures();
  const [target, setTarget] = useState(initialTarget);
  const [picking, setPicking] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  const changeRef = useRef<HTMLButtonElement>(null);
  const wasPicking = useRef(picking);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setTarget(initialTarget);
      setPicking(false);
    }
  }

  /** Picking or cancelling takes the picker, and the focus in it, away: focus goes back to Change. */
  useEffect(() => {
    const was = wasPicking.current;
    wasPicking.current = picking;
    if (!was || picking) return;
    const change = changeRef.current;
    restoreFocus([change], change?.closest('[role="dialog"]'));
  }, [picking]);

  const config = getScopeTypeConfig(
    target.type === 'BASE' ? 'BASE' : target.principal.principalType,
  );

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-(--z-overlay) bg-black/30 backdrop-blur-[1px]',
            'data-[state=closed]:animate-overlay-out data-[state=open]:animate-overlay-in',
          )}
        />
        <Dialog.Content
          data-config-preview-drawer
          onCloseAutoFocus={returnFocus}
          className={cn(
            'fixed top-0 inset-e-0 z-(--z-overlay) flex h-full w-full flex-col bg-(--cui-color-background-panel) shadow-xl',
            'border-s border-(--cui-color-stroke-default) sm:w-[min(52rem,calc(100vw-3rem))]',
            'will-change-transform',
            'data-[state=closed]:animate-drawer-out data-[state=open]:animate-drawer-in',
          )}
        >
          <header className="flex items-start justify-between gap-3 border-b border-(--cui-color-stroke-default) px-4 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <Dialog.Title className="m-0 text-base font-semibold text-(--cui-color-text-default)">
                {localize('com_config_preview_title')}
              </Dialog.Title>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span
                  className="flex min-w-0 items-center gap-1.5 text-sm text-(--cui-color-text-default)"
                  data-preview-target
                >
                  <span
                    aria-hidden="true"
                    className="flex shrink-0"
                    style={{ color: config.color }}
                  >
                    <DecorativeIcon name={config.icon} size="sm" />
                  </span>
                  <span className="min-w-0 wrap-break-word">{targetLabel(target, localize)}</span>
                </span>
                {!picking && (
                  <Button
                    ref={changeRef}
                    htmlType="button"
                    type="secondary"
                    label={localize('com_config_preview_change')}
                    onClick={() => setPicking(true)}
                  />
                )}
              </div>
              <Dialog.Description className="m-0 text-xs text-(--cui-color-text-muted)">
                {localize(
                  resolvedApi ? 'com_config_preview_desc_server' : 'com_config_preview_desc_panel',
                )}
              </Dialog.Description>
            </div>
            <CloseButton onClick={onClose} label={localize('com_ui_close')} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-8">
            {picking ? (
              <PreviewPicker
                target={target}
                onPick={(next) => {
                  setTarget(next);
                  setPicking(false);
                }}
                onCancel={() => setPicking(false)}
              />
            ) : (
              <PreviewBody target={target} />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
