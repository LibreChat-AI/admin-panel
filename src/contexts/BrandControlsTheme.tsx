import { ThemeProvider } from 'styled-components';
import type { Theme as ClickUITheme } from '@clickhouse/click-ui';

type BrandControlsThemeProps = {
  children: React.ReactNode;
};

const fontStack = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const controlFont = `600 0.875rem/1.25 ${fontStack}`;
const fieldFont = `400 0.875rem/1.5 ${fontStack}`;
const labelFont = `600 0.75rem/1.5 ${fontStack}`;
const menuFont = `500 0.875rem/1.5 ${fontStack}`;
const titleFont = `600 1.3125rem/1.3 ${fontStack}`;
const badgeFont = `600 0.75rem/1.4 ${fontStack}`;
const pill = '9999px';

/**
 * Every colour resolves to an AIMO CSS variable (see `styles.css`), so the same
 * theme object serves light and dark mode — the variables flip with the root class.
 */
const c = {
  accent: '#0066cc',
  accentHover: '#0071e3',
  accentInk: '#ffffff',
  danger: '#e0303e',
  dangerHover: '#c92a37',
  surface: 'var(--surface)',
  canvas: 'var(--canvas)',
  fill: 'var(--fill)',
  ink: 'var(--ink)',
  ink2: 'var(--ink2)',
  muted: 'var(--muted)',
  line: 'var(--line)',
  link: 'var(--link)',
  softBlue: 'var(--soft-blue)',
  track: 'var(--track)',
  scrim: 'var(--scrim)',
  shadow: 'var(--shadow)',
  transparent: 'transparent',
  disabledAccent: 'color-mix(in srgb, #0066cc 50%, transparent)',
  disabledInk: 'color-mix(in srgb, var(--muted) 60%, transparent)',
};

const status = {
  background: {
    success: 'var(--green-soft)',
    warning: 'var(--amber-soft)',
    danger: 'var(--red-soft)',
    info: 'var(--soft-blue)',
    neutral: 'var(--fill)',
  },
  text: {
    success: 'var(--green-ink)',
    warning: 'var(--amber-ink)',
    danger: 'var(--red-ink)',
    info: 'var(--link)',
    neutral: 'var(--ink2)',
  },
};

const states = <T extends string>(value: string, keys: readonly T[]): Record<T, string> =>
  Object.fromEntries(keys.map((key) => [key, value])) as Record<T, string>;

