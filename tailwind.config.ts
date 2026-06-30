import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ["class"],
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Intent IDE custom palette
        ink: '#1a1a1a',
        paper: '#fafaf8',
        warm: '#f5f3ef',
        accent: '#c44b2b',
        'accent-light': '#f8ebe7',
        // New 4-type annotation colors
        'annotation-ask': '#2b5fc4',
        'annotation-edit': '#c44b2b',
        'annotation-dig': '#6b4dc4',
        'annotation-flag': '#d97706',
        // Legacy (backward compat for existing components)
        'annotation-question': '#2b5fc4',
        'annotation-fix': '#c44b2b',
        'annotation-explore': '#6b4dc4',
        'annotation-thought': '#d97706',
        'annotation-correction': '#2b8c5e',
        'annotation-restructure': '#8b5cf6',
        // shadcn/ui CSS variable colors
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      fontFamily: {
        sans: ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['DM Serif Display', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}

export default config
