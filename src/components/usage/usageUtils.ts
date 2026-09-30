import type { RunReport } from '@/server';

/** Status → Badge state (color) paired with a label key — the label always
 * renders beside the color, never color alone. */
export const RUN_STATUS_BADGE_STATE: Record<RunReport['status'], 'success' | 'danger' | 'warning'> =
  {
    succeeded: 'success',
    failed: 'danger',
    stopped: 'warning',
    timeout: 'warning',
  };

export const RUN_STATUS_LABEL_KEY: Record<RunReport['status'], string> = {
  succeeded: 'com_usage_status_succeeded',
  failed: 'com_usage_status_failed',
  stopped: 'com_usage_status_stopped',
  timeout: 'com_usage_status_timeout',
};

/** 8500 → "8.5s", 420 → "420ms", null → "—" (not recorded / still unknown). */
export function formatRunDuration(ms: number | null | undefined): string {
  if (ms == null) {
    return '—';
  }
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** RFC 4180 field escaping: quote-wrap on comma/quote/newline, double quotes. */
function csvField(value: string): string {
  if (value === '') {
    return '';
  }
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** CSV column order — keep in sync with the table (time/user/tool/version/
 * status/duration) plus export-only detail columns (user_sub, argument key
 * names, source, row id). */
export function buildRunReportsCsv(reports: RunReport[], header: string[]): string {
  const escape = (fields: (string | number | null | undefined)[]) =>
    fields.map((field) => csvField(field == null ? '' : String(field))).join(',');
  const lines = [escape(header)];
  for (const report of reports) {
    lines.push(
      escape([
        report.created_at,
        report.user_name || report.username,
        report.user_sub,
        report.tool_id,
        report.version ?? '',
        report.status,
        report.duration_ms == null ? '' : String(report.duration_ms),
        report.argument_keys.join(';'),
        report.source,
        report.id,
      ]),
    );
  }
  /** BOM first so Excel detects UTF-8 (zh text garbles without it); CRLF line
   * endings per RFC 4180 for the same reason. */
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Trigger a browser download of the CSV text as a UTF-8 blob. */
export function downloadTextCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
