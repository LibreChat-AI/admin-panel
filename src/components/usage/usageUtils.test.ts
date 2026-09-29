import { describe, expect, it } from 'vitest';
import type { RunReport } from '@/server';
import {
  RUN_STATUS_BADGE_STATE,
  RUN_STATUS_LABEL_KEY,
  buildRunReportsCsv,
  formatRunDuration,
} from './usageUtils';

const report = (over: Partial<RunReport> = {}): RunReport => ({
  id: 'rep1',
  user_sub: 'user-wang',
  username: 'wangjianbo',
  tool_id: 'wangjianbo.toolsdemo',
  version: '1.0.0',
  status: 'succeeded',
  duration_ms: 8500,
  argument_keys: ['text'],
  source: 'toolbox',
  created_at: '2026-09-28T10:00:00Z',
  ...over,
});

describe('formatRunDuration', () => {
  it('renders sub-second as milliseconds, above as one-decimal seconds', () => {
    expect(formatRunDuration(420)).toBe('420ms');
    expect(formatRunDuration(8500)).toBe('8.5s');
    expect(formatRunDuration(1000)).toBe('1.0s');
  });

  it('missing duration renders the em dash', () => {
    expect(formatRunDuration(null)).toBe('—');
    expect(formatRunDuration(undefined)).toBe('—');
  });
});

describe('status presentation', () => {
  it('every status maps to a badge state and a label key (never color alone)', () => {
    for (const status of ['succeeded', 'failed', 'stopped', 'timeout'] as const) {
      expect(RUN_STATUS_BADGE_STATE[status]).toBeTruthy();
      expect(RUN_STATUS_LABEL_KEY[status]).toMatch(/^com_usage_status_/);
    }
    expect(RUN_STATUS_BADGE_STATE.failed).toBe('danger');
    expect(RUN_STATUS_BADGE_STATE.timeout).toBe('warning');
  });
});

describe('buildRunReportsCsv', () => {
  it('starts with the UTF-8 BOM and carries the header row', () => {
    const csv = buildRunReportsCsv([], ['Time', 'User']);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('Time,User\r\n');
  });

  it('serializes rows in the documented column order', () => {
    const csv = buildRunReportsCsv(
      [report({ argument_keys: ['text', 'count'], version: null, duration_ms: null })],
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'],
    );
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe(
      '2026-09-28T10:00:00Z,wangjianbo,user-wang,wangjianbo.toolsdemo,,succeeded,,text;count,toolbox,rep1',
    );
  });

  it('RFC 4180-escapes commas, quotes and newlines (zh usernames included)', () => {
    const csv = buildRunReportsCsv(
      [report({ username: '王,建"波\n二行' })],
      ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'h9', 'h10'],
    );
    expect(csv).toContain('"王,建""波\n二行"');
  });
});
