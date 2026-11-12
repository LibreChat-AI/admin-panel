import { useRef } from 'react';
import { SearchField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useClearButtonLabel, useLocalize } from '@/hooks';

/** click-ui's search field, its clear button named in the panel's language. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
  inputRef,
}: t.SearchInputProps) {
  const localize = useLocalize();
  const fieldRef = useRef<HTMLDivElement>(null);
  useClearButtonLabel(fieldRef, localize('com_ui_clear'));
  return (
    <div ref={fieldRef} className={`cui-field ${className ?? ''}`} style={{ maxWidth: 400 }}>
      <SearchField
        ref={inputRef}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}
