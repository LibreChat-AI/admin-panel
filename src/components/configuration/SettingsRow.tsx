import { useContext, useLayoutEffect } from 'react';
import type * as t from '@/types';
import { SoleFieldContext } from '@/contexts/SettingsContext';
import { SectionControls } from './SectionControls';
import { SectionHeader } from './SectionHeader';
import { fieldControl } from '@/utils';
import { useLocalize } from '@/hooks';

/** A button named by the text it shows ("Add tool"), not a switch or a select trigger. */
const TEXT_BUTTON = 'button:not([role]), button[role="button"]';

/**
 * Adds `id` to the control's `aria-describedby`. The returned cleanup takes
 * out only that id, from the attribute as it is then: React may have changed
 * the rest since (a rename warning that went away), and restoring a snapshot
 * would bring back a stale id. Undefined when the control already lists it.
 */
function addDescription(control: HTMLElement, id: string): (() => void) | undefined {
  const described = control.getAttribute('aria-describedby')?.split(' ') ?? [];
  if (described.includes(id)) return undefined;
  control.setAttribute('aria-describedby', [...described, id].join(' '));
  return () => {
    const remaining = (control.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter((token) => token !== '' && token !== id);
    if (remaining.length > 0) control.setAttribute('aria-describedby', remaining.join(' '));
    else control.removeAttribute('aria-describedby');
  };
}

/**
 * Names the control after its section in a single-field section: the visible
 * label is the section heading, so `aria-labelledby` (which outranks the
 * control's own `aria-label`) points at "<Section> <field>". A button that
 * shows its own text keeps it as its name (WCAG 2.5.3, label in name: an
 * empty list's "Add tool") and is described by the field's name instead.
 * Runs after every render because controls can remount without the row
 * re-rendering.
 */
function useSoleFieldName(htmlFor: string | undefined, nameId: string) {
  useLayoutEffect(() => {
    const control = fieldControl(htmlFor);
    if (!control) return;
    if (control.matches(TEXT_BUTTON) && control.textContent?.trim()) {
      return addDescription(control, nameId);
    }
    if (control.hasAttribute('aria-labelledby')) return;
    control.setAttribute('aria-labelledby', nameId);
    return () => control.removeAttribute('aria-labelledby');
  });
}

/**
 * Ties a row's error to its control (`aria-describedby`, and `aria-invalid`
 * unless the control already says so), for errors the row shows on the
 * control's behalf (save pipeline issues, spec problems). A control that also
 * shows its own message stays described by both.
 */
function useErrorDescription(htmlFor: string | undefined, hasError: boolean) {
  useLayoutEffect(() => {
    const control = hasError ? fieldControl(htmlFor) : null;
    if (!control) return;
    const setsInvalid = control.getAttribute('aria-invalid') !== 'true';
    if (setsInvalid) control.setAttribute('aria-invalid', 'true');
    /**
     * Writes to `aria-invalid` after ours are the control's own (React
     * rendering its own error as the row's goes away), so they hand the
     * attribute back to the control. Read synchronously in the cleanup.
     */
    const claims = setsInvalid ? new MutationObserver(() => undefined) : null;
    claims?.observe(control, { attributes: true, attributeFilter: ['aria-invalid'] });
    const removeDescription = addDescription(control, `${htmlFor}-error`);
    /** Undo only what this effect added, against the attributes as they are now. */
    return () => {
      const reclaimed = (claims?.takeRecords().length ?? 0) > 0;
      claims?.disconnect();
      if (setsInvalid && !reclaimed && control.getAttribute('aria-invalid') === 'true') {
        control.removeAttribute('aria-invalid');
      }
      removeDescription?.();
    };
  });
}

function SoleFieldRow({ sole, label, htmlFor, children }: t.SoleFieldRowProps) {
  const localize = useLocalize();
  const nameId = `${sole.headingId}-field`;
  useSoleFieldName(htmlFor, nameId);
  const sameLabel = label.trim().toLowerCase() === sole.sectionTitle.trim().toLowerCase();
  const name = sameLabel
    ? sole.sectionTitle
    : localize('com_config_ui_sole_name', { section: sole.sectionTitle, field: label });

  return (
    <div className="settings-row-sole">
      <span id={nameId} hidden>
        {name}
      </span>
      {children}
    </div>
  );
}

/**
 * One settings row on the shared grid `label | control | trailing` (WS6).
 * WS3 fills the slots; the layout, type scale and responsive collapse live here
 * and in `styles.css` (`.settings-row`). Inside a single-field section the row
 * drops its label column and lends its cells to the section's header row.
 */
export function SettingsRow({
  label,
  htmlFor,
  description,
  learnMoreUrl,
  control,
  chips,
  hint,
  actions,
  error,
  required,
  width,
  marker,
}: t.SettingsRowProps) {
  const sole = useContext(SoleFieldContext);
  useErrorDescription(htmlFor, Boolean(error));
  const errorNode = error ? (
    <div id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="settings-error">
      {error}
    </div>
  ) : null;
  const trailing =
    chips || actions ? (
      <div className="settings-row-trailing">
        {chips}
        {actions}
      </div>
    ) : null;

  if (sole) {
    return (
      <SoleFieldRow sole={sole} label={label} htmlFor={htmlFor}>
        <SectionControls width={width}>
          {control}
          {hint}
          {errorNode}
        </SectionControls>
        {trailing}
      </SoleFieldRow>
    );
  }

  return (
    <div className="settings-row" data-marker={marker}>
      <SectionHeader
        title={label}
        description={description}
        learnMoreUrl={learnMoreUrl}
        htmlFor={htmlFor}
        required={required}
        subtitle={hint}
      />
      <SectionControls width={width}>
        {control}
        {errorNode}
      </SectionControls>
      {trailing}
    </div>
  );
}
