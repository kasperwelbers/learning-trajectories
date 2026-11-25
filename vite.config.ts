import { fileURLToPath, URL } from "node:url"
import { cloudflare } from "@cloudflare/vite-plugin"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  // The app shell (React, Radix, TanStack, zod) is ~570 kB before gzip; the editor and views are split off.
  build: { chunkSizeWarningLimit: 650 },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./frontend/src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
})
