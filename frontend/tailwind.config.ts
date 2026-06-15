import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
      },
      colors: {
        forge: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          200: "#bae6fd",
          300: "#7dd3fc",
          400: "#38bdf8",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          800: "#075985",
          900: "#0c4a6e",
        },
        surface: {
          DEFAULT: "#0f1117",
          50: "#1a1d27",
          100: "#16191f",
          200: "#0f1117",
          300: "#0a0c10",
        },
        panel: {
          DEFAULT: "#1a1d27",
          light: "#1e2130",
          border: "#2a2d3e",
        },
      },
      backgroundImage: {
        "mesh-gradient":
          "radial-gradient(at 40% 20%, hsla(210,100%,56%,0.08) 0px, transparent 50%), radial-gradient(at 80% 0%, hsla(189,100%,56%,0.06) 0px, transparent 50%), radial-gradient(at 0% 50%, hsla(355,100%,93%,0.03) 0px, transparent 50%)",
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 3s linear infinite",
        shimmer: "shimmer 2s linear infinite",
        "blink": "blink 1s step-end infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      boxShadow: {
        forge: "0 0 0 1px rgba(14,165,233,0.2), 0 4px 24px rgba(14,165,233,0.08)",
        "forge-lg": "0 0 0 1px rgba(14,165,233,0.3), 0 8px 40px rgba(14,165,233,0.15)",
        glass: "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 0 rgba(0,0,0,0.2)",
      },
    },
  },
  plugins: [],
};

export default config;
