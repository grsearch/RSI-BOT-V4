/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0a0d12',
          panel: '#11151c',
          card: '#161b24',
          hover: '#1c2230',
          border: '#1f2733',
        },
        text: {
          primary: '#e6edf3',
          secondary: '#8b95a3',
          muted: '#5d6878',
        },
        accent: {
          green: '#3ddc97',
          red: '#ff5e7e',
          amber: '#f5a524',
          blue: '#4f8cff',
          purple: '#9d7bff',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'monospace'],
        sans: ['"Inter"', '-apple-system', 'sans-serif'],
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        'slide-in': 'slide-in 0.3s ease-out',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'slide-in': {
          '0%': { transform: 'translateY(-8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
