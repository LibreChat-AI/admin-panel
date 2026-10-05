import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ImportYamlDialog } from '../ImportYamlDialog';
import { parseImportedYaml } from '@/server';

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options?.name ? `${key}:${options.name}` : key,
}));

vi.mock('@/server', () => ({
  parseImportedYaml: vi.fn(),
  createRoleFn: vi.fn(),
  createGroupFn: vi.fn(),
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: () => Promise.resolve([]) },
}));

interface ButtonProps {
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
}

vi.mock('@clickhouse/click-ui', () => ({
  Button: ({ label, disabled, onClick }: ButtonProps) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
  Icon: () => null,
  Dialog: Object.assign(
    ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    {
      Content: ({ title, children }: { title: string; children: ReactNode }) => (
        <div role="dialog" aria-label={title}>
          {children}
        </div>
      ),
    },
  ),
  Tabs: Object.assign(({ children }: { children: ReactNode }) => <div>{children}</div>, {
    TriggersList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Trigger: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  }),
}));

const mockParse = vi.mocked(parseImportedYaml);
const userScope: t.ConfigScope = {
  _id: 'cfg-user',
  principalType: PrincipalType.ROLE,
  principalId: 'USER',
  name: 'USER',
  priority: 10,
  isActive: true,
};
const parsed = { balance: { startBalance: 777 } };

function renderDialog(currentScope?: t.ConfigScope) {
  const onImport = vi.fn<t.ImportYamlDialogProps['onImport']>().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ImportYamlDialog open onClose={onClose} currentScope={currentScope} onImport={onImport} />
    </QueryClientProvider>,
  );
  return { onImport, onClose };
}

async function validate() {
  fireEvent.change(screen.getByLabelText('com_config_import_paste'), {
    target: { value: 'balance:\n  startBalance: 777\n' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'com_config_import_validate' }));
  await screen.findByRole('radiogroup');
}

describe('ImportYamlDialog target routing', () => {
  beforeEach(() => {
    const result: t.ImportParseResult = { success: true, appConfig: parsed, unknownPaths: [] };
    mockParse.mockResolvedValue(result);
  });

  it('imports into base when no profile is open', async () => {
    const { onImport, onClose } = renderDialog();
    await validate();
    expect(screen.queryByText('com_config_import_as_current:USER')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_import_apply' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(parsed, { type: 'base' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('preselects the open profile as the target', async () => {
    const { onImport } = renderDialog(userScope);
    await validate();
    expect(
      screen.getByRole('radio', { name: /com_config_import_as_current:USER/ }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'com_config_import_apply' }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(parsed, { type: 'scope', scope: userScope }),
    );
  });

  it('writes to base when Base is chosen while a profile is open', async () => {
    const { onImport } = renderDialog(userScope);
    await validate();
    fireEvent.click(screen.getByRole('radio', { name: /^com_config_import_as_base/ }));
    fireEvent.click(screen.getByRole('button', { name: 'com_config_import_apply' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledWith(parsed, { type: 'base' }));
  });

  it('keeps the dialog open and shows the reason when the import is rejected', async () => {
    const { onImport, onClose } = renderDialog();
    onImport.mockRejectedValueOnce(new Error('Validation failed — balance.startBalance'));
    await validate();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_import_apply' }));
    expect(await screen.findByText('Validation failed — balance.startBalance')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
