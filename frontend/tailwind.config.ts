import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "#181113",
        primary: "#EE2B5B",
        surface: "#221015",
        secondary: "#374151",
        tertiary: "#D1D5DB",
      },
      fontFamily: {
        sans: ["Plus Jakarta Sans", "sans-serif"],
      },
      boxShadow: {
        product: "0 8px 15px -3px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.2)",
      }
    },
  },
  plugins: [],
} satisfies Config;
