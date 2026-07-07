/** @type {import('tailwindcss').Config} */
// Verbatim from .memory-bank/tech-details/design-system.md §9. Pinned Tailwind v3
// (v4 is CSS-first @theme and would silently ignore this JS config).
module.exports = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)', 'surface-2': 'var(--surface-2)',
        line: 'var(--line)', ink: 'var(--ink)', muted: 'var(--muted)', faint: 'var(--faint)',
        primary: { DEFAULT: 'var(--primary)', press: 'var(--primary-press)' },
        success: 'var(--success)', danger: 'var(--danger)',
        warning: 'var(--warning)', live: 'var(--live)',
      },
      fontFamily: {
        sans: ['Rubik', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"Courier New"', 'monospace'],
      },
      fontSize: {
        h1: ['34px', { lineHeight: '1.15', letterSpacing: '-0.5px', fontWeight: '800' }],
        h2: ['24px', { lineHeight: '1.2', fontWeight: '800' }],
        h3: ['18px', { lineHeight: '1.25', fontWeight: '900' }],
        body: ['15px', { lineHeight: '1.5' }],
        small: ['13px', { lineHeight: '1.45' }],
        caption: ['11px', { lineHeight: '1.4', fontWeight: '700' }],
        overline: ['10px', { lineHeight: '1.3', letterSpacing: '1.5px', fontWeight: '700' }],
        'timer-lg': ['96px', { lineHeight: '1', letterSpacing: '-0.04em', fontWeight: '900' }],
        'timer-md': ['64px', { lineHeight: '1', letterSpacing: '-0.04em', fontWeight: '900' }],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '20px', tile: '14px' },
      boxShadow: {
        sticker: '3px 3px 0 var(--ink)',
        'sticker-lg': '4px 4px 0 var(--ink)',
        soft: '0 6px 12px rgb(34 30 23 / 0.10)',
      },
      spacing: { 4.5: '18px', 7: '28px' },
      maxWidth: { content: '1120px' },
      transitionTimingFunction: { spring: 'cubic-bezier(0.34,1.56,0.64,1)' },
      keyframes: {
        'sticker-in': {
          '0%': { transform: 'rotate(24deg) scale(.6)', opacity: '0' },
          '60%': { transform: 'rotate(-8deg) scale(1.1)', opacity: '1' },
          '80%': { transform: 'rotate(5deg) scale(.98)' },
          '100%': { transform: 'rotate(3deg) scale(1)' },
        },
        'count-drop': {
          '0%': { transform: 'translateY(-40px) scale(.6)', opacity: '0' },
          '60%': { transform: 'translateY(0) scale(1.1)', opacity: '1' },
          '100%': { transform: 'translateY(0) scale(1)' },
        },
        'pulse-soft': { '0%,100%': { opacity: '1' }, '50%': { opacity: '.75' } },
        'blink-chaos': { '0%,100%': { opacity: '1' }, '50%': { opacity: '.3' } },
        'confetti-fall': {
          '0%': { transform: 'translateY(-20px) rotate(0deg)', opacity: '1' },
          '100%': { transform: 'translateY(140px) rotate(180deg)', opacity: '1' },
        },
        'toast-in': {
          '0%': { transform: 'translateX(24px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        'badge-pop': { '0%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.15)' }, '100%': { transform: 'scale(1)' } },
      },
      animation: {
        'sticker-in': 'sticker-in 700ms cubic-bezier(0.34,1.56,0.64,1) both',
        'count-drop': 'count-drop 600ms cubic-bezier(0.34,1.56,0.64,1) both',
        'pulse-soft': 'pulse-soft 1200ms ease-in-out infinite',
        'blink-chaos': 'blink-chaos 700ms steps(2) infinite',
        'confetti-fall': 'confetti-fall 1500ms ease-in both',
        'toast-in': 'toast-in 250ms cubic-bezier(0.34,1.56,0.64,1) both',
        'badge-pop': 'badge-pop 250ms cubic-bezier(0.34,1.56,0.64,1)',
      },
    },
  },
};
