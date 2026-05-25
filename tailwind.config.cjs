/**
 * Pack Masters QMS — Tailwind build config.
 * Replaces the per-file CDN runtime in *_F.html with a single pre-built CSS bundle.
 *
 * Build:
 *   npx tailwindcss -c tailwind.config.cjs -i tailwind-input.css -o tailwind-generated.css --minify
 *
 * The `content` glob covers every Apps Script HTML file so arbitrary classes
 * (e.g. `bg-[#1e3a5f]`, `h-[44px]`) are JIT-extracted from the markup.
 */
module.exports = {
  content: [
    './*.html'
  ],
  // Safelist only classes built dynamically in JS that the content scanner can't see.
  safelist: [
    'bg-status-pass', 'bg-status-fail', 'bg-status-hold',
    'bg-status-pending', 'bg-status-progress', 'bg-status-closed',
    'text-status-pass', 'text-status-fail', 'text-status-hold',
    // Pinned color classes referenced in concatenated JS strings
    'border-l-[#f97316]', 'border-l-[#2563eb]', 'border-l-[#6b7280]',
    'bg-status-success', 'bg-status-danger', 'bg-status-warning',
    'bg-emerald-50', 'border-emerald-600', 'text-emerald-700'
  ],
  theme: {
    extend: {
      colors: {
        primary:      '#1e3a5f',
        accent:       '#0ea5e9',
        surface:      '#f8fafc',
        card:         '#ffffff',
        border:       '#e2e8f0',
        'border-col': '#e2e8f0',
        'text-main':  '#0f172a',
        'text-muted': '#64748b',
        textMain:     '#0f172a',
        textMuted:    '#64748b',
        success:      '#16a34a',
        danger:       '#dc2626',
        warning:      '#d97706',
        amber:        '#f59e0b',
        status: {
          pass:       '#16a34a',
          fail:       '#dc2626',
          success:    '#16a34a',
          danger:     '#dc2626',
          hold:       '#ca8a04',
          warning:    '#ca8a04',
          open:       '#d97706',
          pending:    '#d97706',
          progress:   '#2563eb',
          inprogress: '#2563eb',
          closed:     '#6b7280'
        },
        // Brand aliases used in Masters_F.html
        brand: {
          surface: '#f8fafc',
          border:  '#e2e8f0',
          accent:  '#0ea5e9'
        }
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        lg:      '1rem',
        xl:      '1.5rem',
        '2xl':   '1rem',
        full:    '9999px',
        card:    '12px',
        input:   '8px',
        btn:     '10px',
        badge:   '20px'
      },
      fontFamily: {
        headline: ['Plus Jakarta Sans', 'sans-serif'],
        display:  ['Plus Jakarta Sans', 'sans-serif'],
        body:     ['Inter', 'sans-serif'],
        label:    ['Inter', 'sans-serif']
      },
      boxShadow: {
        card: '0 2px 8px rgba(0,0,0,0.08)',
        nav:  '0 -2px 8px rgba(0,0,0,0.05)'
      }
    }
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/container-queries')
  ]
};
