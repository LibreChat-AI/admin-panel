import { Select } from '@clickhouse/click-ui';
import { useContext, useRef, useState } from 'react';
import type * as t from '@/types';
import { DraftsContext } from '@/contexts/DraftsContext';
import { useLocalize } from '@/hooks';

/** "Jump to…" list of the tab's sections, for widths where the table of contents is hidden. */
export function JumpToSelect({ targets, onJump }: t.JumpToSelectProps) {
  const localize = useLocalize();
  const blocked = useContext(DraftsContext)?.blocked ?? false;
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const [resetKey, setResetKey] = useState(0);
  return (
    <div className="w-48 xl:hidden">
      <Select
        key={`${resetKey}:${blocked}`}
        disabled={blocked}
        placeholder={localize('com_config_shell_jump_to')}
        aria-label={localize('com_config_shell_jump_to')}
        onSelect={(id) => {
          if (blockedRef.current) return;
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
