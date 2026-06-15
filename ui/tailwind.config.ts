import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05060a",
          900: "#0a0c14",
          850: "#0e111c",
          800: "#131726",
          700: "#1b2133",
          600: "#272f47"
        },
        mint: {
          DEFAULT: "#34d399",
          soft: "#5eead4",
          deep: "#0f766e"
        },
        signal: {
          red: "#f87171",
          redDeep: "#7f1d1d",
          amber: "#fbbf24"
        }
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"]
      },
      letterSpacing: {
        wordmark: "-0.04em"
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(94,234,212,0.12), 0 24px 80px -32px rgba(45,212,191,0.35)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 24px 60px -36px rgba(0,0,0,0.9)",
        redGlow: "0 0 0 1px rgba(248,113,113,0.18), 0 24px 80px -32px rgba(248,113,113,0.4)"
      },
      backgroundImage: {
        "radial-fade": "radial-gradient(120% 120% at 50% -10%, rgba(45,212,191,0.10) 0%, rgba(5,6,10,0) 55%)"
      }
    }
  },
  plugins: []
};

export default config;
