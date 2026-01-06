import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
    host: "0.0.0.0",
    hmr: {
      clientPort: 443,
    },
    allowedHosts: true,
  },
  preview: {
    port: 3000,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
