import type * as t from '@/types';
import { SectionControls } from './SectionControls';
import { SectionHeader } from './SectionHeader';
import { cn } from '@/utils';

/** One settings row: label column (chips, hint, description, actions) and control column (WS6). */
export function SettingsRow({
  label,
  htmlFor,
  description,
  learnMoreUrl,
  control,
  chips,
  hint,
  actions,
  error,
  dimmed,
}: t.SettingsRowProps) {
  const hasSubContent = description || actions || error;

  return (
    <div
      className={cn(
        'config-row flex w-full gap-6 rounded-md px-2.5 py-2 transition-opacity',
        hasSubContent ? 'items-start' : 'items-center',
        dimmed && 'opacity-50',
      )}
    >
      <SectionHeader
        title={label}
        description={description}
        learnMoreUrl={learnMoreUrl}
        htmlFor={htmlFor}
        titleAdornment={chips}
        subtitle={hint}
      >
        {actions}
      </SectionHeader>
      <SectionControls>
        {control}
        {error && (
          <div role="alert" className="text-xs text-(--cui-color-text-danger)">
            {error}
          </div>
        )}
      </SectionControls>
    </div>
  );
}
