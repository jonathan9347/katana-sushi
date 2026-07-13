/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    screens: {
      mobile: "320px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px"
    },
    extend: {
      colors: {
        katana: {
          black: "#050505",
          surface: "#0f0f0f",
          elevated: "#171717",
          border: "#262626",
          muted: "#737373",
          red: "#dc2626",
          "red-bright": "#ef4444",
          white: "#fafafa"
        }
      },
      fontFamily: {
        display: ['"Syne"', "sans-serif"],
        body: ['"Zen Kaku Gothic New"', "sans-serif"]
      },
      boxShadow: {
        glow: "0 0 40px rgba(220, 38, 38, 0.15)",
        card: "0 24px 80px rgba(0, 0, 0, 0.45)"
      },
      backgroundImage: {
        "katana-grid": "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)"
      },
      backgroundSize: {
        grid: "48px 48px"
      }
    }
  },
  plugins: []
};
