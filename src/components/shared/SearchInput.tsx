import { SearchField } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { cn } from '@/utils';

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel,
}: t.SearchInputProps) {
  return (
    <div className={cn('cui-field aimo-search w-full max-w-100', className)}>
      <SearchField
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    </div>
  );
}
