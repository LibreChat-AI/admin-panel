import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RunReport, RunReportFilters } from '@/server';

/**
 * UsagePage behavior with every heavy dependency mocked: react-query serves
 * fixture pages, the server fns are spies, click-ui controls collapse into
 * native elements. `buildRunReportsCsv` stays real so the exported CSV content
 * is asserted end-to-end (only the DOM download is stubbed).
 */

let reportsState: { reports: RunReport[]; total: number } | undefined;
let reportsError = false;
let toolsState: { tools: { tool_id: string; display_name: string }[] } | undefined;
let mockUserValue = '';
let capturedQuery: { page: number; filters: RunReportFilters } | null = null;

const exportRunReportsFn = vi.fn();
const mockAnnounce = vi.fn();

vi.mock('@/server', () => ({
  RUN_REPORTS_PAGE_SIZE: 50,
  RUN_REPORTS_EXPORT_CAP: 10_000,
  exportRunReportsFn: (...args: unknown[]) => exportRunReportsFn(...args),
  runReportsQueryOptions: (page: number, filters: RunReportFilters) => {
    capturedQuery = { page, filters };
    return { queryKey: ['terravox', 'runReports', page, filters] };
  },
  /** Shape-faithful: the real export is a static queryOptions OBJECT, not a
   * factory — a `() => ({...})` mock here once hid a production-only
   * "toolsQueryOptions is not a function" crash (fixed 2026-09-28). */
  toolsQueryOptions: { queryKey: ['terravox', 'tools', 'all'] },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey: unknown[] }) =>
    options.queryKey[1] === 'runReports'
      ? {
          data: reportsState,
          isPending: reportsState === undefined && !reportsError,
          isFetching: false,
          isError: reportsError,
        }
      : { data: toolsState, isPending: false, isFetching: false, isError: false },
  ),
  keepPreviousData: Symbol('keepPreviousData'),
}));

vi.mock('@/hooks', () => ({
  useLocalize: () => (key: string, options?: Record<string, unknown>) =>
    options ? `${key}:${Object.values(options).join(',')}` : key,
  useAnnouncement: () => ({ message: '', announce: mockAnnounce }),
  useDebouncedFilter: () => ({
    value: mockUserValue,
    onChange: (value: string) => {
      mockUserValue = value;
    },
    debouncedValue: mockUserValue,
  }),
}));

vi.mock('@clickhouse/click-ui', () => {
  const SelectMock = ({
    label,
    value,
    onSelect,
    children,
  }: {
    label: string;
    value: string;
    onSelect: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <div>
      <span>{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onSelect(e.target.value)}>
        {children}
      </select>
    </div>
  );
  SelectMock.Item = ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  );
  return {
    Badge: ({ text }: { text: React.ReactNode }) => <span data-testid="cui-badge">{text}</span>,
    Button: ({
      label,
      onClick,
      disabled,
      loading,
    }: {
      label: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => (
      <button type="button" disabled={disabled || loading} onClick={onClick}>
        {label}
      </button>
    ),
    DatePicker: ({ placeholder }: { placeholder?: string }) => (
      <button type="button">{placeholder}</button>
    ),
    Icon: ({ name }: { name?: string }) => <span aria-hidden="true">{name}</span>,
    Select: SelectMock,
    TextField: ({
      label,
      value,
      onChange,
    }: {
      label: string;
      value: string;
      onChange: (value: string) => void;
    }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
  };
});

vi.mock('@/components/usage/usageUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./usageUtils')>()),
  downloadTextCsv: vi.fn(),
}));

import { UsagePage } from './UsagePage';
import { downloadTextCsv } from './usageUtils';

const report = (id: string, over: Partial<RunReport> = {}): RunReport => ({
  id,
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

const renderPage = () => render(<UsagePage />);

describe('UsagePage', () => {
  beforeEach(() => {
    reportsState = undefined;
    reportsError = false;
    toolsState = undefined;
    mockUserValue = '';
    capturedQuery = null;
    exportRunReportsFn.mockReset();
    mockAnnounce.mockReset();
    vi.mocked(downloadTextCsv).mockClear();
  });

  it('renders rows with user, tool, status label, duration and total count', () => {
    reportsState = {
      reports: [report('r1'), report('r2', { status: 'failed', duration_ms: 300, version: null })],
      total: 2,
    };
    renderPage();

    expect(screen.getAllByText('wangjianbo').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('wangjianbo.toolsdemo').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('com_usage_status_succeeded')).toBeInTheDocument();
    expect(screen.getByText('com_usage_status_failed')).toBeInTheDocument();
    expect(screen.getByText('8.5s')).toBeInTheDocument();
    expect(screen.getByText('300ms')).toBeInTheDocument();
    expect(screen.getByText('com_usage_count:2')).toBeInTheDocument();
  });

  it('feeds the tool filter and first-page reset into the query', () => {
    toolsState = { tools: [{ tool_id: 'wangjianbo.toolsdemo', display_name: 'Demo' }] };
    reportsState = { reports: [report('r1')], total: 1 };
    renderPage();

    fireEvent.change(screen.getByLabelText('com_usage_filter_tool'), {
      target: { value: 'wangjianbo.toolsdemo' },
    });

    expect(capturedQuery).toEqual({
      page: 1,
      filters: {
        tool_id: 'wangjianbo.toolsdemo',
        user_sub: undefined,
        since: undefined,
        until: undefined,
      },
    });
  });

  it('export: server fn gets the visible filter, download gets a BOM’d CSV', async () => {
    toolsState = { tools: [{ tool_id: 'wangjianbo.toolsdemo', display_name: 'Demo' }] };
    reportsState = { reports: [report('r1', { status: 'failed' })], total: 1 };
    renderPage();
    fireEvent.change(screen.getByLabelText('com_usage_filter_tool'), {
      target: { value: 'wangjianbo.toolsdemo' },
    });

    exportRunReportsFn.mockResolvedValue({
      reports: [report('r1', { status: 'failed' })],
      truncated: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'com_usage_export' }));

    await waitFor(() => expect(downloadTextCsv).toHaveBeenCalledTimes(1));
    expect(exportRunReportsFn).toHaveBeenCalledWith({
      data: {
        tool_id: 'wangjianbo.toolsdemo',
        user_sub: undefined,
        since: undefined,
        until: undefined,
      },
    });
    const [filename, csv] = vi.mocked(downloadTextCsv).mock.calls[0];
    expect(filename).toMatch(/^tool-usage-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('com_usage_col_time');
    expect(csv).toContain('wangjianbo,user-wang,wangjianbo.toolsdemo,1.0.0,failed');
  });

  it('export failure announces instead of dying silently', async () => {
    reportsState = { reports: [report('r1')], total: 1 };
    exportRunReportsFn.mockRejectedValue(new Error('gateway down'));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'com_usage_export' }));
    await waitFor(() => expect(mockAnnounce).toHaveBeenCalledWith('com_usage_export_failed'));
    expect(downloadTextCsv).not.toHaveBeenCalled();
  });

  it('empty result: placeholder row and a disabled export', () => {
    reportsState = { reports: [], total: 0 };
    renderPage();
    expect(screen.getByText('com_usage_empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_usage_export' })).toBeDisabled();
  });

  it('load error: error state with export disabled', () => {
    reportsError = true;
    renderPage();
    expect(screen.getByText('com_usage_error')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'com_usage_export' })).toBeDisabled();
  });
});
