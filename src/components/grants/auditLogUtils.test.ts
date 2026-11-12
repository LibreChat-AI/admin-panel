import { describe, it, expect } from 'vitest';
import {
  ACTION_BADGE_STATE,
  ACTION_LABEL_KEY,
  ACTION_SUMMARY_KEY,
  auditActionLabel,
  auditActionBadgeState,
  auditActionSummaryKey,
  isLabeledAuditAction,
  auditCapability,
  auditGrantee,
  auditSubject,
  auditTargetBadge,
  buildEntryPermalink,
  capabilityLabel,
  dateToIsoDate,
  formatTimestamp,
  isoDateToDate,
  localDayBoundaryIso,
} from './auditLogUtils';
import { AUDIT_ACTIONS, LABELED_AUDIT_ACTIONS } from '@/constants';
import translation from '@/locales/en/translation.json';

const identityLocalize = (k: string) => k;

describe('ACTION_BADGE_STATE', () => {
  it('maps each audit action to a badge state', () => {
    expect(ACTION_BADGE_STATE['grant.assigned']).toBe('success');
    expect(ACTION_BADGE_STATE['grant.removed']).toBe('danger');
    expect(ACTION_BADGE_STATE['permission.insights_assigned']).toBe('success');
    expect(ACTION_BADGE_STATE['permission.insights_removed']).toBe('danger');
  });

  it('has a localized label and summary for every audit action', () => {
    const localeKeys = new Set(Object.keys(translation));
    for (const action of LABELED_AUDIT_ACTIONS) {
      expect(localeKeys.has(ACTION_LABEL_KEY[action])).toBe(true);
      expect(localeKeys.has(ACTION_SUMMARY_KEY[action])).toBe(true);
    }
  });
});

describe('audit actions the tab does not name', () => {
  const localeKeys = new Set(Object.keys(translation));
  const unlabeled = AUDIT_ACTIONS.filter((action) => !isLabeledAuditAction(action));

  it('leaves 35 of the 39 published actions unnamed', () => {
    expect(AUDIT_ACTIONS).toHaveLength(39);
    expect(unlabeled).toHaveLength(35);
    expect(unlabeled).toContain('role.created');
  });

  it('shows each by its own name, on a neutral badge, with a generic summary', () => {
    for (const action of unlabeled) {
      expect(auditActionLabel(action, identityLocalize)).toBe(action);
      expect(auditActionBadgeState(action)).toBe('neutral');
      expect(auditActionSummaryKey(action)).toBe('com_audit_detail_summary_other');
    }
    expect(localeKeys.has('com_audit_detail_summary_other')).toBe(true);
    expect(translation.com_audit_detail_summary_other).toContain('{{action}}');
  });

  it('shows an action no published release lists the same way', () => {
    expect(isLabeledAuditAction('workflow.started')).toBe(false);
    expect(auditActionLabel('workflow.started', identityLocalize)).toBe('workflow.started');
    expect(auditActionBadgeState('workflow.started')).toBe('neutral');
    expect(auditActionSummaryKey('workflow.started')).toBe('com_audit_detail_summary_other');
  });

  it('keeps the named actions on their own label, badge and summary', () => {
    expect(auditActionLabel('grant.removed', identityLocalize)).toBe('com_audit_action_removed');
    expect(auditActionBadgeState('grant.removed')).toBe('danger');
    expect(auditActionSummaryKey('permission.insights_assigned')).toBe(
      'com_audit_detail_summary_insights_assigned',
    );
  });
});

describe('auditSubject', () => {
  it('uses the capability for grant entries', () => {
    expect(
      auditSubject(
        { action: 'grant.assigned', metadata: { capability: 'manage:users' } },
        identityLocalize,
      ),
    ).toEqual({ label: 'manage:users', value: 'manage:users' });
  });

  it('reports the VIEW_INSIGHTS permission for Insights entries', () => {
    expect(
      auditSubject(
        { action: 'permission.insights_removed', metadata: { principalType: 'user' } },
        identityLocalize,
      ),
    ).toEqual({ label: 'com_audit_insights_permission', value: 'VIEW_INSIGHTS' });
  });
});

describe('auditGrantee', () => {
  it('reads the affected principal from metadata', () => {
    expect(auditGrantee({ metadata: { principalType: 'group', principalId: 'g1' } })).toEqual({
      type: 'group',
      id: 'g1',
    });
  });

  it('returns undefined for grant entries without principal metadata', () => {
    expect(auditGrantee({ metadata: { capability: 'manage:users' } })).toBeUndefined();
    expect(auditGrantee({ metadata: undefined })).toBeUndefined();
  });
});

