/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcdbff",
          300: "#8ec3ff",
          400: "#599fff",
          500: "#357bff",
          600: "#205ef0",
          700: "#1a4bd1",
          800: "#1c40a8",
          900: "#1d3a85",
        },
        accent: {
          400: "#ffb547",
          500: "#ff9a1f",
          600: "#e07b00",
        },
      },
      fontFamily: {
        sans: [
          "Pretendard",
          "-apple-system",
          "BlinkMacSystemFont",
          "system-ui",
          "Segoe UI",
          "Roboto",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "sans-serif",
        ],
      },
      boxShadow: {
        soft: "0 6px 24px rgba(15, 30, 75, 0.08)",
      },
    },
  },
  plugins: [],
};
