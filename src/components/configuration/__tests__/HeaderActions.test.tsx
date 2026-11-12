import '@/locales/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';
import { HeaderActions } from '../HeaderActions';

const PROPS: t.HeaderActionsProps = {
  showImport: false,
  importDisabled: false,
  onImportClick: vi.fn(),
  showReset: false,
  resetDisabled: false,
  onResetClick: vi.fn(),
  showScope: false,
  scopeSelection: { type: 'BASE' },
  onScopeClick: vi.fn(),
};

beforeEach(() => {
  const target = document.createElement('div');
  target.id = 'header-actions-portal';
  document.body.appendChild(target);
});

afterEach(() => {
  document.getElementById('header-actions-portal')?.remove();
});

describe('HeaderActions', () => {
  it('offers Preview, which opens the preview', () => {
    const onPreviewClick = vi.fn();
    render(<HeaderActions {...PROPS} showPreview onPreviewClick={onPreviewClick} />);
    const button = screen.getByRole('button', { name: 'Preview' });
    expect(button).toHaveAttribute('title', 'See the configuration a role, group or user gets');
    fireEvent.click(button);
    expect(onPreviewClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Configuration actions' })).toBeInTheDocument();
  });

  it('leaves Preview out until the page can show it', () => {
    render(<HeaderActions {...PROPS} onPreviewClick={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Preview' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Configuration actions' })).not.toBeInTheDocument();
  });
});
