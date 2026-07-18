import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const MiB = 1024 * 1024;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*"],
        maximumFileSizeToCacheInBytes: 24 * MiB,
        navigateFallback: "index.html",
      },
      manifest: {
        name: "ThTeX React PWA",
        short_name: "ThTeX",
        description: "Compile XeLaTeX documents entirely in your browser.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#f2efe6",
        theme_color: "#15231f",
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
});
