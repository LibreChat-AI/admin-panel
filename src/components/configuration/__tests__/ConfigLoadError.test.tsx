import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ConfigLoadError } from '../ConfigLoadError';
import '@/locales/i18n';

async function nextFrame() {
  await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
}

async function nextFrames() {
  await nextFrame();
  await nextFrame();
}

type LoadState = 'error' | 'loading' | 'ready';

/**
 * The configuration page in the app layout: the header's title is always
 * there. A retry swaps the error card for a skeleton (`aria-busy`) until it
 * ends with the page, or with a new error card in its place (the route and
 * the page both mount a new one). With `tabsWhileLoading`, the tab bar shows
 * around the card and the skeleton, as the page's own load errors have it.
 * `initial` is how it opens: a page come back to has its data cached.
 */
function Page({
  tabsWhileLoading = false,
  initial = 'error',
}: {
  tabsWhileLoading?: boolean;
  initial?: LoadState;
}) {
  const [state, setState] = useState<LoadState>(initial);
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setAttempt((n) => n + 1);
    setState('loading');
  };
  return (
    <>
      <header>
        <h1 tabIndex={-1}>Configuration</h1>
      </header>
      {(tabsWhileLoading || state === 'ready') && (
        <div role="tablist">
          <button type="button" role="tab" data-state="active">
            Providers
          </button>
        </div>
      )}
      {state === 'error' && (
        <ConfigLoadError key={attempt} error={new Error('boom')} onRetry={retry} />
      )}
      {state === 'loading' && (
        <div role="status" aria-busy="true">
          <button type="button" onClick={() => setState('ready')}>
            Finish loading
          </button>
          <button type="button" onClick={() => setState('error')}>
            Fail again
          </button>
        </div>
      )}
    </>
  );
}

/**
 * The configuration route's error component: its card stays mounted, with
 * Retry busy, while the router loads again. A navigation away unmounts it
 * after the path has already changed.
 */
function RouteError() {
  const [retrying, setRetrying] = useState(false);
  return (
    <>
      <header>
        <h1 tabIndex={-1}>Configuration</h1>
      </header>
      <ConfigLoadError
        error={new Error('boom')}
        onRetry={() => setRetrying(true)}
        retrying={retrying}
      />
    </>
  );
}

/** Another page of the app (Access management), with an open tab of its own when `tabs`. */
function AccessPage({ tabs }: { tabs: boolean }) {
  return (
    <>
      <header>
        <h1 tabIndex={-1}>Access management</h1>
      </header>
      {tabs && (
        <div role="tablist">
          <button type="button" role="tab" data-state="active">
            Roles
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Renders the configuration page (or `start`) at /configuration. The returned
 * `goTo` changes the path the way the router does (history) and shows `page`
 * there.
 */
function renderApp(start: ReactElement = <Page />) {
  window.history.pushState(null, '', '/configuration');
  const { rerender } = render(start);
  return async (path: string, page: ReactElement) => {
    window.history.pushState(null, '', path);
    rerender(page);
    await nextFrames();
  };
}

/** Retries from a focused Retry: the card goes away while it loads, and focus falls to `<body>`. */
async function startRetry() {
  const retry = screen.getByRole('button', { name: 'Retry' });
  retry.focus();
  fireEvent.click(retry);
  expect(screen.queryByRole('alert')).toBeNull();
  await nextFrame();
  expect(document.body).toHaveFocus();
}

async function retryThen(outcome: 'Finish loading' | 'Fail again') {
  await startRetry();
  act(() => screen.getByRole('button', { name: outcome }).click());
  await nextFrames();
}

describe('ConfigLoadError', () => {
  afterEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it.each([
    ['the route', false],
    ['the page', true],
  ])('puts focus on the open tab once a retry has loaded %s', async (_where, tabsWhileLoading) => {
    render(<Page tabsWhileLoading={tabsWhileLoading} />);
    await retryThen('Finish loading');
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveFocus();
  });

  it.each([
    ['the route', false],
    ['the page', true],
  ])(
    'gives focus to the Retry of the card %s shows again when a retry fails again',
    async (_where, tabsWhileLoading) => {
      render(<Page tabsWhileLoading={tabsWhileLoading} />);
      await retryThen('Fail again');
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    },
  );

  it('still puts focus on the open tab when only the query changes while a retry loads', async () => {
    renderApp();
    await startRetry();
    window.history.replaceState(null, '', '/configuration?tab=providers');
    act(() => screen.getByRole('button', { name: 'Finish loading' }).click());
    await nextFrames();
    expect(screen.getByRole('tab', { name: 'Providers' })).toHaveFocus();
  });

  it('moves no focus on a page the user goes to while a retry loads', async () => {
    const goTo = renderApp();
    await startRetry();
    await goTo('/access', <AccessPage tabs />);
    expect(screen.getByRole('tab', { name: 'Roles' })).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it('moves no focus on a page the user goes to while the route still shows the card retrying', async () => {
    const goTo = renderApp(<RouteError />);
    const retry = screen.getByRole('button', { name: 'Retry' });
    retry.focus();
    fireEvent.click(retry);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await goTo('/access', <AccessPage tabs />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Roles' })).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });

  it('moves no focus on the configuration page the user comes back to', async () => {
    const goTo = renderApp();
    await startRetry();
    await goTo('/access', <AccessPage tabs={false} />);
    await goTo('/configuration', <Page initial="ready" />);
    expect(screen.getByRole('tab', { name: 'Providers' })).toBeInTheDocument();
    expect(document.body).toHaveFocus();
  });
});
