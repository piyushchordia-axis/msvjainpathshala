// Tailwind config — Next.js + shadcn/ui flavor.
// Exposes JP tokens under semantic namespaces so component classes read like
// `bg-primary`, `bg-status-success`, `bg-age-tarun`, `text-tier-shravak`.
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './pages/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1280px' } },
    extend: {
      colors: {
        // ── shadcn semantic tokens (driven by CSS vars in globals.css) ──
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },

        // ── JP brand palette (use sparingly; prefer semantic tokens above) ──
        saffron: { DEFAULT: '#D4621A', 700: '#B5521A', 300: '#E8A06A', 50: '#FCEFE3' },
        maroon:  { DEFAULT: '#7A1818', 700: '#5C1010', 50: '#F4E6E6' },
        cream:   { DEFAULT: '#FDF8F2', dark: '#F5EDE0', deeper: '#ECE0CC' },
        gold:    { DEFAULT: '#C8941F', 300: '#E6C26B', 50: '#FAF1DC' },
        ink:     { DEFAULT: '#1A0A00', sub: '#8B6F5E', dim: '#C4A882' },

        // ── Status (use for state colors only — never for identity) ──
        status: {
          'success':      '#166534', 'success-soft':      '#DCEEDD',
          'warning':      '#B45309', 'warning-soft':      '#FBEED0',
          'error':        '#B91C1C', 'error-soft':        '#FBE5E5',
          'info':         '#1E3A8A', 'info-soft':         '#DDE3F4',
          'neutral':      '#8B6F5E', 'neutral-soft':      '#F5EDE0',
        },

        // ── Age groups (identity color, NOT state) ──
        age: {
          'bal':          '#B91C1C', 'bal-soft':          '#FBE5E5',
          'kishor':       '#854D0E', 'kishor-soft':       '#F6ECD6',
          'tarun':        '#166534', 'tarun-soft':        '#DCEEDD',
          'yuva':         '#1E3A8A', 'yuva-soft':         '#DDE3F4',
        },

        // ── Spiritual tiers ──
        tier: {
          'jigyasu':      '#8B6F5E',
          'shravak':      '#166534',
          'sadhak':       '#1E3A8A',
          'shraman':      '#7A1818',
          'tirthankar':   '#C8941F',
        },
      },
      fontFamily: {
        display: ['var(--font-display)', '"Tiro Devanagari Sanskrit"', 'Mukta', 'Georgia', 'serif'],
        body:    ['var(--font-body)', 'Mukta', '-apple-system', 'system-ui', 'sans-serif'],
        mono:    ['var(--font-mono)', '"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 6px)',
        pill: '9999px',
      },
      boxShadow: {
        '1': '0 1px 2px rgba(122,24,24,0.06)',
        '2': '0 2px 6px rgba(122,24,24,0.08), 0 1px 2px rgba(122,24,24,0.06)',
        '3': '0 8px 24px rgba(122,24,24,0.10), 0 2px 6px rgba(122,24,24,0.06)',
        'focus': '0 0 0 3px rgba(212,98,26,0.28)',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up':   { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up':   'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
