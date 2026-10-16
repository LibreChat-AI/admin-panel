import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { candidateIds, findPathElement, pathPrefixes, revealConfigPath } from './reveal';

const html = String.raw;

/** A NestedGroup-like collapsible that renders its field only once expanded. */
function nestedGroup(id: string, fieldId: string): HTMLElement {
  const section = document.createElement('section');
  section.id = id;
  section.innerHTML = html`<div><button aria-expanded="false">Group</button></div>
    <div class="config-section-grid config-section-grid-closed" inert><div></div></div>`;
  section.addEventListener('config:expand', () => {
    const grid = section.querySelector<HTMLElement>('.config-section-grid')!;
    grid.classList.replace('config-section-grid-closed', 'config-section-grid-open');
    grid.removeAttribute('inert');
    grid.innerHTML = html`<div class="config-row"><input id="${fieldId}" /></div>`;
  });
  return section;
}

describe('candidate ids', () => {
  it('covers groups, entry cards (incl. encoded MCP names) and field controls', () => {
    expect(candidateIds('rateLimits.fileUploads')).toEqual([
      'section-rateLimits.fileUploads',
      'section-rateLimits-fileUploads',
      'rateLimits-fileUploads',
    ]);
    expect(candidateIds('mcpServers.my server')).toContain('section-mcpServers-my%20server');
    expect(pathPrefixes('a.b.c')).toEqual(['a', 'a.b', 'a.b.c']);
  });

  it('finds an id-less entry card by its index in the list', () => {
    const container = document.createElement('div');
    container.innerHTML = html`<div id="modelSpecs-list">
      <div><div aria-expanded="false">first</div></div>
      <div><div aria-expanded="false">second</div></div>
    </div>`;
    document.body.append(container);
    expect(findPathElement(container, 'modelSpecs.list.1')?.textContent).toContain('second');
    container.remove();
  });
});

describe('revealConfigPath', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    container.scrollTo = vi.fn();
    document.body.append(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('opens the closed accordion item and group, then focuses the lazily rendered field', () => {
    const item = document.createElement('div');
    item.id = 'section-rateLimits';
    item.setAttribute('data-state', 'closed');
    const trigger = document.createElement('button');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.addEventListener('click', () => {
      item.setAttribute('data-state', 'open');
      item.append(nestedGroup('section-rateLimits.fileUploads', 'rateLimits-fileUploads-ipMax'));
    });
    item.append(trigger);
    container.append(item);

    const onDone = vi.fn();
    revealConfigPath(
      container,
      { path: 'rateLimits.fileUploads.ipMax', sectionId: 'rateLimits' },
      { onDone },
    );
    vi.advanceTimersByTime(2_000);

    const input = document.getElementById('rateLimits-fileUploads-ipMax');
    expect(onDone).toHaveBeenCalledWith(input);
    expect(document.activeElement).toBe(input);
    expect(input?.closest('.config-row')?.classList.contains('cmdk-highlight')).toBe(true);
    expect(container.scrollTo).toHaveBeenCalled();
  });

  it('gives up with null when the path never renders', () => {
    const onDone = vi.fn();
    revealConfigPath(container, { path: 'nothing.here' }, { onDone });
    vi.advanceTimersByTime(10_000);
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it('can be cancelled', () => {
    const onDone = vi.fn();
    const cancel = revealConfigPath(container, { path: 'nothing.here' }, { onDone });
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(onDone).not.toHaveBeenCalled();
  });
});
