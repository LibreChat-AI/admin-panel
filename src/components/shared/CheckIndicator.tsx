import { cn } from '@/utils';

const check =
  'flex size-4 shrink-0 items-center justify-center rounded border border-(--cui-color-stroke-default)';

/** 装饰性勾选指示（整行可点击的场景）：非交互控件，勾选状态由外层行表达。 */
export function CheckIndicator({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        check,
        on && 'border-(--cui-color-accent-primary) bg-(--cui-color-accent-primary)',
      )}
      aria-hidden="true"
    >
      {on && <span className="size-2 rounded-sm bg-white" />}
    </span>
  );
}
