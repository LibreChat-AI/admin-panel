import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantHeader: { value: string | undefined } = { value: undefined };

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: vi.fn((name: string) =>
    name.toLowerCase() === 'x-tenant-id' ? tenantHeader.value : undefined,
  ),
}));

import { readTenantHeader, tenantHeaders } from './tenant';

beforeEach(() => {
  tenantHeader.value = undefined;
});

describe('readTenantHeader', () => {
  it('reads the trimmed tenant the deployment set on the request', () => {
    tenantHeader.value = '  tenant-a ';
    expect(readTenantHeader()).toBe('tenant-a');
  });

  it.each([undefined, '', '   '])('has no tenant for %j', (value) => {
    tenantHeader.value = value;
    expect(readTenantHeader()).toBeUndefined();
  });
});

describe('tenantHeaders', () => {
  it('carries the tenant to LibreChat as X-Tenant-Id', () => {
    tenantHeader.value = 'tenant-a';
    expect(tenantHeaders()).toEqual({ 'X-Tenant-Id': 'tenant-a' });
  });

  it('adds no header without a tenant, so single-tenant calls are unchanged', () => {
    expect(tenantHeaders()).toEqual({});
  });
});
