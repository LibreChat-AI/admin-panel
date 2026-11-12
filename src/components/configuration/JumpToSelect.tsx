import { useState } from 'react';
import { Select } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/** "Jump to…" list of the tab's sections, for widths where the table of contents is hidden. */
export function JumpToSelect({ targets, onJump }: t.JumpToSelectProps) {
  const localize = useLocalize();
  const [resetKey, setResetKey] = useState(0);
  return (
    <div className="w-48 xl:hidden">
      <Select
        key={resetKey}
        placeholder={localize('com_config_shell_jump_to')}
        aria-label={localize('com_config_shell_jump_to')}
        onSelect={(id) => {
          onJump(id);
          setResetKey((key) => key + 1);
        }}
        options={targets.map((target) => ({
          value: target.id,
          label: target.child ? `   ${target.label}` : target.label,
        }))}
      />
    </div>
  );
}
