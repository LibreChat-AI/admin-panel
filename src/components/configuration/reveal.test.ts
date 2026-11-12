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

  it('opens the collapsed group around a target whose own id is already rendered', () => {
    const group = document.createElement('section');
    group.id = 'section-interface-group-onboarding';
    group.innerHTML = html`<div><button aria-expanded="false">Onboarding</button></div>
      <div class="config-section-grid config-section-grid-closed" inert>
        <h4 id="section-interface.termsOfService">Terms of service</h4>
      </div>`;
    group.addEventListener('config:expand', () => {
      const grid = group.querySelector<HTMLElement>('.config-section-grid')!;
      grid.classList.replace('config-section-grid-closed', 'config-section-grid-open');
      grid.removeAttribute('inert');
    });
    container.append(group);

    const onDone = vi.fn();
    revealConfigPath(container, { path: 'interface.termsOfService' }, { onDone, focus: false });
    vi.advanceTimersByTime(2_000);

    expect(onDone).toHaveBeenCalledWith(
      document.getElementById('section-interface.termsOfService'),
    );
    expect(group.querySelector('[inert]')).toBeNull();
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

  function renderedField(): HTMLInputElement {
    const row = document.createElement('div');
    row.className = 'config-row';
    const input = document.createElement('input');
    input.id = 'memory-tokenLimit';
    row.append(input);
    container.append(row);
    return input;
  }

  it('cancelled after landing (its deep link done), it still focuses the target', () => {
    const input = renderedField();
    const cancel = revealConfigPath(container, { path: 'memory.tokenLimit' });
    cancel();
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).toBe(input);
  });

  it("a newer reveal in the same container ends the previous one's re-checks", () => {
    const input = renderedField();
    revealConfigPath(container, { path: 'memory.tokenLimit' });
    const other = document.createElement('input');
    other.id = 'memory-agent';
    container.append(other);
    revealConfigPath(container, { path: 'memory.agent' }, { focus: false });
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).not.toBe(input);
    expect(container.scrollTo).toHaveBeenCalledTimes(4);
  });

  it('stops correcting the scroll once the user scrolls', () => {
    const input = renderedField();
    revealConfigPath(container, { path: 'memory.tokenLimit' });
    container.dispatchEvent(new Event('wheel'));
    vi.advanceTimersByTime(2_000);
    expect(container.scrollTo).toHaveBeenCalledTimes(1);
    expect(document.activeElement).not.toBe(input);
  });

  it('stops correcting the scroll once the page is scrolled away from the target', () => {
    renderedField();
    revealConfigPath(container, { path: 'memory.tokenLimit' });
    container.scrollTop = 500;
    container.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(2_000);
    expect(container.scrollTo).toHaveBeenCalledTimes(1);
  });

  it('leaves focus on a control the user moved to meanwhile', () => {
    const input = renderedField();
    const other = document.createElement('button');
    container.append(other);
    revealConfigPath(container, { path: 'memory.tokenLimit' });
    other.focus();
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(input);
  });

  it("focuses a radio group's chosen option", () => {
    const group = document.createElement('div');
    group.id = 'modelSpecs-list-0-softDefault';
    group.innerHTML = html`<input type="radio" name="soft" value="no" /><input
        type="radio"
        name="soft"
        value="yes"
        checked
      />`;
    container.append(group);
    revealConfigPath(container, { path: 'modelSpecs.list.0.softDefault' });
    vi.advanceTimersByTime(2_000);
    expect((document.activeElement as HTMLInputElement).value).toBe('yes');
  });

  it('focuses the row of a read-only setting, which has no control', () => {
    const row = document.createElement('div');
    row.className = 'settings-row';
    row.innerHTML = html`<span id="registration-oauthStateTtlMs">60,000</span>`;
    container.append(row);
    revealConfigPath(container, { path: 'registration.oauthStateTtlMs' });
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).toBe(row);
    row.blur();
    expect(row.hasAttribute('tabindex')).toBe(false);
  });

  it("with focus 'heading', focuses the section's heading toggle, not its first control", () => {
    const section = document.createElement('section');
    section.id = 'section-balance';
    section.innerHTML = html`<div data-section-id="section-balance">
        <h2><button type="button" aria-expanded="true">Balance</button></h2>
      </div>
      <div><input type="radio" name="on" checked /><input id="balance-startBalance" /></div>`;
    container.append(section);
    revealConfigPath(container, { path: 'balance' }, { focus: 'heading', highlight: false });
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).toBe(section.querySelector('h2 > button'));
  });

  it("with focus 'heading', focuses an entry card's header button", () => {
    const card = document.createElement('div');
    card.id = 'section-mcpServers-docs';
    card.innerHTML = html`<div>
      <button type="button" data-section-id="section-mcpServers-docs" aria-expanded="false">
        Docs
      </button>
      <button type="button" aria-haspopup="menu">Actions for docs</button>
    </div>`;
    container.append(card);
    revealConfigPath(container, { path: 'mcpServers.docs' }, { focus: 'heading' });
    vi.advanceTimersByTime(2_000);
    expect(document.activeElement).toBe(card.querySelector('[data-section-id]'));
  });
});
