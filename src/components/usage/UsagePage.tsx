import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, DatePicker, Select, TextField } from '@clickhouse/click-ui';
import type { RunReport, RunReportFilters } from '@/server';
import {
  RUN_REPORTS_EXPORT_CAP,
  RUN_REPORTS_PAGE_SIZE,
  exportRunReportsFn,
  runReportsQueryOptions,
  toolsQueryOptions,
} from '@/server';
import {
  DatePickerCell,
  EmptyState,
  LoadingState,
  Pagination,
  ScreenReaderAnnouncer,
} from '@/components/shared';
import { useAnnouncement, useDebouncedFilter, useLocalize } from '@/hooks';
/* Generic local-day/date helpers (shared with the audit-log filters). */
import {
  dateToIsoDate,
  formatTimestamp,
  isoDateToDate,
  localDayBoundaryIso,
} from '@/components/grants/auditLogUtils';
import {
  RUN_STATUS_BADGE_STATE,
  RUN_STATUS_LABEL_KEY,
  buildRunReportsCsv,
  downloadTextCsv,
  formatRunDuration,
} from './usageUtils';

/** Radix `Select.Item` cannot use `value=""` (Radix reserves empty string for
 * "no selection") — sentinel translated to "no tool filter" in state. */
const TOOL_ALL = '__all__';

/**
 * Tool usage statistics (local-tool-plan §11 步骤 3): who ran which desktop
 * tool, when, and how it ended. Rows come from the gateway `run_reports` table
 * (browser best-effort reports from the toolbox); the CSV export pages the
 * whole filter result server-side, capped at 10k rows.
 */
