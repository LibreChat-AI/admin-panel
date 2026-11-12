import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { extractSchemaTree } from '@/server/config';
import { CreateMcpServerDialog } from '../Create';

const fields =
  extractSchemaTree(configSchema as t.ZodSchemaLike).find((field) => field.key === 'mcpServers')
    ?.children ?? [];

const DOTTED_KEYS: t.ConfigContract = {
  ...BUNDLED_CONFIG_CONTRACT,
  features: { ...BUNDLED_CONFIG_CONTRACT.features, dottedKeys: true },
};

const NONE: ReadonlySet<string> = new Set();

describe('CreateMcpServerDialog — dotted user variable names (dottedKeys)', () => {
  it('names a dotted variable whole in what is still needed, then creates it as one record', async () => {
    const onCreate = vi.fn();
    render(
      <ConfigContractContext.Provider value={DOTTED_KEYS}>
        <CreateMcpServerDialog
          open
          onClose={vi.fn()}
          onCreate={onCreate}
          onOverride={vi.fn()}
          onUnhide={vi.fn()}
          fields={fields}
          existingKeys={NONE}
          inheritedKeys={NONE}
          hiddenKeys={NONE}
        />
      </ConfigContractContext.Provider>,
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByPlaceholderText('e.g. github or acme-docs'), {
      target: { value: 'vars' },
    });
    const url = dialog.querySelector<HTMLInputElement>('#mcpDraft-url input, input#mcpDraft-url');
    if (!url) throw new Error('no URL input');
    fireEvent.change(url, { target: { value: 'https://mcp.example.com/vars' } });
    fireEvent.blur(url);
    fireEvent.click(within(dialog).getByRole('button', { name: /User variables/ }));
    const vars = dialog.querySelector<HTMLElement>('#mcpDraft-customUserVars');
    if (!vars) throw new Error('no user variables editor');
    fireEvent.click(within(vars).getByRole('button', { name: /^Add ./ }));
    fireEvent.change(within(vars).getByRole('textbox', { name: 'Key' }), {
      target: { value: 'MY.TOKEN' },
    });
    fireEvent.click(within(vars).getByRole('button', { name: 'Add' }));

    const create = within(dialog).getByRole('button', { name: 'Create' });
    expect(create).toBeDisabled();
    const needed = within(dialog).getByText(/Still needed:/);
    expect(needed).toHaveTextContent(/User variables › MY\.TOKEN › /);
    expect(needed).not.toHaveTextContent(/› MY ›/);

    for (const [leaf, value] of [
      ['title', 'Token'],
      ['description', 'Your token'],
    ]) {
      const input = vars.querySelector<HTMLInputElement>(
        `input[id$="-${leaf}"], [id$="-${leaf}"] input, textarea[id$="-${leaf}"]`,
      );
      if (!input) throw new Error(`no ${leaf} input`);
      fireEvent.change(input, { target: { value } });
      fireEvent.blur(input);
    }
    expect(create).toBeEnabled();
    await act(async () => {
      fireEvent.click(create);
    });
    expect(onCreate).toHaveBeenCalledWith(
      'vars',
      expect.objectContaining({
        customUserVars: { 'MY.TOKEN': { title: 'Token', description: 'Your token' } },
      }),
    );
  });
});
