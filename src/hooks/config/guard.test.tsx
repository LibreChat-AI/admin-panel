import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  createRoute,
  createRouter,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  useRouter,
} from '@tanstack/react-router';
import { useNavigationGuard } from './guard';

function GuardedPage({ retainDraft = false }: { retainDraft?: boolean }) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [isDirty, setIsDirty] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);
  const guard = useNavigationGuard({
    paused,
    isDirty,
    reviewOpen,
    saving: false,
    discardEdits: () => setIsDirty(false),
    openReview: () => setReviewOpen(true),
    describeScope: () => 'Base',
  });
  return (
    <>
      <button onClick={() => router.navigate({ to: '/help' })}>Leave</button>
      {guard.open && (
        <>
          <button onClick={guard.onSave}>Save and continue</button>
          <button onClick={guard.onDiscard}>Discard and leave</button>
        </>
      )}
      {reviewOpen && (
        <button
          onClick={() => {
            setPaused(true);
            setIsDirty(retainDraft);
            setReviewOpen(false);
          }}
        >
          Save needs session recovery
        </button>
      )}
      {paused && <p>Saved outcome</p>}
    </>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('navigation during save session recovery', () => {
  it('keeps browser unload protection when session recovery still has pending edits', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const root = createRootRoute({ component: Outlet });
    const page = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <GuardedPage retainDraft />,
    });
    const elsewhere = createRoute({
      getParentRoute: () => root,
      path: '/help',
      component: () => <h1>Elsewhere</h1>,
    });
    const history = createMemoryHistory({ initialEntries: ['/'] });
    const block = vi.spyOn(history, 'block');
    const router = createRouter({ routeTree: root.addChildren([page, elsewhere]), history });
    render(<RouterProvider router={router} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save needs session recovery' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save and continue' })).not.toBeInTheDocument(),
    );
    const unload = block.mock.calls.at(-1)?.[0].enableBeforeUnload;
    expect(typeof unload === 'function' ? unload() : unload).toBe(true);
    expect(router.state.location.pathname).toBe('/');
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeVisible();
  });

  it('cancels Save and continue so the outcome remains visible, and allows recovery navigation', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    const root = createRootRoute({ component: Outlet });
    const page = createRoute({ getParentRoute: () => root, path: '/', component: GuardedPage });
    const elsewhere = createRoute({
      getParentRoute: () => root,
      path: '/help',
      component: () => <h1>Elsewhere</h1>,
    });
    const history = createMemoryHistory({ initialEntries: ['/'] });
    const block = vi.spyOn(history, 'block');
    const router = createRouter({ routeTree: root.addChildren([page, elsewhere]), history });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save and continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save needs session recovery' }));

    expect(await screen.findByText('Saved outcome')).toBeVisible();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Save and continue' })).not.toBeInTheDocument();
    });
    expect(router.state.location.pathname).toBe('/');
    const unload = block.mock.calls.at(-1)?.[0].enableBeforeUnload;
    expect(typeof unload === 'function' ? unload() : unload).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Elsewhere' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/help');
  });
});
