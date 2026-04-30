/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d8e2ff",
          200: "#adc6ff",
          300: "#7aa4ff",
          400: "#4a83ff",
          500: "#007AFF",
          600: "#0058bc",
          700: "#004493",
          800: "#003a7e",
          900: "#001a41",
        },
        accent: {
          50: "#ecfdf5",
          100: "#d1fae5",
          400: "#34C759",
          500: "#10b981",
          600: "#059669",
        },
        surface: {
          DEFAULT: "#faf9fe",
          dim: "#dad9df",
          bright: "#faf9fe",
          lowest: "#ffffff",
          low: "#f4f3f8",
          base: "#eeedf3",
          high: "#e9e7ed",
          highest: "#e3e2e7",
        },
        ink: {
          DEFAULT: "#1a1b1f",
          variant: "#414755",
          muted: "#717786",
          line: "#c1c6d7",
        },
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "Plus Jakarta Sans",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "sans-serif",
        ],
        display: [
          "Plus Jakarta Sans",
          "Pretendard",
          "Noto Sans KR",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 6px 24px rgba(15, 30, 75, 0.08)",
        glow: "0 4px 20px rgba(0, 122, 255, 0.08)",
        "glow-md": "0 8px 30px rgba(0, 122, 255, 0.12)",
        "glow-lg": "0 10px 40px rgba(0, 122, 255, 0.12)",
        "glow-xl": "0 20px 50px rgba(0, 88, 188, 0.10)",
        nav: "0 4px 20px rgba(0, 122, 255, 0.10)",
      },
      backgroundImage: {
        "page-gradient":
          "linear-gradient(180deg, #E6F0FF 0%, #FAF9FE 70%, #FFFFFF 100%)",
        "hero-gradient": "linear-gradient(135deg, #0058bc 0%, #007AFF 100%)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
        "4xl": "2rem",
      },
    },
  },
  plugins: [],
};