describe('auditTargetBadge', () => {
  it('labels agent targets as agents', () => {
    expect(auditTargetBadge('agent', identityLocalize)).toEqual({
      icon: 'sparkle',
      label: 'com_audit_target_agent',
    });
  });

  it('uses the scope config for principal targets', () => {
    expect(auditTargetBadge('role', identityLocalize)).toEqual({
      icon: 'briefcase',
      label: 'com_scope_roles',
    });
  });

  it.each(['config', 'mcp_server', 'audit_log', 'public'])(
    'shows a target type it has no name for (%s) by that name, on a neutral dot',
    (type) => {
      expect(auditTargetBadge(type, identityLocalize)).toEqual({ icon: 'dot', label: type });
    },
  );
});

describe('auditCapability', () => {
  it('reads the capability from metadata', () => {
    expect(auditCapability({ metadata: { capability: 'manage:users' } })).toBe('manage:users');
  });

  it('returns empty string when metadata or capability is absent', () => {
    expect(auditCapability({ metadata: undefined })).toBe('');
    expect(auditCapability({ metadata: { other: 'x' } })).toBe('');
  });
});

describe('formatTimestamp', () => {
  it('produces a non-empty localized string for valid ISO input', () => {
    const out = formatTimestamp('2026-05-10T14:30:00.000Z');
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe('2026-05-10T14:30:00.000Z');
  });

  it('falls back to the input string when the date is invalid', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });

  it('accepts a locale override', () => {
    const out = formatTimestamp('2026-05-10T14:30:00.000Z', 'en-US');
    expect(out.length).toBeGreaterThan(0);
  });
});

describe('capabilityLabel', () => {
  it('returns the localized label when the locale key resolves', () => {
    const localize = (key: string) => (key === 'com_cap_manage_configs' ? 'Manage configs' : key);
    expect(capabilityLabel('manage:configs', localize)).toBe('Manage configs');
  });

  it('returns the raw capability when no locale match is found', () => {
    expect(capabilityLabel('custom:unknown', identityLocalize)).toBe('custom:unknown');
  });

  it('converts all colons in the capability to underscores in the lookup key', () => {
    let observed = '';
    const localize = (key: string) => {
      observed = key;
      return key;
    };
    capabilityLabel('manage:configs:mcp', localize);
    expect(observed).toBe('com_cap_manage_configs_mcp');
  });
});

describe('isoDateToDate / dateToIsoDate', () => {
  it('round-trips a YYYY-MM-DD value in local time', () => {
    const date = isoDateToDate('2026-05-14');
    expect(date).toBeInstanceOf(Date);
    if (!date) return;
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(4);
    expect(date.getDate()).toBe(14);
    expect(dateToIsoDate(date)).toBe('2026-05-14');
  });

  it('returns undefined for empty input', () => {
    expect(isoDateToDate('')).toBeUndefined();
  });

  it('returns undefined for malformed input', () => {
    expect(isoDateToDate('not-a-date')).toBeUndefined();
    expect(isoDateToDate('2026-13-01')).toBeUndefined();
  });
});

describe('localDayBoundaryIso', () => {
  it('returns undefined for empty input', () => {
    expect(localDayBoundaryIso('', 'start')).toBeUndefined();
    expect(localDayBoundaryIso('', 'end')).toBeUndefined();
  });

  it('produces start-of-day in local time for the start boundary', () => {
    const out = localDayBoundaryIso('2026-05-14', 'start');
    expect(out).toBeTruthy();
    if (!out) return;
    const parsed = new Date(out);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(4);
    expect(parsed.getDate()).toBe(14);
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
    expect(parsed.getSeconds()).toBe(0);
    expect(parsed.getMilliseconds()).toBe(0);
  });

  it('produces end-of-day (23:59:59.999) in local time for the end boundary', () => {
    const out = localDayBoundaryIso('2026-05-14', 'end');
    expect(out).toBeTruthy();
    if (!out) return;
    const parsed = new Date(out);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(4);
    expect(parsed.getDate()).toBe(14);
    expect(parsed.getHours()).toBe(23);
    expect(parsed.getMinutes()).toBe(59);
    expect(parsed.getSeconds()).toBe(59);
    expect(parsed.getMilliseconds()).toBe(999);
  });
});

describe('buildEntryPermalink', () => {
  it('builds a root-mounted permalink when no base path is configured', () => {
    expect(buildEntryPermalink('abc', 'https://host', '')).toBe(
      'https://host/grants?tab=audit-log&entryId=abc',
    );
  });

  it('preserves a configured base path for subpath deployments', () => {
    expect(buildEntryPermalink('abc', 'https://host', '/adminpanel')).toBe(
      'https://host/adminpanel/grants?tab=audit-log&entryId=abc',
    );
  });

  it('normalizes a trailing slash on the base path', () => {
    expect(buildEntryPermalink('abc', 'https://host', '/adminpanel/')).toBe(
      'https://host/adminpanel/grants?tab=audit-log&entryId=abc',
    );
  });

  it('encodes the entry id', () => {
    expect(buildEntryPermalink('a/b c', 'https://host', '')).toContain('entryId=a%2Fb%20c');
  });
});