function brandControlsTheme(theme: ClickUITheme): ClickUITheme {
  const button = theme.click.button;
  const field = theme.click.field;
  const menu = theme.click.genericMenu;
  const iconButton = button.iconButton;

  return {
    ...theme,
    click: {
      ...theme.click,
      global: {
        ...theme.click.global,
        color: {
          ...theme.click.global.color,
          stroke: { ...theme.click.global.color.stroke, default: c.line, muted: c.line },
          background: { ...theme.click.global.color.background, default: c.surface, muted: c.fill },
          text: {
            ...theme.click.global.color.text,
            default: c.ink,
            muted: c.muted,
            link: { ...theme.click.global.color.text.link, default: c.link, hover: c.accentHover },
            danger: 'var(--red-ink)',
          },
          title: { ...theme.click.global.color.title, default: c.ink, muted: c.muted },
          outline: { ...theme.click.global.color.outline, default: c.accent },
        },
      },
      alert: {
        ...theme.click.alert,
        color: {
          ...theme.click.alert.color,
          background: {
            ...theme.click.alert.color.background,
            default: c.fill,
            ...status.background,
          },
          text: { ...theme.click.alert.color.text, default: c.ink2, ...status.text },
          iconForeground: {
            ...theme.click.alert.color.iconForeground,
            default: c.muted,
            ...status.text,
          },
        },
      },
      avatar: {
        ...theme.click.avatar,
        size: { ...theme.click.avatar.size, width: '1.75rem', height: '1.75rem' },
        color: {
          ...theme.click.avatar.color,
          background: states('#2a2a2c', ['default', 'hover', 'active'] as const),
          text: states('#ffffff', ['default', 'hover', 'active'] as const),
        },
      },
      badge: {
        ...theme.click.badge,
        space: {
          ...theme.click.badge.space,
          sm: { ...theme.click.badge.space.sm, x: '0.5625rem', y: '0.1875rem' },
          md: { ...theme.click.badge.space.md, x: '0.5625rem', y: '0.1875rem' },
        },
        typography: {
          ...theme.click.badge.typography,
          label: {
            ...theme.click.badge.typography.label,
            sm: { ...theme.click.badge.typography.label.sm, default: badgeFont },
            md: { ...theme.click.badge.typography.label.md, default: badgeFont },
          },
        },
        opaque: {
          ...theme.click.badge.opaque,
          color: {
            ...theme.click.badge.opaque.color,
            background: {
              ...theme.click.badge.opaque.color.background,
              default: c.fill,
              ...status.background,
            },
            text: { ...theme.click.badge.opaque.color.text, default: c.ink2, ...status.text },
            stroke: {
              ...theme.click.badge.opaque.color.stroke,
              default: c.fill,
              ...status.background,
            },
          },
        },
      },
      button: {
        ...button,
        radii: { ...button.radii, all: pill },
        basic: {
          ...button.basic,
          space: { ...button.basic.space, x: '1.125rem', y: '0.5625rem' },
          typography: {
            ...button.basic.typography,
            label: {
              ...button.basic.typography.label,
              ...states(controlFont, ['default', 'hover', 'active', 'disabled'] as const),
            },
            mobile: {
              ...button.basic.typography.mobile,
              label: {
                ...button.basic.typography.mobile.label,
                ...states(controlFont, ['default', 'hover', 'active'] as const),
              },
            },
          },
          color: {
            ...button.basic.color,
            primary: {
              ...button.basic.color.primary,
              background: {
                ...button.basic.color.primary.background,
                default: c.accent,
                hover: c.accentHover,
                active: c.accent,
                disabled: c.disabledAccent,
              },
              stroke: {
                ...button.basic.color.primary.stroke,
                default: c.accent,
                hover: c.accentHover,
                active: c.accent,
                disabled: c.transparent,
              },
              text: {
                ...button.basic.color.primary.text,
                ...states(c.accentInk, ['default', 'hover', 'active', 'disabled'] as const),
              },
            },
            secondary: {
              ...button.basic.color.secondary,
              background: {
                ...button.basic.color.secondary.background,
                default: c.transparent,
                hover: c.softBlue,
                active: c.softBlue,
                disabled: c.transparent,
              },
              stroke: {
                ...button.basic.color.secondary.stroke,
                default: c.accent,
                hover: c.accent,
                active: c.accent,
                disabled: c.disabledAccent,
              },
              text: {
                ...button.basic.color.secondary.text,
                default: c.link,
                hover: c.link,
                active: c.link,
                disabled: c.disabledAccent,
              },
            },
            danger: {
              ...button.basic.color.danger,
              background: {
                ...button.basic.color.danger.background,
                default: c.danger,
                hover: c.dangerHover,
                active: c.danger,
              },
              stroke: {
                ...button.basic.color.danger.stroke,
                default: c.danger,
                hover: c.dangerHover,
                active: c.danger,
              },
              text: {
                ...button.basic.color.danger.text,
                ...states(c.accentInk, ['default', 'hover', 'active'] as const),
              },
            },
            empty: {
              ...button.basic.color.empty,
              text: {
                ...button.basic.color.empty.text,
                default: c.link,
                hover: c.accentHover,
                active: c.link,
              },
            },
          },
        },
        iconButton: {
          ...iconButton,
          radii: { ...iconButton.radii, all: pill },
          default: { ...iconButton.default, space: { x: '0.5rem', y: '0.5rem' } },
          sm: { ...iconButton.sm, space: { x: '0.5rem', y: '0.5rem' } },
          color: {
            ...iconButton.color,
            primary: {
              ...iconButton.color.primary,
              background: {
                ...iconButton.color.primary.background,
                default: c.transparent,
                hover: c.fill,
                active: c.fill,
              },
              stroke: {
                ...iconButton.color.primary.stroke,
                ...states(c.transparent, ['default', 'hover', 'active'] as const),
              },
              text: {
                ...iconButton.color.primary.text,
                default: c.muted,
                hover: c.ink,
                active: c.ink,
              },
            },
            ghost: {
              ...iconButton.color.ghost,
              background: {
                ...iconButton.color.ghost.background,
                default: c.transparent,
                hover: c.fill,
                active: c.fill,
              },
              text: {
                ...iconButton.color.ghost.text,
                default: c.muted,
                hover: c.ink,
                active: c.ink,
              },
            },
            secondary: {
              ...iconButton.color.secondary,
              background: {
                ...iconButton.color.secondary.background,
                default: c.accent,
                hover: c.accentHover,
                active: c.accent,
              },
              text: {
                ...iconButton.color.secondary.text,
                ...states(c.accentInk, ['default', 'hover', 'active'] as const),
              },
            },
            danger: {
              ...iconButton.color.danger,
              background: {
                ...iconButton.color.danger.background,
                default: c.transparent,
                hover: 'var(--red-soft)',
                active: 'var(--red-soft)',
              },
              stroke: {
                ...iconButton.color.danger.stroke,
                ...states(c.transparent, ['default', 'hover', 'active'] as const),
              },
              text: {
                ...iconButton.color.danger.text,
                ...states('var(--red-ink)', ['default', 'hover', 'active'] as const),
              },
            },
            disabled: {
              ...iconButton.color.disabled,
              background: { ...iconButton.color.disabled.background, default: c.transparent },
              text: { ...iconButton.color.disabled.text, default: c.disabledInk },
            },
          },
        },
      },
      datePicker: {
        ...theme.click.datePicker,
        dateOption: {
          ...theme.click.datePicker.dateOption,
          radii: { ...theme.click.datePicker.dateOption.radii, default: pill },
          color: {
            ...theme.click.datePicker.dateOption.color,
            label: {
              ...theme.click.datePicker.dateOption.color.label,
              default: c.ink,
              hover: c.ink,
              active: c.accentInk,
              range: c.ink,
            },
            background: {
              ...theme.click.datePicker.dateOption.color.background,
              default: c.surface,
              hover: c.fill,
              active: c.accent,
              disabled: c.surface,
              range: c.softBlue,
            },
            stroke: {
              ...theme.click.datePicker.dateOption.color.stroke,
              default: c.surface,
              hover: c.fill,
              active: c.accent,
              disabled: c.surface,
              range: c.softBlue,
            },
          },
        },
      },
      dialog: {
        ...theme.click.dialog,
        space: { ...theme.click.dialog.space, y: '1.5rem', x: '1.75rem' },
        radii: { ...theme.click.dialog.radii, all: '18px' },
        shadow: { ...theme.click.dialog.shadow, default: c.shadow },
        typography: {
          ...theme.click.dialog.typography,
          title: { ...theme.click.dialog.typography.title, default: titleFont },
        },
        color: {
          ...theme.click.dialog.color,
          background: { ...theme.click.dialog.color.background, default: c.surface },
          title: { ...theme.click.dialog.color.title, default: c.ink },
          description: { ...theme.click.dialog.color.description, default: c.ink2 },
          opaqueBackground: { ...theme.click.dialog.color.opaqueBackground, default: c.scrim },
        },
      },
      field: {
        ...field,
        radii: { ...field.radii, all: pill },
        space: { ...field.space, x: '1rem', y: '0.5625rem' },
        typography: {
          ...field.typography,
          label: {
            ...field.typography.label,
            ...states(labelFont, ['default', 'hover', 'active', 'disabled', 'error'] as const),
          },
          fieldText: {
            ...field.typography.fieldText,
            ...states(fieldFont, ['default', 'hover', 'active', 'disabled', 'error'] as const),
          },
        },
        color: {
          ...field.color,
          genericLabel: {
            ...field.color.genericLabel,
            ...states(c.ink, ['default', 'hover', 'active'] as const),
          },
          background: {
            ...field.color.background,
            default: c.surface,
            hover: c.surface,
            active: c.surface,
            error: c.surface,
          },
          text: {
            ...field.color.text,
            default: c.ink,
            hover: c.ink,
            active: c.ink,
            error: c.ink,
          },
          stroke: {
            ...field.color.stroke,
            default: c.line,
            hover: c.accent,
            active: c.accent,
            error: c.danger,
          },
          label: {
            ...field.color.label,
            default: c.muted,
            hover: c.muted,
            active: c.ink,
            error: 'var(--red-ink)',
          },
          placeholder: { ...field.color.placeholder, default: c.muted },
        },
      },
      genericMenu: {
        ...menu,
        panel: {
          ...menu.panel,
          radii: { ...menu.panel.radii, all: '14px' },
          color: {
            ...menu.panel.color,
            background: { ...menu.panel.color.background, default: c.surface },
            stroke: { ...menu.panel.color.stroke, default: c.line },
          },
        },
        item: {
          ...menu.item,
          space: { ...menu.item.space, x: '0.625rem', y: '0.4375rem' },
          typography: {
            ...menu.item.typography,
            label: {
              ...menu.item.typography.label,
              ...states(menuFont, ['default', 'hover', 'active', 'disabled'] as const),
            },
          },
          color: {
            ...menu.item.color,
            default: {
              ...menu.item.color.default,
              text: {
                ...menu.item.color.default.text,
                default: c.ink,
                hover: c.ink,
                active: c.ink,
                muted: c.muted,
              },
              background: {
                ...menu.item.color.default.background,
                default: c.surface,
                hover: c.fill,
                active: c.fill,
              },
              stroke: { ...menu.item.color.default.stroke, default: c.line, focus: c.accent },
            },
          },
        },
      },
      switch: {
        ...theme.click.switch,
        size: { ...theme.click.switch.size, width: '2.5rem', height: '1.5rem' },
        color: {
          ...theme.click.switch.color,
          background: {
            ...theme.click.switch.color.background,
            default: c.track,
            active: c.accent,
            disabled: c.track,
          },
          stroke: {
            ...theme.click.switch.color.stroke,
            default: c.track,
            active: c.accent,
            disabled: c.track,
          },
          indicator: states('#ffffff', ['default', 'active', 'disabled'] as const),
        },
      },
      tabs: {
        ...theme.click.tabs,
        typography: {
          ...theme.click.tabs.typography,
          label: {
            ...theme.click.tabs.typography.label,
            ...states(controlFont, ['default', 'hover', 'active'] as const),
          },
        },
      },
      toast: {
        ...theme.click.toast,
        radii: { ...theme.click.toast.radii, all: pill },
        shadow: 'none',
        typography: {
          ...theme.click.toast.typography,
          title: { ...theme.click.toast.typography.title, default: controlFont },
        },
      },
    },
  };
}

export function BrandControlsTheme({ children }: BrandControlsThemeProps) {
  return (
    <ThemeProvider theme={(theme) => brandControlsTheme(theme as ClickUITheme)}>
      {children}
    </ThemeProvider>
  );
}
