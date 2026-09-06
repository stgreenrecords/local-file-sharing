/**
 * Tokens transcribed from design/precision_dual_pane_commander/DESIGN.md.
 * The token set is closed: extend here rather than using arbitrary values
 * in components.
 */
export default {
  darkMode: 'class',
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface: '#10141a',
        'surface-dim': '#10141a',
        'surface-bright': '#353940',
        'surface-container-lowest': '#0a0e14',
        'surface-container-low': '#181c22',
        'surface-container': '#1c2026',
        'surface-container-high': '#262a31',
        'surface-container-highest': '#31353c',
        'surface-variant': '#31353c',
        'surface-tint': '#7bd0ff',
        'on-surface': '#dfe2eb',
        'on-surface-variant': '#bdc8d1',
        'inverse-surface': '#dfe2eb',
        'inverse-on-surface': '#2d3137',
        outline: '#87929a',
        'outline-variant': '#3e484f',
        background: '#10141a',
        'on-background': '#dfe2eb',

        primary: '#8ed5ff',
        'on-primary': '#00354a',
        'primary-container': '#38bdf8',
        'on-primary-container': '#004965',
        'inverse-primary': '#00668a',
        'primary-fixed': '#c4e7ff',
        'primary-fixed-dim': '#7bd0ff',
        'on-primary-fixed': '#001e2c',
        'on-primary-fixed-variant': '#004c69',

        secondary: '#4de082',
        'on-secondary': '#003919',
        'secondary-container': '#00b55d',
        'on-secondary-container': '#003e1c',
        'secondary-fixed': '#6dfe9c',
        'secondary-fixed-dim': '#4de082',
        'on-secondary-fixed': '#00210c',
        'on-secondary-fixed-variant': '#005227',

        tertiary: '#c5c9ff',
        'on-tertiary': '#131e8c',
        'tertiary-container': '#a3abff',
        'on-tertiary-container': '#2c37a0',
        'tertiary-fixed': '#e0e0ff',
        'tertiary-fixed-dim': '#bdc2ff',
        'on-tertiary-fixed': '#000767',
        'on-tertiary-fixed-variant': '#2f3aa3',

        error: '#ffb4ab',
        'on-error': '#690005',
        'error-container': '#93000a',
        'on-error-container': '#ffdad6',

        /* Telemetry signal accents named in the design prose. */
        warning: '#fbbf24',
        danger: '#f43f5e'
      },
      borderRadius: {
        sm: '0.125rem',
        DEFAULT: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px'
      },
      spacing: {
        'space-2xs': '2px',
        'space-xs': '4px',
        'space-sm': '6px',
        'space-md': '8px',
        'space-base': '12px',
        'space-lg': '16px',
        'space-xl': '24px',
        'pane-gutter': '1px',
        'row-compact': '22px',
        'row-standard': '26px',
        'header-height': '36px',
        'function-bar-height': '32px',
        'statusbar-height': '24px'
      },
      fontFamily: {
        'headline-xl': ['Geist Sans', 'system-ui', 'sans-serif'],
        'headline-lg': ['Geist Sans', 'system-ui', 'sans-serif'],
        'headline-md': ['Geist Sans', 'system-ui', 'sans-serif'],
        'body-lg': ['Geist Sans', 'system-ui', 'sans-serif'],
        'body-md': ['Geist Sans', 'system-ui', 'sans-serif'],
        'body-sm': ['Geist Sans', 'system-ui', 'sans-serif'],
        'data-tabular-lg': ['JetBrains Mono', 'ui-monospace', 'monospace'],
        'data-tabular-md': ['JetBrains Mono', 'ui-monospace', 'monospace'],
        'data-tabular-sm': ['JetBrains Mono', 'ui-monospace', 'monospace'],
        'keybind-label': ['JetBrains Mono', 'ui-monospace', 'monospace']
      },
      fontSize: {
        'headline-xl': ['24px', { lineHeight: '32px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-lg': ['18px', { lineHeight: '24px', letterSpacing: '-0.015em', fontWeight: '600' }],
        'headline-md': ['14px', { lineHeight: '20px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-lg': ['13px', { lineHeight: '18px', letterSpacing: '-0.005em', fontWeight: '400' }],
        'body-md': ['12px', { lineHeight: '16px', letterSpacing: '0em', fontWeight: '400' }],
        'body-sm': ['11px', { lineHeight: '14px', letterSpacing: '0em', fontWeight: '400' }],
        'data-tabular-lg': ['13px', { lineHeight: '18px', letterSpacing: '-0.01em', fontWeight: '500' }],
        'data-tabular-md': ['11px', { lineHeight: '14px', letterSpacing: '0em', fontWeight: '400' }],
        'data-tabular-sm': ['10px', { lineHeight: '12px', letterSpacing: '0.02em', fontWeight: '400' }],
        'keybind-label': ['11px', { lineHeight: '14px', letterSpacing: '0.04em', fontWeight: '700' }]
      }
    }
  },
  plugins: []
}
