import { ThemeProvider } from 'styled-components';
import type { Theme as ClickUITheme } from '@clickhouse/click-ui';

type BrandControlsThemeProps = {
  children: React.ReactNode;
  mode: 'light' | 'dark';
};

const controlFont = '600 0.875rem/1.5 Inter, Arial, sans-serif';
const fieldFont = '400 0.875rem/1.5 Inter, Arial, sans-serif';
const menuFont = '500 0.875rem/1.5 Inter, Arial, sans-serif';

function brandControlsTheme(theme: ClickUITheme, mode: 'light' | 'dark'): ClickUITheme {
  const dark = mode === 'dark';
  const accent = dark ? '#89cff0' : '#0115e9';
  const accentHover = dark ? '#b8e4f8' : '#191970';
  const accentInk = dark ? '#010001' : '#fefeff';
  const danger = dark ? '#ffaaaa' : '#8f2525';
  const surface = dark ? '#0d203d' : '#fefeff';
  const surfaceHover = dark ? '#191970' : '#eaf5fc';
  const dangerBackground = `color-mix(in srgb, ${danger} 8%, ${surface})`;
  const dangerBackgroundHover = `color-mix(in srgb, ${danger} 14%, ${surface})`;
  const dangerBackgroundActive = `color-mix(in srgb, ${danger} 20%, ${surface})`;
  const line = dark ? '#3d607d' : '#c0c0c0';
  const text = dark ? '#fefeff' : '#010001';
  const muted = dark ? '#c0c0c0' : '#3d607d';
  const statusBackground = {
    success: dark ? '#19392b' : '#e4f5ec',
    warning: dark ? '#433819' : '#fff4d6',
    danger: dark ? '#42282a' : '#fde8e7',
    info: dark ? '#191970' : '#eaf5fc',
  };
  const statusText = {
    success: dark ? '#92e6bd' : '#177a55',
    warning: dark ? '#f0c36f' : '#9a6710',
    danger: dark ? '#ffaaaa' : '#b72c32',
    info: accent,
  };
  const button = theme.click.button;
  const field = theme.click.field;
  const menu = theme.click.genericMenu;

  return {
    ...theme,
    click: {
      ...theme.click,
      alert: {
        ...theme.click.alert,
        color: {
          ...theme.click.alert.color,
          background: {
            ...theme.click.alert.color.background,
            default: surface,
            ...statusBackground,
          },
          text: {
            ...theme.click.alert.color.text,
            default: muted,
            ...statusText,
          },
          iconForeground: {
            ...theme.click.alert.color.iconForeground,
            default: muted,
            ...statusText,
          },
        },
      },
      badge: {
        ...theme.click.badge,
        opaque: {
          ...theme.click.badge.opaque,
          color: {
            ...theme.click.badge.opaque.color,
            background: {
              ...theme.click.badge.opaque.color.background,
              default: surfaceHover,
              ...statusBackground,
            },
            text: {
              ...theme.click.badge.opaque.color.text,
              default: muted,
              ...statusText,
            },
            stroke: {
              ...theme.click.badge.opaque.color.stroke,
              default: line,
              ...statusBackground,
            },
          },
        },
        solid: {
          ...theme.click.badge.solid,
          color: {
            ...theme.click.badge.solid.color,
            background: {
              ...theme.click.badge.solid.color.background,
              success: statusText.success,
              warning: dark ? '#f0c36f' : '#80520b',
              danger,
              info: accent,
            },
            text: {
              ...theme.click.badge.solid.color.text,
              success: accentInk,
              warning: accentInk,
              danger: accentInk,
              info: accentInk,
            },
            stroke: {
              ...theme.click.badge.solid.color.stroke,
              success: statusText.success,
              warning: dark ? '#f0c36f' : '#80520b',
              danger,
              info: accent,
            },
          },
        },
      },
      button: {
        ...button,
        radii: { ...button.radii, all: '0.5rem' },
        basic: {
          ...button.basic,
          space: { ...button.basic.space, x: '1rem', y: '0.5625rem' },
          typography: {
            ...button.basic.typography,
            label: {
              ...button.basic.typography.label,
              default: controlFont,
              hover: controlFont,
              active: controlFont,
              disabled: controlFont,
            },
            mobile: {
              ...button.basic.typography.mobile,
              label: {
                ...button.basic.typography.mobile.label,
                default: controlFont,
                hover: controlFont,
                active: controlFont,
              },
            },
          },
          color: {
            ...button.basic.color,
            primary: {
              ...button.basic.color.primary,
              background: {
                ...button.basic.color.primary.background,
                default: accent,
                hover: accentHover,
                active: accentHover,
              },
              stroke: {
                ...button.basic.color.primary.stroke,
                default: accent,
                hover: accentHover,
                active: accentHover,
              },
              text: {
                ...button.basic.color.primary.text,
                default: accentInk,
                hover: accentInk,
                active: accentInk,
              },
            },
            secondary: {
              ...button.basic.color.secondary,
              background: {
                ...button.basic.color.secondary.background,
                default: surface,
                hover: surfaceHover,
                active: surfaceHover,
              },
              stroke: {
                ...button.basic.color.secondary.stroke,
                default: line,
                hover: accent,
                active: accent,
              },
              text: {
                ...button.basic.color.secondary.text,
                default: text,
                hover: text,
                active: text,
              },
            },
            danger: {
              ...button.basic.color.danger,
              background: {
                ...button.basic.color.danger.background,
                default: dangerBackground,
                hover: dangerBackgroundHover,
                active: dangerBackgroundActive,
              },
              stroke: {
                ...button.basic.color.danger.stroke,
                default: dangerBackground,
                hover: dangerBackgroundHover,
                active: dangerBackgroundActive,
              },
              text: {
                ...button.basic.color.danger.text,
                default: danger,
                hover: danger,
                active: danger,
              },
            },
            empty: {
              ...button.basic.color.empty,
              text: {
                ...button.basic.color.empty.text,
                default: accent,
                hover: accentHover,
                active: accent,
              },
            },
          },
        },
        iconButton: {
          ...button.iconButton,
          radii: { ...button.iconButton.radii, all: '0.5rem' },
          color: {
            ...button.iconButton.color,
            primary: {
              ...button.iconButton.color.primary,
              background: {
                ...button.iconButton.color.primary.background,
                hover: surfaceHover,
                active: surfaceHover,
              },
              text: {
                ...button.iconButton.color.primary.text,
                default: text,
                hover: accent,
                active: accent,
              },
            },
            secondary: {
              ...button.iconButton.color.secondary,
              background: {
                ...button.iconButton.color.secondary.background,
                default: accent,
                hover: accentHover,
                active: accentHover,
              },
              text: {
                ...button.iconButton.color.secondary.text,
                default: accentInk,
                hover: accentInk,
                active: accentInk,
              },
            },
            danger: {
              ...button.iconButton.color.danger,
              background: {
                ...button.iconButton.color.danger.background,
                default: dangerBackground,
                hover: dangerBackgroundHover,
                active: dangerBackgroundActive,
              },
              stroke: {
                ...button.iconButton.color.danger.stroke,
                default: dangerBackground,
                hover: dangerBackgroundHover,
                active: dangerBackgroundActive,
              },
              text: {
                ...button.iconButton.color.danger.text,
                default: danger,
                hover: danger,
                active: danger,
              },
            },
          },
        },
      },
      field: {
        ...field,
        radii: { ...field.radii, all: '0.5rem' },
        space: { ...field.space, x: '0.75rem', y: '0.5625rem' },
        typography: {
          ...field.typography,
          fieldText: {
            ...field.typography.fieldText,
            default: fieldFont,
            hover: fieldFont,
            active: fieldFont,
            disabled: fieldFont,
            error: fieldFont,
          },
        },
        color: {
          ...field.color,
          genericLabel: {
            ...field.color.genericLabel,
            default: text,
            hover: text,
            active: text,
          },
          background: {
            ...field.color.background,
            default: surface,
            hover: surfaceHover,
            active: surface,
            error: surface,
          },
          text: {
            ...field.color.text,
            default: text,
            hover: text,
            active: text,
            error: danger,
          },
          stroke: {
            ...field.color.stroke,
            default: line,
            hover: accent,
            active: accent,
            error: danger,
          },
          label: {
            ...field.color.label,
            default: text,
            hover: text,
            active: text,
            error: danger,
          },
          placeholder: { ...field.color.placeholder, default: muted },
        },
      },
      genericMenu: {
        ...menu,
        panel: {
          ...menu.panel,
          radii: { ...menu.panel.radii, all: '0.5rem' },
          size: { ...menu.panel.size, height: '2.625rem' },
          color: {
            ...menu.panel.color,
            background: { ...menu.panel.color.background, default: surface },
            stroke: { ...menu.panel.color.stroke, default: line },
          },
        },
        item: {
          ...menu.item,
          space: { ...menu.item.space, x: '0.625rem', y: '0.4375rem' },
          typography: {
            ...menu.item.typography,
            label: {
              ...menu.item.typography.label,
              default: menuFont,
              hover: menuFont,
              active: menuFont,
              disabled: menuFont,
            },
          },
          color: {
            ...menu.item.color,
            default: {
              ...menu.item.color.default,
              text: {
                ...menu.item.color.default.text,
                default: text,
                hover: text,
                active: text,
                muted,
              },
              background: {
                ...menu.item.color.default.background,
                default: surface,
                hover: surfaceHover,
                active: surfaceHover,
              },
              stroke: {
                ...menu.item.color.default.stroke,
                default: line,
                focus: accent,
              },
            },
          },
        },
      },
    },
  };
}

export function BrandControlsTheme({ children, mode }: BrandControlsThemeProps) {
  return (
    <ThemeProvider theme={(theme) => brandControlsTheme(theme as ClickUITheme, mode)}>
      {children}
    </ThemeProvider>
  );
}
