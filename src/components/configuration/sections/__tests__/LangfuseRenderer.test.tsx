import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { TLangfuseConnectionStatus } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  getLangfuseConnectionFn,
  LANGFUSE_CONNECTION_QUERY_KEY,
  testLangfuseConnectionFn,
  updateLangfuseConnectionFn,
} from '@/server';
import { LangfuseRenderer } from '../LangfuseRenderer';

/** The labels the key tests read by their English text; every other key renders as its id. */
const { LABELS } = vi.hoisted(() => ({
  LABELS: {
    com_config_langfuse_public_key: 'Public key',
    com_config_langfuse_secret_key: 'Secret key',
    com_ui_edit: 'Edit',
  } as Readonly<Record<string, string>>,
}));

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string) => LABELS[key] ?? key,
}));

vi.mock('@/utils', () => ({
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('@/server', () => ({
  LANGFUSE_CONNECTION_QUERY_KEY: ['adminLangfuseConnection'],
  getLangfuseConnectionFn: vi.fn(),
  testLangfuseConnectionFn: vi.fn(),
  updateLangfuseConnectionFn: vi.fn(),
}));

interface TextFieldProps {
  id?: string;
  label?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}

interface ButtonProps {
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
}

interface SelectProps {
  label?: string;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onSelect?: (value: string) => void;
  children?: React.ReactNode;
}

vi.mock('@clickhouse/click-ui', () => ({
  Badge: ({ text }: { text: string }) => <span>{text}</span>,
  Button: ({ label, disabled, onClick }: ButtonProps) => (
    <button disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
  Select: Object.assign(
    ({ label, value, placeholder, disabled, onSelect, children }: SelectProps) => (
      <label>
        {label}
        <select
          aria-label={label}
          value={value ?? ''}
          disabled={disabled}
          onChange={(event) => onSelect?.(event.target.value)}
        >
          <option value="">{placeholder}</option>
          {children}
        </select>
      </label>
    ),
    {
      Item: ({ value, children }: { value: string; children: React.ReactNode }) => (
        <option value={value}>{children}</option>
      ),
    },
  ),
  TextField: ({ id, label, value, placeholder, disabled, onChange }: TextFieldProps) => (
    <>
      {label && <label htmlFor={id}>{label}</label>}
      <input
        id={id}
        value={value ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </>
  ),
  Icon: () => null,
}));

const mockGet = vi.mocked(getLangfuseConnectionFn);
const mockTest = vi.mocked(testLangfuseConnectionFn);
const mockUpdate = vi.mocked(updateLangfuseConnectionFn);
const destinations = [
  { key: 'eu', baseUrl: 'https://cloud.langfuse.com' },
  { key: 'us', baseUrl: 'https://us.cloud.langfuse.com' },
];
const promptSync = { available: false, enabled: false };

function renderLangfuse(overrides: Partial<t.FieldRendererProps> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: t.FieldRendererProps = {
    fields: [],
    parentValue: {},
    parentPath: 'langfuse',
    getValue: (_path, fallback) => fallback,
    onChange: vi.fn(),
    ...overrides,
  };
  const result = render(
    <QueryClientProvider client={queryClient}>
      <LangfuseRenderer {...props} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

/**
 * Verifies on a later task, as a request does, so every verification is in
 * flight (controls disabled, Save reading "Checking") before it settles. With
 * an already-resolved promise that window was usually too short to see, so a
 * test that acted inside it failed only under load.
 */
function verifyOnNextTask(): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    setTimeout(() => resolve({ success: true }), 0);
  });
}

/**
 * Renders a saved connection and waits until the verification the renderer
 * starts on load has settled and released the controls.
 */
async function renderVerified(status: TLangfuseConnectionStatus) {
  mockGet.mockResolvedValue(status);
  const view = renderLangfuse();
  expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
  expect(mockTest).toHaveBeenCalledTimes(1);
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ configured: false, enabled: false, destinations, promptSync });
  mockTest.mockImplementation(verifyOnNextTask);
});

describe('LangfuseRenderer', () => {
  it('loads the deployment-approved destinations from LibreChat', async () => {
    renderLangfuse();
    const destination = await screen.findByLabelText('com_config_langfuse_destination');
    expect(destination).toHaveValue('');
    expect(screen.getByRole('option', { name: 'eu - https://cloud.langfuse.com' })).toBeVisible();
    expect(
      screen.getByRole('option', { name: 'us - https://us.cloud.langfuse.com' }),
    ).toBeVisible();
    expect(screen.getByPlaceholderText('pk-lf-...')).toBeVisible();
    expect(screen.getByPlaceholderText('sk-lf-...')).toBeVisible();
    expect(screen.getByRole('button', { name: 'com_ui_cancel' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_enable' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_disable' }),
    ).not.toBeInTheDocument();
  });

  it('shows masked keys and verifies a configured connection on load', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-1234567890abcdef',
      secretKeyPreview: 'sk-lf-...515f',
    });
    renderLangfuse();

    expect(await screen.findByText('pk-lf-...cdef')).toBeVisible();
    expect(screen.getByText('sk-lf-...515f')).toBeVisible();
    await waitFor(() =>
      expect(mockTest).toHaveBeenCalledWith({
        data: { destination: 'eu', publicKey: 'pk-lf-1234567890abcdef' },
      }),
    );
    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
  });

  it('names each stored key by its label and masked value, and its text field by its label', async () => {
    await renderVerified({
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-1234567890abcdef',
      secretKeyPreview: 'sk-lf-...515f',
    });

    const publicKey = screen.getByRole('button', { name: /^Public key pk-lf-/ });
    expect(publicKey).toHaveAccessibleName('Public key pk-lf-...cdef');
    expect(publicKey).toHaveAccessibleDescription('Edit');
    expect(screen.getByRole('button', { name: 'Secret key sk-lf-...515f' })).toBeVisible();

    fireEvent.click(publicKey);
    expect(screen.getByRole('textbox', { name: 'Public key' })).toHaveValue(
      'pk-lf-1234567890abcdef',
    );
    fireEvent.click(screen.getByRole('button', { name: /^Secret key sk-lf-/ }));
    expect(screen.getByRole('textbox', { name: 'Secret key' })).toHaveValue('');
  });

  it('holds the connection controls until the stored connection is verified', async () => {
    let resolveVerification: ((result: { success: boolean }) => void) | undefined;
    mockTest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVerification = resolve;
        }),
    );
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      secretKeyPreview: 'sk-lf-...515f',
    });
    renderLangfuse();

    expect(await screen.findByText('com_config_langfuse_checking')).toBeVisible();
    const editPublicKey = screen.getByRole('button', { name: /^Public key pk-lf-/ });
    const editSecretKey = screen.getByRole('button', { name: /^Secret key sk-lf-/ });
    const disable = screen.getByRole('button', { name: 'com_config_langfuse_disable' });
    expect(editPublicKey).toBeDisabled();
    expect(editSecretKey).toBeDisabled();
    expect(disable).toBeDisabled();

    await act(async () => resolveVerification?.({ success: true }));

    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
    expect(editPublicKey).toBeEnabled();
    expect(editSecretKey).toBeEnabled();
    expect(disable).toBeEnabled();
  });

  it('shows a configured connection as unverified without verifying it for read-only (disabled) viewers', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-1234567890abcdef',
      secretKeyPreview: 'sk-lf-...515f',
    });
    renderLangfuse({ disabled: true });

    expect(await screen.findByText('pk-lf-...cdef')).toBeVisible();
    expect(await screen.findByText('com_config_langfuse_not_verified')).toBeVisible();
    expect(screen.queryByText('com_config_langfuse_not_configured')).not.toBeInTheDocument();
    expect(mockTest).not.toHaveBeenCalled();
  });

  it('keeps the disable action available when the stored destination is no longer allowlisted', async () => {
    mockGet.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'removed-region',
      publicKey: 'pk-lf-1234567890abcdef',
      secretKeyPreview: 'sk-lf-...515f',
    });
    renderLangfuse();

    expect(
      await screen.findByRole('button', { name: 'com_config_langfuse_disable' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).not.toBeInTheDocument();
  });

  it('verifies then saves a new connection through the dedicated API', async () => {
    mockUpdate.mockResolvedValue({
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-new',
      secretKeyPreview: 'sk-lf-...cret',
    });
    renderLangfuse();

    fireEvent.change(await screen.findByLabelText('com_config_langfuse_destination'), {
      target: { value: 'eu' },
    });
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-secret' },
    });
    const saveButton = screen.getByRole('button', {
      name: 'com_config_langfuse_save_and_enable',
    });
    await waitFor(() => expect(saveButton).toBeEnabled());
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(mockTest).toHaveBeenLastCalledWith({
        data: { destination: 'eu', publicKey: 'pk-lf-new', secretKey: 'sk-lf-secret' },
      }),
    );
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: {
          enabled: true,
          destination: 'eu',
          publicKey: 'pk-lf-new',
          secretKey: 'sk-lf-secret',
        },
      }),
    );
  });

  it('preserves the stored secret when only the public key is edited', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-old',
      secretKeyPreview: 'sk-lf-...515f',
    };
    mockUpdate.mockResolvedValue({ ...configuredStatus, publicKey: 'pk-lf-new' });
    const { queryClient } = await renderVerified(configuredStatus);

    fireEvent.click(screen.getByRole('button', { name: /^Public key pk-lf-/ }));
    expect(screen.getByRole('button', { name: 'com_ui_cancel' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'com_config_langfuse_disable' }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: { enabled: true, destination: 'eu', publicKey: 'pk-lf-new' },
      }),
    );
    await waitFor(() =>
      expect(queryClient.getQueryData(LANGFUSE_CONNECTION_QUERY_KEY)).toEqual({
        ...configuredStatus,
        publicKey: 'pk-lf-new',
      }),
    );
  });

  it('preserves draft fields when shared connection data refreshes', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-stored',
      secretKeyPreview: 'sk-lf-...515f',
    };
    const { queryClient } = await renderVerified(configuredStatus);

    fireEvent.click(screen.getByRole('button', { name: /^Public key pk-lf-/ }));
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-draft' },
    });

    act(() => {
      queryClient.setQueryData(LANGFUSE_CONNECTION_QUERY_KEY, {
        ...configuredStatus,
        destination: 'us',
        publicKey: 'pk-lf-refetched',
      });
    });

    expect(screen.getByPlaceholderText('pk-lf-...')).toHaveValue('pk-lf-draft');
    expect(screen.getByLabelText('com_config_langfuse_destination')).toHaveValue('eu');
    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();
    expect(mockTest).toHaveBeenCalledTimes(1);
  });

  it('retries a transient mount verification failure after the connection refreshes', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-stored',
      secretKeyPreview: 'sk-lf-...515f',
    };
    mockGet.mockResolvedValue(configuredStatus);
    mockTest.mockRejectedValueOnce(new Error('Langfuse is temporarily unavailable'));
    mockTest.mockResolvedValueOnce({ success: true });
    const { queryClient } = renderLangfuse();

    expect(await screen.findByText('Langfuse is temporarily unavailable')).toBeVisible();
    expect(mockTest).toHaveBeenCalledTimes(1);

    act(() => {
      queryClient.setQueryData(LANGFUSE_CONNECTION_QUERY_KEY, { ...configuredStatus });
    });

    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
    expect(mockTest).toHaveBeenCalledTimes(2);
  });

  it('ignores an in-flight verification result after a key edit', async () => {
    let resolveVerification: ((result: { success: boolean }) => void) | undefined;
    mockTest.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVerification = resolve;
        }),
    );
    renderLangfuse();

    fireEvent.change(await screen.findByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-old' },
    });
    fireEvent.change(screen.getByPlaceholderText('sk-lf-...'), {
      target: { value: 'sk-lf-secret' },
    });
    fireEvent.change(screen.getByLabelText('com_config_langfuse_destination'), {
      target: { value: 'eu' },
    });
    await waitFor(() => expect(mockTest).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();

    await act(async () => resolveVerification?.({ success: true }));

    expect(screen.getByText('com_config_langfuse_not_verified')).toBeVisible();
    expect(screen.queryByText('com_config_langfuse_verified')).not.toBeInTheDocument();
  });

  it('disables a saved connection without re-verifying credentials', async () => {
    const configuredStatus = {
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      secretKeyPreview: 'sk-lf-...515f',
    };
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: false });
    await renderVerified(configuredStatus);
    mockTest.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_disable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: { enabled: false, destination: 'eu', publicKey: 'pk-lf-existing' },
      }),
    );
    expect(mockTest).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'com_config_langfuse_enable' })).toBeEnabled();
  });

  it('enables a saved connection without re-verifying credentials', async () => {
    const configuredStatus = {
      configured: true,
      enabled: false,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      secretKeyPreview: 'sk-lf-...515f',
    };
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: true });
    await renderVerified(configuredStatus);
    mockTest.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_enable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: { enabled: true, destination: 'eu', publicKey: 'pk-lf-existing' },
      }),
    );
    expect(mockTest).not.toHaveBeenCalled();
    expect(
      await screen.findByRole('button', { name: 'com_config_langfuse_disable' }),
    ).toBeEnabled();
  });

  it('enables a disabled connection when credential edits are saved with Save & enable', async () => {
    const configuredStatus = {
      configured: true,
      enabled: false,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      secretKeyPreview: 'sk-lf-...515f',
    };
    mockUpdate.mockResolvedValue({ ...configuredStatus, enabled: true, publicKey: 'pk-lf-new' });
    await renderVerified(configuredStatus);

    fireEvent.click(screen.getByRole('button', { name: /^Public key pk-lf-/ }));
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-new' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        data: { enabled: true, destination: 'eu', publicKey: 'pk-lf-new' },
      }),
    );
  });

  it('re-verifies the stored connection when an invalid key edit is cancelled', async () => {
    await renderVerified({
      configured: true,
      enabled: true,
      destinations,
      promptSync,
      destination: 'eu',
      publicKey: 'pk-lf-existing',
      secretKeyPreview: 'sk-lf-...515f',
    });
    mockTest.mockResolvedValueOnce({ success: false, message: 'invalid keys' });

    fireEvent.click(screen.getByRole('button', { name: /^Public key pk-lf-/ }));
    fireEvent.change(screen.getByPlaceholderText('pk-lf-...'), {
      target: { value: 'pk-lf-invalid' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }));
    expect(await screen.findByText('invalid keys')).toBeVisible();

    mockTest.mockResolvedValueOnce({ success: true });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    expect(await screen.findByText('com_config_langfuse_verified')).toBeVisible();
    expect(mockTest).toHaveBeenLastCalledWith({
      data: { destination: 'eu', publicKey: 'pk-lf-existing' },
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('does not expose tenant-wide connection controls in a scoped editor', () => {
    renderLangfuse({ isEditingScope: true });
    expect(screen.getByText('com_config_langfuse_tenant_wide')).toBeVisible();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('disables actions when the section is read-only', async () => {
    renderLangfuse({ disabled: true });

    expect(await screen.findByRole('button', { name: 'com_ui_cancel' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'com_config_langfuse_save_and_enable' }),
    ).toBeDisabled();
  });
});
