import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { PermissionTypes } from 'librechat-data-provider';
import { RolePermissionsPanel } from '../RolePermissionsPanel';
import { defaultPermissions } from '@/constants';
import { nestedControls } from '@/test/a11y';

vi.mock('@/hooks', () => ({ useLocalize: () => (key: string) => key }));

const PROMPTS = `com_perm_type_${PermissionTypes.PROMPTS}`;

describe('RolePermissionsPanel permission headers', () => {
  it('puts each Select all switch beside its permission toggle, not inside it', () => {
    const { container } = render(
      <RolePermissionsPanel permissions={defaultPermissions()} onChange={vi.fn()} />,
    );

    expect(nestedControls(container)).toEqual([]);
    expect(screen.getByRole('switch', { name: `${PROMPTS}: com_ui_select_all` })).toBeVisible();
  });

  it('opens a permission type from its toggle and turns it all on from Select all', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<RolePermissionsPanel permissions={defaultPermissions()} onChange={onChange} />);
    const toggle = screen.getByRole('button', { name: new RegExp(`^${PROMPTS}`) });

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(screen.getByRole('switch', { name: `${PROMPTS}: com_ui_select_all` }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ [PermissionTypes.PROMPTS]: expect.any(Object) }),
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
