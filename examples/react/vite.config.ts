import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      includeManifestIcons: false,
      workbox: {
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,png,svg,ico}"],
        globIgnores: ["xelatex/**/*"],
        navigateFallback: "index.html",
        runtimeCaching: [
          {
            urlPattern: /\/xelatex\/.*$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "thtex-runtime",
              matchOptions: {
                ignoreVary: true,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
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
