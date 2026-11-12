import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as t from '@/types';
import { RolesTab } from '../RolesTab';
import '@/locales/i18n';

const role = (name: string, description: string, isSystemRole = false): t.Role => ({
  id: name,
  name,
  description,
  isSystemRole,
  isActive: true,
  userCount: 0,
  permissions: {} as t.RolePermissions,
});

const ROLES = [
  role('ADMIN', '', true),
  role('Billing', 'Invoices and usage reports'),
  role('Support', 'Answers user tickets'),
];

vi.mock('@/hooks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks')>()),
  useCapabilities: () => ({ hasCapability: () => true }),
  useRefreshScopes: () => vi.fn(),
}));

vi.mock('@/server', () => ({
  ROLES_PAGE_SIZE: 50,
  allRolesQueryOptions: { queryKey: ['roles'], queryFn: async () => ROLES },
  deleteRoleFn: vi.fn(),
}));

vi.mock('../EditRoleDialog', () => ({ EditRoleDialog: () => null }));

function renderTab() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <RolesTab onCreateRole={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe('RolesTab search', () => {
  it('announces how many roles match each search', async () => {
    renderTab();
    const field = await screen.findByPlaceholderText('Search roles…');
    const status = () =>
      screen.getAllByRole('status').find((el) => el.textContent?.includes('found'));

    fireEvent.change(field, { target: { value: 'support' } });
    await waitFor(() => expect(status()).toHaveTextContent('1 role found'));

    fireEvent.change(field, { target: { value: 'us' } });
    await waitFor(() => expect(status()).toHaveTextContent('2 roles found'));

    fireEvent.change(field, { target: { value: 'zzz' } });
    await waitFor(() => expect(status()).toHaveTextContent('0 roles found'));
  });
});
