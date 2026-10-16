import type * as t from '@/types';
import { useLocalize } from '@/hooks';

/** Label cell of a settings row: label (14/500), hint (12) and description (13, muted). */
export function SectionHeader({
  title,
  description,
  learnMoreUrl,
  htmlFor,
  titleAdornment,
  subtitle,
  required,
  children,
}: t.SectionHeaderProps) {
  const localize = useLocalize();

  const text = (
    <>
      {title}
      {required && (
        <span className="settings-required" aria-hidden="true">
          *
        </span>
      )}
    </>
  );

  return (
    <div className="settings-row-label">
      <span className="flex items-center gap-1.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="settings-label">
            {text}
          </label>
        ) : (
          <span className="settings-label">{text}</span>
        )}
        {titleAdornment}
      </span>
      {subtitle}
      {description && (
        <p className="settings-help">
          {description}
          {learnMoreUrl && (
            <>
              {' '}
              <a href={learnMoreUrl} target="_blank" rel="noopener noreferrer">
                {localize('com_ui_read_more')}
              </a>
            </>
          )}
        </p>
      )}
      {children}
    </div>
  );
}
