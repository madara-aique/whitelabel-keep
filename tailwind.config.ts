import type { Config } from 'tailwindcss';

/**
 * Design tokens for the kiosk touch UI.
 * Sizes are deliberately large: the kiosk is driven by finger taps on a
 * 15"–21" panel, not by a mouse.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          200: '#bce0ff',
          300: '#8ecdff',
          400: '#59b0ff',
          500: '#338dff',
          600: '#1b6ef5',
          700: '#1457e1',
          800: '#1747b6',
          900: '#193f8f',
        },
        kiosk: {
          bg: '#0b1220',
          surface: '#131c2e',
          border: '#233049',
          muted: '#8ea0bd',
        },
        success: '#22c55e',
        danger: '#ef4444',
        warning: '#f59e0b',
      },
      fontFamily: {
        sans: ['var(--font-poppins)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Touch targets and headings are scaled up versus a normal web app.
        kiosk: ['1.125rem', { lineHeight: '1.6rem' }],
      },
      minHeight: {
        touch: '3.5rem',
      },
      minWidth: {
        touch: '3.5rem',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.35)', opacity: '0' },
          '100%': { transform: 'scale(1.35)', opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 220ms ease-out both',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.24, 0, 0.38, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
