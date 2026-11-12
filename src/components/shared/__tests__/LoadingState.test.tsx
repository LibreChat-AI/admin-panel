import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoadingState } from '../LoadingState';
import '@/locales/i18n';

describe('LoadingState', () => {
  it('is a status that reads "Loading…", without the spinner icon\'s name', () => {
    render(<LoadingState />);
    expect(screen.getByRole('status')).toHaveTextContent(/^Loading…$/);
    expect(screen.getByRole('status')).toHaveAccessibleName('');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('keeps the status role with a caller-styled layout', () => {
    render(<LoadingState className="py-6" />);
    expect(screen.getByRole('status')).toHaveClass('py-6');
  });
});
