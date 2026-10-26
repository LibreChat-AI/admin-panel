import { createPortal } from 'react-dom';
import { Icon } from '@clickhouse/click-ui';
import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type * as t from '@/types';
import { searchUsersFn } from '@/server';
import { useLocalize } from '@/hooks';
import { Avatar } from './Avatar';
import { cn } from '@/utils';

export function UserSearchInline({
  existingIds,
  onAdd,
  listboxId = 'user-search-results',
  disabled,
}: t.UserSearchInlineProps) {
  const localize = useLocalize();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const blurRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(blurRef.current);
    };
  }, []);

  const searchQuery = useQuery({
    queryKey: ['userSearch', debouncedQuery],
    queryFn: () => searchUsersFn({ data: { query: debouncedQuery } }),
    enabled: debouncedQuery.trim().length > 0,
    select: (data) => data.users.filter((u) => !existingIds.includes(u.id)),
  });

  const results = searchQuery.data ?? [];

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);
    setActiveIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setDebouncedQuery('');
      setShowResults(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(value);
      setShowResults(true);
    }, 200);
  };

  const handleSelect = (user: AdminUserSearchResult) => {
    onAdd(user);
    setQuery('');
    setDebouncedQuery('');
    setShowResults(false);
    inputRef.current?.focus();
  };

  const scrollToIndex = (index: number) => {
    (listRef.current?.children[index] as HTMLElement | undefined)?.scrollIntoView({
      block: 'nearest',
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = activeIndex < results.length - 1 ? activeIndex + 1 : 0;
      setActiveIndex(next);
      scrollToIndex(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = activeIndex > 0 ? activeIndex - 1 : results.length - 1;
      setActiveIndex(next);
      scrollToIndex(next);
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(results[activeIndex]);
    } else if (e.key === 'Escape') {
      setShowResults(false);
    }
  };

  const hasResults = showResults && debouncedQuery.trim().length > 0;

  const renderDropdownContent = (rect: { top: number; left: number; width: number }) => {
    const positionStyle = {
      position: 'fixed' as const,
      top: rect.top,
      left: rect.left,
      width: rect.width,
      pointerEvents: 'auto' as const,
    };
    if (results.length > 0) {
      return (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          style={positionStyle}
          className="z-(--z-command) max-h-56 animate-fade overflow-auto rounded-inner border border-line bg-surface p-1.5 shadow-pop"
        >
          {results.map((user, i) => (
            <li
              key={user.id}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleSelect(user)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-ink transition-colors',
                i === activeIndex ? 'bg-soft-blue' : 'hover:bg-fill',
              )}
            >
              <Avatar name={user.name} size="sm" />
              <div className="flex flex-col">
                <span className="font-semibold">{user.name}</span>
                <span className="text-xs text-muted">{user.email}</span>
              </div>
            </li>
          ))}
        </ul>
      );
    }
    if (!searchQuery.isLoading) {
      return (
        <div
          style={positionStyle}
          className="z-(--z-command) animate-fade rounded-inner border border-line bg-surface px-3 py-3 text-center text-sm text-muted shadow-pop"
        >
          {localize('com_access_no_users_found')}
        </div>
      );
    }
    return null;
  };

  useLayoutEffect(() => {
    if (!hasResults || !inputRef.current) {
      setDropdownRect(null);
      return;
    }

    const updatePosition = () => {
      if (!inputRef.current) return;
      const rect = inputRef.current.getBoundingClientRect();
      const top = rect.bottom + 4;
      setDropdownRect((prev) => {
        if (prev && prev.top === top && prev.left === rect.left && prev.width === rect.width) {
          return prev;
        }
        return { top, left: rect.left, width: rect.width };
      });
    };

    updatePosition();

    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);

    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [hasResults]);

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted"
      >
        <Icon name="search" size="xs" />
      </span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          blurRef.current = setTimeout(() => setShowResults(false), 150);
        }}
        onFocus={() => {
          if (results.length > 0 && debouncedQuery.trim()) setShowResults(true);
        }}
        placeholder={localize('com_access_add_members_placeholder')}
        aria-label={localize('com_access_add_members_placeholder')}
        aria-expanded={hasResults && results.length > 0}
        aria-autocomplete="list"
        aria-controls={listboxId}
        role="combobox"
        disabled={disabled}
        className="aimo-input pl-10"
      />
      {hasResults &&
        dropdownRect &&
        createPortal(renderDropdownContent(dropdownRect), document.body)}
    </div>
  );
}
