import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { nameWords, nestedControls, visibleText } from '@/test/a11y';
import { renderTab } from '@/test/page';

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

/** A server Base adds in the admin panel, with a title beside its key. */
const OVERRIDES: t.ConfigRecord = {
  mcpServers: {
    vault: { type: 'streamable-http', url: 'https://mcp.vault.dev/mcp', title: 'Vault' },
  },
};

/** Two servers, so focus can leave one card's rename for the other card. */
const TWO_SERVERS: t.ConfigRecord = {
  mcpServers: {
    ...(OVERRIDES.mcpServers as t.ConfigRecord),
    wiki: { type: 'streamable-http', url: 'https://mcp.wiki.dev/mcp' },
  },
};

function card(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-mcp-server="${key}"]`);
  if (!element) throw new Error(`no card for ${key}`);
  return element;
}

function header(key: string): HTMLElement {
  const button = card(key).querySelector<HTMLElement>('button[aria-expanded]');
  if (!button) throw new Error(`no header for ${key}`);
  return button;
}

async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function startRename(key: string): Promise<HTMLElement> {
  const trigger = within(card(key)).getByRole('button', { name: `Actions for ${key}` });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await act(async () => {
    fireEvent.click(screen.getByRole('menuitem', { name: /^Rename/ }));
  });
  await nextFrame();
  const input = screen.getByRole('textbox', { name: `Rename ${key}` });
  expect(input).toHaveFocus();
  return input;
}

/**
 * Moves focus from `from` to `to` the way a click or Tab does in a browser:
 * React commits what the blur started, effects included, while focus is
 * still on its way (a microtask checkpoint follows every event listener),
 * and the move is dropped if that took focus.
 */
async function moveFocus(from: HTMLElement, to: HTMLElement) {
  act(() => from.blur());
  if (document.activeElement === document.body) act(() => to.focus());
  await nextFrame();
}

describe('MCP server card header', () => {
  it('is named by every word it shows, and described by the facts line beside it', () => {
    renderTab({ tab: 'mcp', overrides: OVERRIDES });
    const button = header('vault');
    expect(button).not.toHaveAttribute('aria-label');
    expect(button).toHaveAccessibleName('Vault Name: vault');
    const named = new Set(nameWords('Vault Name: vault'));
    expect(nameWords(visibleText(button)).filter((word) => !named.has(word))).toEqual([]);

    const facts = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    expect(facts).not.toBeNull();
    expect(button.contains(facts)).toBe(false);
    expect(facts).toHaveTextContent('https://mcp.vault.dev/mcp');
    expect(button).toHaveAccessibleDescription(/https:\/\/mcp\.vault\.dev\/mcp/);
    expect(nestedControls(card('vault'))).toEqual([]);
  });

  it('opens and closes the card from its header', () => {
    renderTab({ tab: 'mcp', overrides: OVERRIDES });
    const button = header('vault');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens and closes the card from its facts line, which still describes the header', () => {
    renderTab({ tab: 'mcp', overrides: OVERRIDES });
    const button = header('vault');
    const facts = document.getElementById(button.getAttribute('aria-describedby') ?? '');
    if (!facts) throw new Error('no facts line');
    const chip = facts.querySelector<HTMLElement>('.state-chip');
    expect(chip).toHaveAttribute('title');
    fireEvent.click(facts);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(chip ?? facts);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAccessibleDescription(/https:\/\/mcp\.vault\.dev\/mcp/);
  });

  it.each(['Escape', 'Enter'])(
    'gives focus back to the header when %s ends a rename that keeps the name',
    async (key) => {
      renderTab({ tab: 'mcp', overrides: OVERRIDES });
      const input = await startRename('vault');
      fireEvent.keyDown(input, { key });
      expect(screen.queryByRole('textbox', { name: 'Rename vault' })).toBeNull();
      await nextFrame();
      expect(header('vault')).toHaveFocus();
    },
  );

  it("leaves focus on another card's header when a click or Tab there ends a rename", async () => {
    renderTab({ tab: 'mcp', overrides: TWO_SERVERS });
    const input = await startRename('vault');
    await moveFocus(input, header('wiki'));
    expect(screen.queryByRole('textbox', { name: 'Rename vault' })).toBeNull();
    expect(header('wiki')).toHaveFocus();
  });

  it('leaves focus on a text field outside the card when a click there ends a rename', async () => {
    renderTab({ tab: 'mcp', overrides: OVERRIDES });
    const filter = document.createElement('input');
    filter.setAttribute('aria-label', 'Filter this tab…');
    document.body.append(filter);
    try {
      const input = await startRename('vault');
      await moveFocus(input, filter);
      expect(screen.queryByRole('textbox', { name: 'Rename vault' })).toBeNull();
      expect(filter).toHaveFocus();
    } finally {
      filter.remove();
    }
  });
});
