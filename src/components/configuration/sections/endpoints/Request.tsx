/**
 * Request shaping controls of the custom endpoint editor (WS10 CE-7): the
 * parameters dropped from every request as removable tags with suggestions
 * of the usual OpenAI parameters, and the placeholders LibreChat fills in
 * header values, insertable at the cursor of the header value being edited.
 */
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { DecorativeIcon } from '@/components/shared';
import { INPUT_CLASSES } from '../../fields/display';
import { useLocalize } from '@/hooks';
import { cn } from '@/utils';

/** OpenAI-compatible parameters providers commonly reject. */
const COMMON_DROP_PARAMS = [
  'stop',
  'user',
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
  'stream_options',
  'n',
  'seed',
  'logit_bias',
  'logprobs',
  'top_logprobs',
  'response_format',
  'tools',
  'tool_choice',
  'parallel_tool_calls',
  'reasoning_effort',
  'reasoning',
];

/** Values LibreChat substitutes in header values (`resolveHeaders`), per request. */
const HEADER_PLACEHOLDERS = [
  '{{LIBRECHAT_USER_ID}}',
  '{{LIBRECHAT_USER_EMAIL}}',
  '{{LIBRECHAT_USER_USERNAME}}',
  '{{LIBRECHAT_USER_ROLE}}',
  '{{LIBRECHAT_BODY_CONVERSATIONID}}',
  '{{LIBRECHAT_BODY_MESSAGEID}}',
  '${ENV_VAR}',
];

/**
 * A list of parameter names as tags: type a name (or several, comma
 * separated) and press Enter, or pick a suggestion; Backspace in the empty
 * input removes the last tag. Removing the last one calls `onClear`.
 */
export function TagListField({
  id,
  values,
  onChange,
  onClear,
  disabled,
  'aria-label': ariaLabel,
}: t.TagListFieldProps) {
  const localize = useLocalize();
  const [draft, setDraft] = useState('');
  const listId = `${id}-suggestions`;
  const taken = new Set(values);

  const add = (raw: string) => {
    const items = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item, index, all) => item !== '' && !taken.has(item) && all.indexOf(item) === index);
    setDraft('');
    if (items.length > 0) onChange([...values, ...items]);
  };
  const remove = (item: string) => {
    const next = values.filter((value) => value !== item);
    if (next.length > 0) onChange(next);
    else onClear();
  };

  return (
    <div className="flex w-full max-w-150 flex-col gap-2">
      {values.length > 0 && (
        <ul className="settings-chip-list" aria-label={ariaLabel}>
          {values.map((item) => (
            <li key={item} className="settings-chip">
              <span className="truncate font-mono">{item}</span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(item)}
                  aria-label={localize('com_ui_remove_item', { name: item })}
                  className="icon-btn icon-btn-xs icon-btn-danger"
                >
                  <DecorativeIcon name="cross" size="xs" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <>
          <input
            id={id}
            type="text"
            value={draft}
            list={listId}
            onChange={(event) => {
              const next = event.target.value;
              if (next.endsWith(',')) add(next);
              else setDraft(next);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                add(draft);
              }
              if (event.key === 'Backspace' && draft === '' && values.length > 0) {
                remove(values[values.length - 1]);
              }
            }}
            onBlur={() => add(draft)}
            placeholder={localize('com_config_ce_drop_params_placeholder')}
            aria-label={ariaLabel}
            className={cn(INPUT_CLASSES, 'max-w-80')}
          />
          <datalist id={listId}>
            {COMMON_DROP_PARAMS.filter((param) => !taken.has(param)).map((param) => (
              <option key={param} value={param} />
            ))}
          </datalist>
        </>
      )}
    </div>
  );
}

/** A header's value input (never its name): the only place a placeholder goes. */
function isHeaderValueInput(element: EventTarget | null): element is HTMLInputElement {
  return (
    element instanceof HTMLInputElement &&
    element.type === 'text' &&
    element.dataset.kvPart === 'value'
  );
}

/** Types `text` into a React-controlled input at its cursor, as if the admin had typed it. */
function insertAtCursor(input: HTMLInputElement, text: string) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const next = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, next);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
  input.setSelectionRange(start + text.length, start + text.length);
}

/**
 * The headers editor with LibreChat's placeholders under it: picking one
 * inserts it at the cursor of the header value last edited (or copies it
 * when no header value has been focused yet).
 */
export function HeaderPlaceholders({ children }: { children: ReactNode }) {
  const localize = useLocalize();
  const lastInputRef = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const insert = (placeholder: string) => {
    const input = lastInputRef.current;
    if (input && input.isConnected && !input.disabled) {
      insertAtCursor(input, placeholder);
      setCopied(null);
      return;
    }
    void navigator.clipboard?.writeText(placeholder).then(
      () => setCopied(placeholder),
      () => setCopied(null),
    );
  };

  return (
    <div
      onFocusCapture={(event) => {
        if (isHeaderValueInput(event.target)) lastInputRef.current = event.target;
      }}
    >
      {children}
      <div className="settings-row pt-0">
        <div className="settings-row-label" aria-hidden="true" />
        <div className="settings-row-control">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-(--cui-color-text-muted)">
              {localize('com_config_ce_placeholders')}
            </span>
            {HEADER_PLACEHOLDERS.map((placeholder) => (
              <button
                key={placeholder}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insert(placeholder)}
                title={localize('com_config_ce_placeholder_insert')}
                className="cursor-pointer rounded-full border border-dashed border-(--cui-color-stroke-default) bg-transparent px-2 py-0.5 font-mono text-xs text-(--cui-color-text-default) hover:bg-(--cui-color-background-hover)"
              >
                {placeholder}
              </button>
            ))}
          </div>
          <span role="status" className="text-xs text-(--cui-color-text-muted)">
            {copied ? localize('com_config_ce_placeholder_copied', { value: copied }) : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
