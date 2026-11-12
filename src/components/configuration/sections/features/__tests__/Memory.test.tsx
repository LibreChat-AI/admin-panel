import { describe, it, expect } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { MemoryRenderer } from '../Memory';
import { renderSection } from './harness';
import '@/locales/i18n';

const YAML = { memory: { agent: { id: 'agent_yaml' }, messageWindowSize: 3 } };

function enableMemory() {
  return screen.getByRole('group', { name: 'Enable memory' });
}

describe('MemoryRenderer: Enable memory', () => {
  it('shows memory.disabled as a positive switch that is on while a memory block exists', () => {
    renderSection(MemoryRenderer, { section: 'memory', yaml: YAML });
    expect(within(enableMemory()).getByRole('button', { name: 'Default (On)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('defaults to off when librechat.yaml has no memory block', () => {
    renderSection(MemoryRenderer, { section: 'memory' });
    expect(within(enableMemory()).getByRole('button', { name: 'Default (Off)' })).toBeVisible();
  });

  it('defaults to on once a pending edit adds the first memory setting', () => {
    renderSection(MemoryRenderer, {
      section: 'memory',
      edited: { 'memory.agent.provider': 'openAI' },
    });
    expect(within(enableMemory()).getByRole('button', { name: 'Default (On)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reads a stored disabled: true as Off when read only', () => {
    renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: YAML,
      overrides: { memory: { disabled: true } },
      props: { disabled: true },
    });
    const row = document.getElementById('memory-disabled') as HTMLElement;
    expect(row).toHaveTextContent('Off');
    expect(row).not.toHaveTextContent('On');
  });

  it('reads an unset memory.disabled as its inverted default when read only', () => {
    renderSection(MemoryRenderer, { section: 'memory', yaml: YAML, props: { disabled: true } });
    expect(document.getElementById('memory-disabled')).toHaveTextContent('Default (On)');
  });

  it('writes the inverted value: Off stores disabled true, On stores disabled false', () => {
    const { onChange } = renderSection(MemoryRenderer, { section: 'memory', yaml: YAML });
    fireEvent.click(within(enableMemory()).getByRole('button', { name: 'Off' }));
    expect(onChange).toHaveBeenLastCalledWith('memory.disabled', true);
    fireEvent.click(within(enableMemory()).getByRole('button', { name: 'On' }));
    expect(onChange).toHaveBeenLastCalledWith('memory.disabled', false);
  });

  it('shows a stored disabled: true as Off', () => {
    renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: YAML,
      overrides: { memory: { disabled: true } },
    });
    expect(within(enableMemory()).getByRole('button', { name: 'Off' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('MemoryRenderer: memory agent', () => {
  it('shows only the definition in use: the librechat.yaml agent ID', () => {
    renderSection(MemoryRenderer, { section: 'memory', yaml: YAML });
    expect(screen.getByRole('button', { name: 'Existing agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Agent ID')).toHaveValue('agent_yaml');
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
  });

  it('switching to a provider and model hides the librechat.yaml ID and shows the inline fields', () => {
    const { onHideField, onChange } = renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: YAML,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Provider and model' }));
    expect(onHideField).toHaveBeenCalledWith('memory.agent.id');
    expect(onChange).not.toHaveBeenCalledWith('memory.agent.id', undefined);
    expect(screen.getByLabelText('Provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toBeInTheDocument();
    expect(screen.queryByLabelText('Agent ID')).not.toBeInTheDocument();
  });

  it('switching back before saving undoes the hide and drops the inline values', () => {
    const { onDiscardField } = renderSection(MemoryRenderer, { section: 'memory', yaml: YAML });
    fireEvent.click(screen.getByRole('button', { name: 'Provider and model' }));
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openAI' } });
    fireEvent.blur(screen.getByLabelText('Provider'));
    fireEvent.click(screen.getByRole('button', { name: 'Existing agent' }));
    expect(onDiscardField).toHaveBeenCalledWith('memory.agent.id');
    expect(onDiscardField).toHaveBeenCalledWith('memory.agent.provider');
    expect(screen.getByLabelText('Agent ID')).toHaveValue('agent_yaml');
  });

  it('switching back before saving keeps an agent ID the edit target stores', () => {
    const { onChange, onDiscardField } = renderSection(MemoryRenderer, {
      section: 'memory',
      overrides: { memory: { agent: { id: 'agent_admin' } } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Provider and model' }));
    expect(onChange).toHaveBeenCalledWith('memory.agent.id', undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Existing agent' }));
    expect(onDiscardField).toHaveBeenCalledWith('memory.agent.id');
    expect(screen.getByLabelText('Agent ID')).toHaveValue('agent_admin');
  });

  it('keeps a newly edited agent under "Set values only"', () => {
    renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: { memory: { messageWindowSize: 3 } },
      edited: { 'memory.agent.provider': 'openAI' },
      props: { showConfiguredOnly: true },
    });
    expect(screen.getByLabelText('Provider')).toBeInTheDocument();
  });

  it('forgets a definition chosen without values when the edit session ends', () => {
    const { startNewSession } = renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: { memory: { messageWindowSize: 3 } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Provider and model' }));
    expect(screen.getByLabelText('Provider')).toBeInTheDocument();
    startNewSession();
    expect(screen.queryByLabelText('Provider')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Provider and model' })).not.toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('explains a pending hide, and reads a queued hide as the inline definition', () => {
    renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: YAML,
      edited: { 'memory.agent.provider': 'openAI' },
      visibility: { 'memory.agent.id': 'hide' },
    });
    expect(screen.getByRole('button', { name: 'Provider and model' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText(/Saving hides Agent ID from librechat\.yaml/)).toBeInTheDocument();
  });

  it('says only librechat.yaml can switch it when the ID cannot be hidden here', () => {
    const { onChange } = renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: YAML,
      props: { onHideField: undefined },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Provider and model' }));
    expect(screen.getByRole('status')).toHaveTextContent(
      'librechat.yaml defines this agent, and only librechat.yaml can change how it is defined.',
    );
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Agent ID')).toBeInTheDocument();
  });

  it('switching back to the librechat.yaml ID after the inline agent was saved unhides the ID', () => {
    const { onUnhideField, onChange, onHideField } = renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: YAML,
      overrides: { memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } } },
      tombstones: ['memory.agent.id'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Existing agent' }));
    expect(onUnhideField).toHaveBeenCalledWith('memory.agent.id');
    expect(onChange).toHaveBeenCalledWith('memory.agent.provider', undefined);
    expect(onChange).toHaveBeenCalledWith('memory.agent.model', undefined);
    expect(onHideField).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Existing agent' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Agent ID')).toHaveValue('agent_yaml');
  });

  it('reads a stored tombstone as hidden and offers to revert the whole agent', () => {
    const { onResetField } = renderSection(MemoryRenderer, {
      section: 'memory',
      yaml: YAML,
      overrides: { memory: { agent: { provider: 'openAI', model: 'gpt-4o-mini' } } },
      tombstones: ['memory.agent.id'],
    });
    expect(screen.getByLabelText('Provider')).toHaveValue('openAI');
    expect(screen.getByText(/Agent ID from librechat\.yaml is hidden here/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /^Revert to librechat\.yaml \(.*\): Agent$/ }),
    );
    expect(onResetField).toHaveBeenCalledWith('memory.agent');
  });
});
