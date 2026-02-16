import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3100,
    proxy: {
      "/ws": {
        target: "ws://localhost:3101",
        ws: true,
      },
      "/api": {
        target: "http://localhost:3101",
      },
    },
  },
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
  },
});
