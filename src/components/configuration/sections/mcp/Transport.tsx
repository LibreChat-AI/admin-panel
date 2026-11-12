import { useState } from 'react';
import { Button } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { planTransportSwitch, transportLabelKey, TRANSPORTS } from './transport';
import { SelectField } from '../../fields/SelectField';
import { labelForPath } from '../../meta';
import { useLocalize } from '@/hooks';
import { McpNote } from './Note';

/**
 * Transport choices (MCP-1, MCP-3): stdio servers run a local process only
 * librechat.yaml can define (D10), so stdio is listed but disabled unless the
 * server already is one, and a YAML `http` type is shown as written.
 */
function transportOptions(current: t.McpTransport, localize: t.LocalizeFn): t.SelectOption[] {
  const options: t.SelectOption[] = TRANSPORTS.map((value) => {
    const isLocked = value === 'stdio' && current !== 'stdio';
    return {
      value,
      label: localize(
        isLocked ? 'com_config_mcp_transport_stdio_locked' : transportLabelKey(value),
      ),
      disabled: isLocked,
    };
  });
  if (current !== 'http') return options;
  return [{ value: 'http', label: localize(transportLabelKey('http')) }, ...options];
}

/** "Headers, OAuth and API key": the fields a switch removes, by their labels. */
function listLabels(keys: string[], localize: t.LocalizeFn): string {
  return keys.map((key) => labelForPath(`mcpServers.{}.${key}`, localize)).join(', ');
}

/**
 * The server's transport (MCP-2). Switching drops every field the new
 * transport doesn't read, so nothing hidden is saved with the server; when
 * that removes saved settings, the switch waits for a confirmation inline.
 * Only the chosen transport waits: what the switch removes is planned from
 * the entry as it is when shown and confirmed, never from an older state.
 */
export function TransportSelect({
  id,
  label,
  entry,
  lower,
  transport,
  confirmPrune,
  onSwitch,
}: {
  id: string;
  label: string;
  entry: t.ConfigRecord;
  lower: t.ConfigRecord | undefined;
  transport: t.McpTransport;
  /** Ask before removing settings (a saved server); a new server switches at once. */
  confirmPrune: boolean;
  onSwitch: (plan: t.McpSwitchPlan) => void;
}) {
  const localize = useLocalize();
  const [waiting, setWaiting] = useState<t.McpTransport | null>(null);
  const noteId = `${id}-switch`;

  /** The switch to `next` and whether it must wait (a lock, or saved settings it removes). */
  const planFor = (next: t.McpTransport) => {
    const plan = planTransportSwitch(entry, next, lower);
    const waits = plan.locked.length > 0 || (plan.prune.length > 0 && confirmPrune);
    return { plan, waits };
  };

  const pending = (() => {
    if (waiting == null || waiting === transport) return null;
    const { plan, waits } = planFor(waiting);
    return waits ? { next: waiting, plan } : null;
  })();

  const choose = (value: string) => {
    const next = value as t.McpTransport;
    if (next === transport) {
      setWaiting(null);
      return;
    }
    const { plan, waits } = planFor(next);
    if (!waits) {
      setWaiting(null);
      onSwitch(plan);
      return;
    }
    setWaiting(next);
  };

  const nextLabel = pending ? localize(transportLabelKey(pending.next)) : '';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SelectField
        id={id}
        value={pending?.next ?? (transport || undefined)}
        options={transportOptions(transport, localize)}
        onChange={choose}
        placeholder={localize('com_config_mcp_transport_placeholder')}
        aria-label={label}
        aria-describedby={pending ? noteId : undefined}
      />
      {pending && pending.plan.locked.length > 0 && (
        <McpNote tone="lock" id={noteId}>
          {localize('com_config_mcp_transport_switch_locked', {
            transport: nextLabel,
            fields: listLabels(pending.plan.locked, localize),
          })}
        </McpNote>
      )}
      {pending && pending.plan.locked.length === 0 && (
        <McpNote
          tone="warning"
          id={noteId}
          actions={
            <>
              <Button
                htmlType="button"
                type="secondary"
                label={localize('com_ui_cancel')}
                onClick={() => setWaiting(null)}
              />
              <Button
                htmlType="button"
                type="primary"
                label={localize('com_config_mcp_transport_switch_confirm', {
                  transport: nextLabel,
                })}
                onClick={() => {
                  onSwitch(pending.plan);
                  setWaiting(null);
                }}
              />
            </>
          }
        >
          {localize('com_config_mcp_transport_switch_prune', {
            transport: nextLabel,
            fields: listLabels(pending.plan.prune, localize),
          })}
        </McpNote>
      )}
    </div>
  );
}
