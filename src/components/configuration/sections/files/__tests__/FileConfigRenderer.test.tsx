import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { renderSections, SectionsHarness } from '@/test/sections';

function addKey(text: string) {
  const input = screen.getByRole('combobox', { name: 'Key' });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('FileConfigRenderer', () => {
  it('adds per-endpoint limits only for keys LibreChat looks up', async () => {
    const onChange = vi.fn();
    renderSections({
      sections: ['fileConfig'],
      yaml: { endpoints: { custom: [{ name: 'Ollama', baseURL: 'http://x' }] } },
      onChange,
    });
    const group = document.getElementById('section-fileConfig.endpoints')!;
    fireEvent.click(within(group).getByRole('button', { name: 'Add endpoint' }));
    await screen.findByRole('combobox', { name: 'Key' });
    const options = [...document.querySelectorAll('#fileConfig-endpoints-keys option')].map(
      (option) => option.getAttribute('value'),
    );
    expect(options).toEqual(expect.arrayContaining(['default', 'agents', 'custom', 'Ollama']));

    addKey('Agents');
    expect(screen.getByRole('alert')).toHaveTextContent('Did you mean agents?');
    addKey('agentz');
    expect(screen.getByRole('alert')).toHaveTextContent('no endpoint named agentz');
    expect(onChange).not.toHaveBeenCalled();
    addKey('Ollama');
    expect(onChange).toHaveBeenCalledWith('fileConfig.endpoints', { Ollama: {} });
  });

  it('keeps a pending endpoint limit under "Set values only"', async () => {
    const { rerender } = render(<SectionsHarness sections={['fileConfig']} />);
    const group = document.getElementById('section-fileConfig.endpoints')!;
    fireEvent.click(within(group).getByRole('button', { name: 'Add endpoint' }));
    await screen.findByRole('combobox', { name: 'Key' });
    addKey('agents');
    rerender(<SectionsHarness sections={['fileConfig']} showConfiguredOnly />);
    expect(document.getElementById('section-fileConfig.endpoints')).not.toBeNull();
  });

  it('uses the MIME list editor, with plain group names', () => {
    renderSections({ sections: ['fileConfig'] });
    expect(screen.getByText('Text-extraction MIME types')).toBeInTheDocument();
    expect(screen.getByText('OCR-eligible MIME types')).toBeInTheDocument();
  });
});
