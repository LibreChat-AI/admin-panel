import { vi } from 'vitest';
import type { ReactNode } from 'react';

type RouterModule = typeof import('@tanstack/react-router');

interface LinkProps {
  to?: string;
  search?: Record<string, string>;
  children?: ReactNode;
  className?: string;
}

function PlainLink({ to = '', search, children, className }: LinkProps) {
  const query = search ? `?${new URLSearchParams(search).toString()}` : '';
  return (
    <a href={`${to}${query}`} className={className}>
      {children}
    </a>
  );
}

/**
 * `@tanstack/react-router` for components rendered without a router (the
 * configuration tab harness): `useNavigate` returns a spy and `Link` is a
 * plain anchor. Use as `vi.mock('@tanstack/react-router', routerless)`.
 */
export async function routerless(importOriginal: () => Promise<RouterModule>) {
  return {
    ...(await importOriginal()),
    useNavigate: () => vi.fn(),
    Link: PlainLink,
  };
}
