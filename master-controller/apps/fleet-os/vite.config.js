import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/fleet-os/",
  build: { outDir: "../../ui/fleet-os-dist", emptyOutDir: true },
  server: {
    port: 3002,
    proxy: { "/api": { target: "http://localhost:3000", changeOrigin: true } }
  }
});
