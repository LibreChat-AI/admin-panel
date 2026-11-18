import '@/locales/i18n';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { InlineFieldRenderer } from '../renderer/InlineField';
import { DraftsContext } from '@/contexts/DraftsContext';
import { createField } from '@/test/fixtures';
import { JumpToSelect } from '../JumpToSelect';

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderWithRecovery(children: ReactNode) {
  const content = (blocked: boolean) => (
    <DraftsContext.Provider
      value={{
        blocked,
        editSessionId: 0,
        sessionError: blocked ? 'AUTH_SESSION_CHECK_UNAVAILABLE' : null,
        recoveryError: null,
        registerDraft: vi.fn(),
        retrySession: async () => undefined,
      }}
    >
      {children}
    </DraftsContext.Provider>
  );
  const view = render(content(false));
  return { ...view, setBlocked: (blocked: boolean) => view.rerender(content(blocked)) };
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

describe('configuration popup recovery', () => {
  it('closes Jump to without navigating and keeps it closed after recovery', async () => {
    const onJump = vi.fn();
    const { container, setBlocked } = renderWithRecovery(
      <JumpToSelect targets={[{ id: 'models', label: 'Models' }]} onJump={onJump} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Jump to…/ }));
    const popup = await screen.findByRole('dialog');
    expect(container).not.toContainElement(popup);
    expect(screen.getByText('Models')).toBeVisible();

    setBlocked(true);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const blockedTrigger = screen.getByRole('button', { name: /^Jump to…/ });
    expect(blockedTrigger).toBeDisabled();
    fireEvent.click(blockedTrigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onJump).not.toHaveBeenCalled();

    setBlocked(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Jump to…/ }));
    fireEvent.click(await screen.findByText('Models'));
    expect(onJump).toHaveBeenCalledExactlyOnceWith('models');
  });

  it.each([false, true])(
    'closes Add field while preserving a sibling field draft (external trigger: %s)',
    async (externalTrigger) => {
      const fields = [
        createField({ key: 'model', path: 'modelSpecs.list.[].preset.model', isOptional: true }),
        createField({
          key: 'temperature',
          path: 'modelSpecs.list.[].preset.temperature',
          type: 'number',
          isOptional: true,
        }),
      ];
      const addFieldTriggerRef: { current: (() => void) | null } = { current: null };
      const { container, setBlocked } = renderWithRecovery(
        <>
          {externalTrigger && (
            <button onClick={() => addFieldTriggerRef.current?.()}>Show add field</button>
          )}
          <InlineFieldRenderer
            fields={fields}
            parentValue={{ model: 'initial-model' }}
            parentPath="modelSpecs.list.0.preset"
            onChange={vi.fn()}
            addFieldTriggerRef={externalTrigger ? addFieldTriggerRef : undefined}
          />
        </>,
      );
      const openPicker = () =>
        fireEvent.click(
          screen.getByRole('button', {
            name: externalTrigger ? 'Show add field' : /^Add field…/,
          }),
        );
      const draft = screen.getByLabelText('Model');
      fireEvent.change(draft, { target: { value: 'pending-model' } });
      openPicker();
      const popup = await screen.findByRole('dialog');
      expect(container).not.toContainElement(popup);
      expect(screen.getByText('Temperature')).toBeVisible();

      setBlocked(true);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      if (!externalTrigger) {
        expect(screen.getByRole('button', { name: /^Add field…/ })).toBeDisabled();
      }
      openPicker();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(draft).toBeInTheDocument();
      expect(draft).toHaveValue('pending-model');
      expect(screen.queryByLabelText('Temperature')).not.toBeInTheDocument();

      setBlocked(false);
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(draft).toBeInTheDocument();
      expect(draft).toHaveValue('pending-model');
      expect(screen.queryByLabelText('Temperature')).not.toBeInTheDocument();
      openPicker();
      fireEvent.click(await screen.findByText('Temperature'));
      expect(await screen.findByLabelText('Temperature')).toBeVisible();
      expect(draft).toHaveValue('pending-model');
    },
  );
});
