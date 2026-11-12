import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import { CAPABILITY_CATEGORIES, CapabilityImplications, SystemCapabilities } from '@/constants';
import { CapabilityPanel } from '../CapabilityPanel';
import { nestedControls } from '@/test/a11y';
import { ruleBody } from '@/test/styles';

vi.mock('@/hooks', () => ({ useLocalize: () => (key: string) => key }));

const USERS = CAPABILITY_CATEGORIES.find((category) => category.key === 'users');
if (!USERS) throw new Error('no Users capability category');

function renderPanel() {
  const onChange = vi.fn();
  const { container } = render(<CapabilityPanel capabilities={{}} onChange={onChange} />);
  return { container, onChange };
}

const usersToggle = () => screen.getByRole('button', { name: USERS.labelKey });
const usersSwitches = () =>
  USERS.capabilities.map((cap) => `${USERS.labelKey}: com_cap_${cap.replace(/:/g, '_')}`);

describe('CapabilityPanel category headers', () => {
  it('puts each Select all switch beside its category toggle, not inside it', () => {
    const { container } = renderPanel();

    expect(nestedControls(container)).toEqual([]);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(
      CAPABILITY_CATEGORIES.length,
    );
    expect(
      screen.getByRole('switch', { name: `${USERS.labelKey}: com_ui_select_all` }),
    ).toBeInTheDocument();
  });

  it('rings each category toggle inside its card', () => {
    renderPanel();

    expect(usersToggle()).toHaveClass('select-all-toggle');
    expect(ruleBody('.select-all-toggle:focus-visible')).toBe(
      'outline-offset: calc(-1 * var(--focus-ring-width)) !important;',
    );
  });

  it.each([
    ['a click', (user: ReturnType<typeof userEvent.setup>) => user.click(usersToggle())],
    ['Enter', (user: ReturnType<typeof userEvent.setup>) => user.keyboard('{Enter}')],
    ['Space', (user: ReturnType<typeof userEvent.setup>) => user.keyboard(' ')],
  ])('opens and closes a category with %s on its toggle', async (_, press) => {
    const user = userEvent.setup();
    renderPanel();
    usersToggle().focus();

    await press(user);
    expect(usersToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(usersToggle()).toHaveAttribute('aria-controls', 'cap-group-users');
    for (const name of usersSwitches()) {
      expect(screen.getByRole('switch', { name })).toBeInTheDocument();
    }

    await press(user);
    expect(usersToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('switch', { name: usersSwitches()[0] })).toBeNull();
  });

  it('turns the whole category on from Select all without opening it', async () => {
    const user = userEvent.setup();
    const { onChange } = renderPanel();

    await user.click(screen.getByRole('switch', { name: `${USERS.labelKey}: com_ui_select_all` }));

    expect(onChange).toHaveBeenCalledWith(
      Object.fromEntries(USERS.capabilities.map((cap) => [cap, true])),
    );
    expect(usersToggle()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('CapabilityPanel implied capabilities', () => {
  it("notes a capability another one implies without reading out its icon's name", async () => {
    const user = userEvent.setup();
    const implied = CapabilityImplications[SystemCapabilities.MANAGE_USERS] ?? [];
    expect(implied.length).toBeGreaterThan(0);
    render(
      <CapabilityPanel
        capabilities={{ [SystemCapabilities.MANAGE_USERS]: true }}
        onChange={vi.fn()}
      />,
    );
    await user.click(usersToggle());

    expect(screen.getAllByText('com_cap_implied_by')).toHaveLength(implied.length);
    expect(screen.queryAllByRole('img')).toEqual([]);
  });
});