export function UsagePage() {
  const localize = useLocalize();
  const [toolId, setToolId] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  /** Bumped each clear so DatePicker remounts and drops its internal selection state. */
  const [dateResetNonce, setDateResetNonce] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const { message: announcement, announce } = useAnnouncement();

  const resetToFirstPage = useCallback(() => setCurrentPage(1), []);
  const userFilter = useDebouncedFilter('', resetToFirstPage);

  /** The gateway matches `user_sub` exactly — label the field as an ID, not a
   * free-text name search, so admins are not surprised by empty results. */
  const filters = useMemo<RunReportFilters>(
    () => ({
      tool_id: toolId || undefined,
      user_sub: userFilter.debouncedValue.trim() || undefined,
      since: localDayBoundaryIso(dateFrom, 'start'),
      until: localDayBoundaryIso(dateTo, 'end'),
    }),
    [toolId, userFilter.debouncedValue, dateFrom, dateTo],
  );

  const { data, isPending, isFetching, isError } = useQuery({
    ...runReportsQueryOptions(currentPage, filters),
    placeholderData: keepPreviousData,
  });

  /** Tool dropdown options from the catalog (display_name + tool_id).
   * `toolsQueryOptions` is a static queryOptions object, not a factory. */
  const toolsQuery = useQuery(toolsQueryOptions);

  const pageReports = useMemo<RunReport[]>(() => data?.reports ?? [], [data]);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / RUN_REPORTS_PAGE_SIZE));
  /** On error the table shows an EmptyState, so the footer/pagination counts
   * collapse to zero rather than contradicting it with stale keepPreviousData. */
  const displayTotal = isError ? 0 : total;
  const displayTotalPages = isError ? 1 : totalPages;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  /** Announce the full match count once per filter change (not per refetch). */
  const filterSignature = useMemo(
    () => JSON.stringify({ toolId, user: userFilter.debouncedValue, dateFrom, dateTo }),
    [toolId, userFilter.debouncedValue, dateFrom, dateTo],
  );
  const lastAnnouncedSignature = useRef<string | null>(null);
  useEffect(() => {
    if (isFetching || isError) return;
    if (lastAnnouncedSignature.current === filterSignature) return;
    lastAnnouncedSignature.current = filterSignature;
    announce(localize('com_usage_count', { count: total }));
  }, [filterSignature, isFetching, isError, total, announce, localize]);

  const buildExportFilters = useCallback(
    (immediateUser: string): RunReportFilters => ({
      tool_id: toolId || undefined,
      /** Immediate input, not the debounced snapshot — an export click within
       * the 300 ms window must match exactly what the user sees. */
      user_sub: immediateUser.trim() || undefined,
      since: localDayBoundaryIso(dateFrom, 'start'),
      until: localDayBoundaryIso(dateTo, 'end'),
    }),
    [toolId, dateFrom, dateTo],
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const { reports: rows, truncated } = await exportRunReportsFn({
        data: buildExportFilters(userFilter.value),
      });
      if (truncated) {
        announce(localize('com_usage_export_truncated', { count: RUN_REPORTS_EXPORT_CAP }));
      }
      downloadTextCsv(
        `tool-usage-${new Date().toISOString().slice(0, 10)}.csv`,
        buildRunReportsCsv(rows, [
          localize('com_usage_col_time'),
          localize('com_usage_col_user'),
          localize('com_usage_col_user_sub'),
          localize('com_usage_col_tool'),
          localize('com_usage_col_version'),
          localize('com_usage_col_status'),
          localize('com_usage_col_duration'),
          localize('com_usage_col_arguments'),
          localize('com_usage_col_source'),
          localize('com_usage_col_id'),
        ]),
      );
    } catch {
      announce(localize('com_usage_export_failed'));
    } finally {
      setExporting(false);
    }
  }, [buildExportFilters, userFilter.value, announce, localize]);

  const showLoading = isPending && !data;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="select-field-a11y w-60">
          <Select
            label={localize('com_usage_filter_tool')}
            value={toolId === '' ? TOOL_ALL : toolId}
            onSelect={(value) => {
              setToolId(value === TOOL_ALL ? '' : value);
              resetToFirstPage();
            }}
            placeholder={localize('com_ui_all')}
          >
            <Select.Item value={TOOL_ALL}>{localize('com_ui_all')}</Select.Item>
            {(toolsQuery.data?.tools ?? []).map((tool) => (
              <Select.Item key={tool.tool_id} value={tool.tool_id}>
                {tool.display_name ? `${tool.display_name} (${tool.tool_id})` : tool.tool_id}
              </Select.Item>
            ))}
          </Select>
        </div>

        <div className="w-60">
          <TextField
            label={localize('com_usage_filter_user')}
            value={userFilter.value}
            onChange={userFilter.onChange}
            placeholder={localize('com_usage_filter_user')}
          />
        </div>

        <div className="flex items-center gap-1.5">
          <label htmlFor="usage-date-from" className="text-xs text-(--cui-color-text-muted)">
            {localize('com_audit_date_from')}
          </label>
          <DatePickerCell resetKey={dateResetNonce} inputId="usage-date-from">
            <DatePicker
              key={`from-${dateResetNonce}`}
              date={isoDateToDate(dateFrom)}
              onSelectDate={(d) => {
                setDateFrom(d ? dateToIsoDate(d) : '');
                resetToFirstPage();
              }}
              placeholder={localize('com_audit_date_from')}
            />
          </DatePickerCell>
        </div>
        <div className="flex items-center gap-1.5">
          <label htmlFor="usage-date-to" className="text-xs text-(--cui-color-text-muted)">
            {localize('com_audit_date_to')}
          </label>
          <DatePickerCell resetKey={dateResetNonce} inputId="usage-date-to">
            <DatePicker
              key={`to-${dateResetNonce}`}
              date={isoDateToDate(dateTo)}
              onSelectDate={(d) => {
                setDateTo(d ? dateToIsoDate(d) : '');
                resetToFirstPage();
              }}
              placeholder={localize('com_audit_date_to')}
            />
          </DatePickerCell>
        </div>
        {(dateFrom || dateTo) && (
          <Button
            type="danger"
            iconLeft="cross"
            label={localize('com_ui_clear')}
            aria-label={localize('com_a11y_clear_dates')}
            onClick={() => {
              setDateFrom('');
              setDateTo('');
              setDateResetNonce((n) => n + 1);
              resetToFirstPage();
            }}
          />
        )}

        <div className="ml-auto">
          <Button
            type="secondary"
            iconLeft="download"
            onClick={() => void handleExport()}
            disabled={displayTotal === 0 || exporting}
            loading={exporting}
            label={localize('com_usage_export')}
          />
        </div>
      </div>

      <div
        className="overflow-x-auto rounded-lg border border-(--cui-color-stroke-default)"
        role="region"
        aria-label={localize('com_usage_title')}
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{localize('com_usage_title')}</caption>
          <thead className="sticky top-0 z-(--z-sticky)">
            <tr className="border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-muted)">
              <th
                scope="col"
                className="px-4 py-2.5 font-medium whitespace-nowrap text-(--cui-color-text-muted)"
              >
                {localize('com_usage_col_time')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_usage_col_user')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_usage_col_tool')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_usage_col_version')}
              </th>
              <th scope="col" className="px-4 py-2.5 font-medium text-(--cui-color-text-muted)">
                {localize('com_usage_col_status')}
              </th>
              <th
                scope="col"
                className="px-4 py-2.5 font-medium whitespace-nowrap text-(--cui-color-text-muted)"
              >
                {localize('com_usage_col_duration')}
              </th>
            </tr>
          </thead>
          <tbody>
            {showLoading && (
              <tr>
                <td colSpan={6}>
                  <LoadingState />
                </td>
              </tr>
            )}
            {!showLoading && isError && (
              <tr>
                <td colSpan={6}>
                  <EmptyState message={localize('com_usage_error')} />
                </td>
              </tr>
            )}
            {!showLoading &&
              !isError &&
              pageReports.map((report) => (
                <UsageTableRow key={report.id} report={report} localize={localize} />
              ))}
            {!showLoading && !isError && pageReports.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState message={localize('com_usage_empty')} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={currentPage}
        totalPages={displayTotalPages}
        onPageChange={setCurrentPage}
      />

      {!isError && (
        <div className="flex items-center justify-between gap-3 pb-4">
          <p
            className="text-xs text-(--cui-color-text-muted)"
            aria-live="polite"
            aria-atomic="true"
          >
            {localize('com_usage_count', { count: displayTotal })}
          </p>
        </div>
      )}

      <ScreenReaderAnnouncer message={announcement} />
    </div>
  );
}

