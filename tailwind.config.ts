import type { Config } from 'tailwindcss'

// Design tokens mirror SPEC §7.1. Colors map to CSS vars (defined in styles/index.css)
// so theme can switch at runtime without rebuilding Tailwind.
const config: Config = {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        glass: 'var(--glass)',
        border: 'var(--border)',
        text: 'var(--text)',
        'text-provisional': 'var(--text-provisional)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        ok: 'var(--ok)',
        warn: 'var(--warn)',
        err: 'var(--err)'
      },
      borderRadius: {
        // controls / cards / overlay
        '10': '10px',
        '16': '16px',
        '24': '24px'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        vi: ['"Be Vietnam Pro"', 'sans-serif']
      },
      transitionTimingFunction: {
        // easeOutExpo — used for token enter/settle motion
        easeOutExpo: 'cubic-bezier(0.16,1,0.3,1)'
      }
    }
  },
  plugins: []
}

export default config
