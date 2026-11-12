import type * as t from '@/types';
import { RefSelectField } from '../../fields/RefSelectField';
import { FieldControl } from '../../renderer/FieldControl';
import { defaultPlaceholder } from './state';
import { useLocalize } from '@/hooks';

/**
 * A provider or model reference with suggestions from `useOptionSources`
 * (`endpoints`, `models:<provider>`), free entry, the value beneath as its
 * placeholder, and a hint when the definition it belongs to needs it.
 */
export function RefPicker({ source, requiredHint, ...props }: t.RefPickerProps) {
  const localize = useLocalize();
  if (props.disabled) return <FieldControl {...props} />;
  const value = typeof props.value === 'string' && props.value !== '' ? props.value : undefined;
  const missing = requiredHint === true && value === undefined && props.fieldDefault.value == null;
  return (
    <div className="flex w-full flex-col gap-1">
      <RefSelectField
        id={props.id}
        value={value}
        source={source}
        onChange={props.onChange}
        onClear={props.onClear}
        placeholder={defaultPlaceholder(props.fieldDefault, localize)}
        aria-label={props.label}
      />
      {missing && (
        <span className="text-xs text-(--settings-warn-fg)">
          {localize('com_config_features_required_for_inline')}
        </span>
      )}
    </div>
  );
}
