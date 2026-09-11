import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0b0c0b",
          900: "#121312",
          800: "#1a1b1a",
          700: "#242624",
        },
        moss: {
          100: "#dce8de",
          300: "#8fad94",
          500: "#3f6b4d",
        },
      },
    },
  },
  plugins: [],
};

export default config;
