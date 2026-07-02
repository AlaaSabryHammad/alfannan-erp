/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Tajawal', 'Cairo', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: '#0e9384',
          50: '#e6f5f3',
          100: '#ccebe7',
          200: '#99d7cf',
          300: '#66c3b7',
          400: '#33af9f',
          500: '#0e9384',
          600: '#0c7d70',
          700: '#0a675c',
          800: '#085148',
          900: '#063b34',
        },
        accent: {
          DEFAULT: '#f97316',
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea6c0a',
        },
        sidebar: {
          from: '#0b1f1d',
          to: '#103a35',
        },
        app: {
          bg: '#f1f5f9',
          card: '#ffffff',
          border: '#e5e7eb',
          text: '#0f172a',
          muted: '#64748b',
        },
        success: {
          DEFAULT: '#16a34a',
          bg: '#dcfce7',
        },
        danger: {
          DEFAULT: '#dc2626',
          bg: '#fee2e2',
        },
        warning: {
          DEFAULT: '#d97706',
          bg: '#fef3c7',
        },
      },
      backgroundImage: {
        'sidebar-gradient': 'linear-gradient(to bottom, #0b1f1d, #103a35)',
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
}
