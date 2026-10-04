import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] })],
  server: {
    allowedHosts: true,
    proxy: {
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  }
});
