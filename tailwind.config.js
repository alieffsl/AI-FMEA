/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"SF Mono"', '"Fira Code"', 'monospace'],
      },
      colors: {
        steel: {
          50: "#f0f4f9",
          100: "#e8eaed",
          200: "#dadce0",
          300: "#bdc1c6",
          400: "#9aa0a6",
          500: "#80868b",
          600: "#5f6368",
          700: "#3c4043",
          800: "#242424",
          900: "#1E1E1E",
          950: "#121212",
        },
        accent: {
          DEFAULT: "var(--c-accent)",
          50: "#e8f0fe",
          100: "#d2e3fc",
          200: "#aecbfa",
          300: "#8ab4f8",
          400: "var(--c-accent-light, #669df6)",
          500: "var(--c-accent, #4285f4)",
          600: "var(--c-accent-dark, #1a73e8)",
          700: "#1967d2",
          800: "#185abc",
          900: "#174ea6",
        },
        safety: {
          green: "#10b981",
          amber: "#f59e0b",
          red: "#ef4444",
          blue: "#3b82f6",
        },
      },
      boxShadow: {
        xs: "0 1px 2px rgba(0, 0, 0, 0.04)",
        panel: "0 1px 3px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)",
        "panel-md": "0 4px 12px rgba(0, 0, 0, 0.07)",
        "panel-lg": "0 12px 32px rgba(0, 0, 0, 0.10)",
        "card-hover": "0 8px 24px rgba(0, 0, 0, 0.06)",
      },
      borderRadius: {
        "2xl": "16px",
        "3xl": "20px",
      },
      animation: {
        "fade-in": "fade-in 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-up": "slide-up 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "slide-down": "slide-down 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
