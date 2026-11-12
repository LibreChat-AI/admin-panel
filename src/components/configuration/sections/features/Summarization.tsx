import { useContext } from 'react';
import type * as t from '@/types';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { UnknownSettings } from '../../UnknownSettings';
import { TriggerControl } from './Trigger';
import { FeatureFields } from './Fields';
import { RefPicker } from './Picker';

/**
 * Summarization (FX-4): whether and when it runs (the trigger editor), then
 * the provider and model that write summaries, with model suggestions for
 * the chosen provider, then the prompts and limits.
 */
export function SummarizationRenderer(props: t.FieldRendererProps) {
  const rowFilter = useContext(RowFilterContext);
  const { fields, parentPath, parentValue, getValue } = props;
  const provider = getValue(`${parentPath}.provider`, undefined);
  const modelSource: t.OptionSource | undefined =
    typeof provider === 'string' && provider !== '' ? `models:${provider}` : undefined;
  const controls: t.FeatureControls = {
    trigger: (control) => <TriggerControl {...control} />,
    provider: (control) => <RefPicker {...control} source="providers" />,
    model: (control) => <RefPicker {...control} source={modelSource} />,
  };
  return (
    <>
      <FeatureFields {...props} controls={controls} />
      {!rowFilter && <UnknownSettings fields={fields} value={parentValue} path={parentPath} />}
    </>
  );
}
