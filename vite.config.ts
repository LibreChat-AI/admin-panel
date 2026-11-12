import path from 'node:path';
import { defineConfig } from 'vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';

import viteReact from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const config = defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [
    devtools({ consolePiping: { enabled: false } }),
    tailwindcss(),
    ...(process.env.VITEST ? [] : [tanstackStart()]),
    viteReact(),
  ],
  resolve: {
    tsconfigPaths: true,
    dedupe: ['react', 'react-dom', '@radix-ui/react-dialog'],
    alias: {
      url: path.resolve(import.meta.dirname, 'src/shims/url.ts'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      'react-dom/client',
      'react-dom/server',
      'dayjs',
      'dayjs/plugin/advancedFormat.js',
      'dayjs/plugin/duration.js',
      'dayjs/plugin/localizedFormat.js',
      'dayjs/plugin/relativeTime.js',
      'dayjs/plugin/timezone.js',
      'dayjs/plugin/updateLocale.js',
      'dayjs/plugin/utc.js',
      'lodash-es',
      'react-window',
      'react-virtualized-auto-sizer',
      'react-sortablejs/dist/index.js',
      'react-syntax-highlighter',
      'react-syntax-highlighter/dist/cjs/languages/hljs/sql.js',
      'react-syntax-highlighter/dist/cjs/languages/hljs/bash.js',
      'react-syntax-highlighter/dist/cjs/languages/hljs/json.js',
      'react-syntax-highlighter/dist/cjs/languages/hljs/typescript.js',
      'react-syntax-highlighter/dist/cjs/languages/hljs/plaintext.js',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-accordion',
      '@radix-ui/react-toast',
      '@radix-ui/react-avatar',
      '@radix-ui/react-popover',
      '@radix-ui/react-separator',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-context-menu',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-tabs',
      '@radix-ui/react-hover-card',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-switch',
      '@h6s/calendar',
      '@tanstack/router-core',
      '@tanstack/router-core/ssr/client',
      '@tanstack/router-core/ssr/server',
      '@tanstack/history',
      'tiny-invariant',
      'seroval',
    ],
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'icons',
              test: /click-ui.*Icon|click-ui.*icon/,
              priority: 30,
            },
            {
              name: 'vendor-ui',
              test: /node_modules\/@clickhouse\/click-ui/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
  ssr: {
    external: ['@playwright/test', 'playwright-core', 'playwright', '@axe-core/playwright'],
    noExternal: ['@clickhouse/click-ui'],
  },
});

export default config;
