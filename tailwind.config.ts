import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        app: {
          black: "#0a0a0a",
          panel: "#111111",
          card: "#1a1a1a",
          green: "#25D366",
          greenHover: "#1ebe57",
          muted: "#a3a3a3",
          border: "#2a2a2a",
          white: "#ffffff"
        }
      },
      boxShadow: {
        green: "0 0 0 1px rgba(37, 211, 102, 0.25)"
      }
    }
  },
  plugins: []
};

export default config;
