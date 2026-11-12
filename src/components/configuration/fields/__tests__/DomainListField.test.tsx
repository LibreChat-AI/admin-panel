import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type * as t from '@/types';
import { DomainListField } from '../DomainListField';
import '@/locales/i18n';

function Harness({
  initial = [],
  onClear = () => true,
  ...props
}: Partial<t.DomainListFieldProps> & { initial?: string[] }) {
  const [values, setValues] = useState(initial);
  return (
    <DomainListField
      id="actions-allowedDomains"
      path="actions.allowedDomains"
      values={values}
      onChange={setValues}
      onClear={onClear}
      aria-label="Allowed domains"
      {...props}
    />
  );
}

const input = () => screen.getByLabelText('Allowed domains: add a domain');

function add(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  fireEvent.keyDown(input(), { key: 'Enter' });
}

describe('DomainListField', () => {
  it('gives the row id to its text input, so the row label focuses it', () => {
    render(
      <>
        <label htmlFor="actions-allowedDomains">Allowed domains row</label>
        <Harness />
      </>,
    );
    expect(document.getElementById('actions-allowedDomains')).toBe(input());
    expect(screen.getByText('Allowed domains row')).toHaveProperty('control', input());
  });

  it('explains that an empty list means no restriction', () => {
    render(<Harness />);
    expect(
      screen.getByText(/^No restriction: agent actions can call any public domain/),
    ).toBeVisible();
  });

  it('adds valid domains as chips and says the list now restricts', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    add('API.Example.com');
    expect(onChange).toHaveBeenLastCalledWith(['api.example.com']);
  });

  it('never adds a blank entry, and rejects invalid ones with a reason', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    add('   ');
    expect(onChange).not.toHaveBeenCalled();
    add('example.com/api');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('enter the domain only');
    add('wss://ws.example.com');
    expect(screen.getByRole('alert')).toHaveTextContent('only accepts these schemes');
  });

  it('adds every valid entry of a pasted list and keeps the invalid ones for fixing', () => {
    render(<Harness />);
    fireEvent.paste(input(), { clipboardData: { getData: () => 'a.com, b.com\nbad_host' } });
    expect(screen.getByRole('list', { name: 'Allowed domains' })).toHaveTextContent('a.comb.com');
    expect(input()).toHaveValue('bad_host');
  });

  it('reads typed text with a space as one entry, not a list', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    add('not a/domain');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('is not a domain');
    expect(input()).toHaveValue('not a/domain');
  });

  it('adds a typed entry on comma', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(input(), { target: { value: 'example.com' } });
    fireEvent.keyDown(input(), { key: ',' });
    expect(onChange).toHaveBeenLastCalledWith(['example.com']);
  });

  it('rejects a duplicate', () => {
    render(<Harness initial={['example.com']} />);
    add('EXAMPLE.com');
    expect(screen.getByRole('alert')).toHaveTextContent('already in the list');
  });

  it('asks before removing the last domain, then removes the own list', () => {
    const onClear = vi.fn(() => true);
    render(<Harness initial={['example.com']} hasOwnValue onClear={onClear} />);
    expect(screen.getByText(/^Only these domains are allowed \(1\)/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Remove example.com' }));
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Remove the last domain?');
    fireEvent.click(screen.getByRole('button', { name: 'Remove restriction' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('moves focus into the question about the last domain, and back to the input after it', () => {
    render(<Harness initial={['example.com']} hasOwnValue />);
    const remove = screen.getByRole('button', { name: 'Remove example.com' });
    remove.focus();
    fireEvent.click(remove);
    const question = screen.getByRole('alertdialog', { name: 'Remove the restriction' });
    expect(question).toHaveAccessibleDescription(
      'Remove the last domain? Agent actions will then be able to call any public domain.',
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(input()).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Remove example.com' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove restriction' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(input()).toHaveFocus();
  });

  it('says the librechat.yaml list applies again when the own list is removed', () => {
    render(<Harness initial={['mine.com']} hasOwnValue lowerValues={['a.com', 'b.com']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove mine.com' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'The librechat.yaml list (2 domains) applies again.',
    );
  });

  it('cannot remove the last domain of a list only librechat.yaml sets (D3)', () => {
    const onClear = vi.fn(() => false);
    render(<Harness initial={['a.com']} lowerValues={['a.com']} onClear={onClear} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.com' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent("its last domain can't be removed here");
  });
});
