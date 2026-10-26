import { useState } from 'react';
import { Icon, Switch } from '@clickhouse/click-ui';
import type { BaseSystemCapability } from '@librechat/data-schemas';
import type * as t from '@/types';
import { CapabilityImplications, CAPABILITY_CATEGORIES } from '@/constants';
import { useLocalize, usePilotMode } from '@/hooks';
import { cn } from '@/utils';

function isPilotConfigWriteCapability(capability: string): boolean {
  return (
    capability === 'manage:configs' ||
    capability === 'assign:configs' ||
    capability.startsWith('manage:configs:') ||
    capability.startsWith('assign:configs:')
  );
}

const ALL_COLLAPSED = new Set(CAPABILITY_CATEGORIES.map((c) => c.key));

function getImpliedSet(capabilities: Record<string, boolean>): Set<string> {
  const implied = new Set<string>();
  for (const [cap, enabled] of Object.entries(capabilities)) {
    if (enabled) {
      for (const impliedCap of CapabilityImplications[cap as BaseSystemCapability] ?? []) {
        implied.add(impliedCap);
      }
    }
  }
  return implied;
}

export function CapabilityPanel({ capabilities, onChange, disabled }: t.CapabilityPanelProps) {
  const localize = useLocalize();
  const pilotEnabled = usePilotMode();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(ALL_COLLAPSED));
  const impliedSet = getImpliedSet(capabilities);

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleToggle = (cap: string, value: boolean) => {
    const updated = { ...capabilities, [cap]: value };
    if (!value) {
      for (const impliedCap of CapabilityImplications[cap as BaseSystemCapability] ?? []) {
        const stillImplied = Object.entries(updated).some(
          ([k, v]) =>
            v &&
            k !== cap &&
            (CapabilityImplications[k as BaseSystemCapability] ?? []).includes(impliedCap),
        );
        if (!stillImplied) updated[impliedCap] = false;
      }
    }
    onChange(updated);
  };

  const handleToggleAll = (categoryKey: string, value: boolean) => {
    const category = CAPABILITY_CATEGORIES.find((c) => c.key === categoryKey);
    if (!category) return;
    const updated = { ...capabilities };
    for (const cap of category.capabilities) {
      if (pilotEnabled && isPilotConfigWriteCapability(cap)) continue;
      updated[cap] = value;
    }
    onChange(updated);
  };

  return (
    <div className="flex flex-col gap-2">
      {CAPABILITY_CATEGORIES.map((category) => {
        const caps = pilotEnabled
          ? category.capabilities.filter((cap) => !isPilotConfigWriteCapability(cap))
          : category.capabilities;
        if (caps.length === 0) return null;
        const enabledCount = caps.filter(
          (c: string) => capabilities[c] || impliedSet.has(c),
        ).length;
        const allEnabled = enabledCount === caps.length;
        const isOpen = !collapsed.has(category.key);

        return (
          <div key={category.key} className="rounded-inner border border-line bg-surface">
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isOpen}
              onClick={() => toggleCollapsed(category.key)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleCollapsed(category.key);
                }
              }}
              className="aimo-disclosure"
            >
              <div className="flex flex-1 items-center gap-2">
                <Icon
                  name="chevron-right"
                  size="sm"
                  className={cn('text-muted transition-transform', isOpen && 'rotate-90')}
                />
                <span className="text-sm font-semibold text-ink">
                  {localize(category.labelKey)}
                </span>
              </div>
              <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <span className="text-xs text-muted tabular-nums">
                  {allEnabled ? localize('com_ui_all') : `${enabledCount}/${caps.length}`}
                </span>
                <Switch
                  id={`cap-all-${category.key}`}
                  checked={allEnabled}
                  onCheckedChange={(v) => handleToggleAll(category.key, v)}
                  disabled={disabled}
                  aria-label={`${localize(category.labelKey)}: ${localize('com_ui_select_all')}`}
                />
              </div>
            </div>
            {isOpen && (
              <div className="border-t border-line2 px-4 py-2">
                <div className="flex flex-col gap-1 pl-6">
                  {caps.map((cap: string) => {
                    const isImplied = impliedSet.has(cap) && !capabilities[cap];
                    const isChecked = capabilities[cap] || isImplied;
                    const capLabel = localize(`com_cap_${cap.replace(/:/g, '_')}`);
                    const switchId = `cap-${cap.replace(/:/g, '_')}`;

                    return (
                      <label
                        key={cap}
                        htmlFor={disabled || isImplied ? undefined : switchId}
                        className={cn(
                          'flex items-center justify-between py-1.5',
                          disabled || isImplied ? 'cursor-default' : 'cursor-pointer',
                        )}
                      >
                        <div className="flex flex-col">
                          <span
                            className={cn('text-sm', isImplied ? 'text-muted/70' : 'text-ink2')}
                          >
                            {capLabel}
                          </span>
                          {isImplied && (
                            <span className="flex items-center gap-1 text-xs text-link">
                              <Icon name="information" size="xs" />
                              {localize('com_cap_implied_by', {
                                cap: localize(
                                  `com_cap_${
                                    Object.entries(capabilities)
                                      .find(
                                        ([k, v]) =>
                                          v &&
                                          (
                                            CapabilityImplications[k as BaseSystemCapability] ?? []
                                          ).includes(cap as BaseSystemCapability),
                                      )?.[0]
                                      ?.replace(/:/g, '_') ?? cap.replace(/:/g, '_')
                                  }`,
                                ),
                              })}
                            </span>
                          )}
                        </div>
                        <Switch
                          id={switchId}
                          checked={isChecked}
                          onCheckedChange={(v) => handleToggle(cap, v)}
                          disabled={disabled || isImplied}
                          aria-label={`${localize(category.labelKey)}: ${capLabel}`}
                          aria-disabled={isImplied || undefined}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
