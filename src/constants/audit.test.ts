import { describe, it, expect } from 'vitest';
import * as published from '@librechat/data-schemas';
import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_CATEGORIES,
  AUDIT_SEVERITIES,
  AUDIT_ACTOR_TYPES,
  LABELED_AUDIT_ACTIONS,
} from './audit';

describe('audit enum mirrors', () => {
  it('list exactly the members @librechat/data-schemas publishes, in its order', () => {
    expect(AUDIT_ACTIONS).toEqual(published.AUDIT_ACTIONS);
    expect(AUDIT_CATEGORIES).toEqual(published.AUDIT_CATEGORIES);
    expect(AUDIT_OUTCOMES).toEqual(published.AUDIT_OUTCOMES);
    expect(AUDIT_SEVERITIES).toEqual(published.AUDIT_SEVERITIES);
    expect(AUDIT_ACTOR_TYPES).toEqual(published.AUDIT_ACTOR_TYPES);
  });

  it('name only published actions in the tab', () => {
    const actions = new Set<string>(published.AUDIT_ACTIONS);
    expect(LABELED_AUDIT_ACTIONS.every((action) => actions.has(action))).toBe(true);
  });
});