/** Rows are read-only — no drawer, no activation handler. */
function UsageTableRow({
  report,
  localize,
}: {
  report: RunReport;
  localize: ReturnType<typeof useLocalize>;
}) {
  return (
    <tr className="border-b border-(--cui-color-stroke-default) bg-(--cui-color-background-panel) last:border-b-0">
      <td className="px-4 py-3 text-xs whitespace-nowrap text-(--cui-color-text-muted)">
        <time dateTime={report.created_at}>{formatTimestamp(report.created_at)}</time>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col">
          <span className="font-medium text-(--cui-color-text-default)">
            {report.username || report.user_sub}
          </span>
          {report.username && (
            <span aria-hidden="true" className="text-[10px] text-(--cui-color-text-muted)">
              {report.user_sub}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-(--cui-color-text-default)">
        {report.tool_id}
      </td>
      <td className="px-4 py-3 text-(--cui-color-text-default)">{report.version ?? '—'}</td>
      <td className="px-4 py-3">
        <Badge
          size="sm"
          state={RUN_STATUS_BADGE_STATE[report.status]}
          text={localize(RUN_STATUS_LABEL_KEY[report.status])}
        />
      </td>
      <td className="px-4 py-3 text-xs whitespace-nowrap text-(--cui-color-text-muted)">
        {formatRunDuration(report.duration_ms)}
      </td>
    </tr>
  );
}
