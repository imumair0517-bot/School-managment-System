/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // Wired to Phase 11's design tokens (globals.css) rather than
      // hardcoded hex values, so a token change never means a Tailwind
      // config + component-file double-edit.
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        border: "var(--border)",
        ink: "var(--ink)",
        "ink-muted": "var(--ink-muted)",
        accent: "var(--accent)",
        "accent-soft": "var(--accent-soft)",
        success: "var(--success)",
        "success-soft": "var(--success-soft)",
        warning: "var(--warning)",
        "warning-soft": "var(--warning-soft)",
        critical: "var(--critical)",
        "critical-soft": "var(--critical-soft)",
        info: "var(--info)",
        "info-soft": "var(--info-soft)",
      },
      borderRadius: {
        DEFAULT: "8px",
      },
    },
  },
  plugins: [],
};
