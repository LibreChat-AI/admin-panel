import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { MimeListField } from '../MimeListField';
import { DEFAULT_MIME_LISTS } from '@/utils';

const PATH = 'fileConfig.endpoints.agents.supportedMimeTypes';
const DEFAULTS: t.InheritedMimeList = {
  patterns: [...DEFAULT_MIME_LISTS.endpoint],
  origin: 'runtimeDefault',
};

function renderField(props: Partial<t.MimeListFieldProps> = {}) {
  const onChange = vi.fn();
  const onClear = vi.fn(() => true);
  render(
    <MimeListField
      id="mime"
      path={PATH}
      value={undefined}
      inherited={DEFAULTS}
      onChange={onChange}
      onClear={onClear}
      aria-label="Supported MIME types"
      {...props}
    />,
  );
  return { onChange, onClear };
}

function addPattern(pattern: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add pattern' }));
  const input = screen.getByRole('textbox', { name: 'New MIME type pattern' });
  fireEvent.change(input, { target: { value: pattern } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('MimeListField', () => {
  it('shows the list in effect and where it comes from, by friendly name', () => {
    renderField();
    expect(screen.getByText("Uses LibreChat's default list (8 patterns).")).toBeInTheDocument();
    expect(screen.getByText('Images (JPEG, PNG, GIF, WebP, HEIC)')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Pattern 1/ })).not.toBeInTheDocument();
  });

  it('customizes from the list in effect, so adding a type extends it', () => {
    const { onChange } = renderField();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(screen.getAllByRole('textbox', { name: /^Pattern \d/ })).toHaveLength(8);
    expect(screen.getAllByRole('textbox', { name: /^Pattern \d/ })[0]).toHaveFocus();
    addPattern('application/x-custom');
    expect(onChange).toHaveBeenCalledWith([...DEFAULT_MIME_LISTS.endpoint, 'application/x-custom']);
  });

  it('refuses invalid, server-unsupported and duplicate patterns inline', () => {
    const { onChange } = renderField({ value: ['image/.*'] });
    addPattern('text/(plain');
    expect(screen.getByRole('alert')).toHaveTextContent('Not a valid regular expression.');
    const input = screen.getByRole('textbox', { name: 'New MIME type pattern' });
    fireEvent.change(input, { target: { value: '^(?!image).*$' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent(/lookarounds or backreferences/);
    fireEvent.change(input, { target: { value: 'image/.*' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('already in the list');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits an edited pattern on Enter, not while typing', () => {
    const { onChange } = renderField({ value: ['image/.*', 'application/pdf'] });
    const row = screen.getByRole('textbox', { name: 'Pattern 1' });
    row.focus();
    fireEvent.change(row, { target: { value: '.' } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.change(row, { target: { value: 'image/png' } });
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['image/png', 'application/pdf']);
    expect(row).toHaveFocus();
  });

  it('asks before a pattern that matches every file type', () => {
    const { onChange } = renderField({ value: ['image/.*'] });
    addPattern('.*');
    const dialog = screen.getByRole('dialog', { name: 'Match every file type?' });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add it anyway' }));
    expect(onChange).toHaveBeenCalledWith(['image/.*', '.*']);
  });

  it('asks before emptying the list, offering the default list instead', () => {
    const { onChange, onClear } = renderField({ value: ['image/.*'] });
    fireEvent.click(screen.getByRole('button', { name: 'Remove image/.*' }));
    const dialog = screen.getByRole('dialog', { name: 'Accept no file types?' });
    expect(dialog).toHaveTextContent('every upload to this endpoint is rejected');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept no file types' }));
    expect(onChange).toHaveBeenCalledWith([]);

    fireEvent.click(screen.getByRole('button', { name: 'Remove image/.*' }));
    fireEvent.click(screen.getByRole('button', { name: "Use LibreChat's default list" }));
    expect(onClear).toHaveBeenCalled();
  });

  it('asks before emptying the list even when the list beneath is explicitly empty', () => {
    const { onChange, onClear } = renderField({
      value: ['image/.*'],
      inherited: { patterns: [], origin: 'yaml' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove image/.*' }));
    expect(onClear).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Accept no file types?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Accept no file types' }));
    expect(onClear).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes the own list when it goes back to the list it replaced', () => {
    const { onChange, onClear } = renderField({
      value: [...DEFAULT_MIME_LISTS.endpoint, 'application/x-custom'],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove application/x-custom' }));
    expect(onClear).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds a preset once, and says which presets are already in', () => {
    const { onChange } = renderField({ value: ['application/pdf'] });
    const presets = screen.getByRole('combobox', { name: 'Add a preset…' });
    fireEvent.change(presets, { target: { value: 'images' } });
    expect(onChange).toHaveBeenCalledWith([
      'application/pdf',
      '^image\\/(jpeg|gif|png|webp|heic|heif)$',
    ]);
  });

  it('tests a MIME type against the list', async () => {
    renderField();
    const tester = screen.getByRole('textbox', { name: 'Test a MIME type' });
    await act(async () => {
      fireEvent.change(tester, { target: { value: 'application/pdf' } });
    });
    expect(screen.getByText(/application\/pdf can be uploaded/)).toBeInTheDocument();
    fireEvent.change(tester, { target: { value: 'application/x-msdownload' } });
    expect(screen.getByText(/application\/x-msdownload can't be uploaded/)).toBeInTheDocument();
  });
});
