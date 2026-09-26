import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * This bundle is mounted INTO the existing server-rendered pages
 * (src/web/server.js renderDashboard / renderSettingsPage) as a plain
 * <script type="module"> + <link rel="stylesheet"> pair — it is not served
 * as its own page. Fixed (unhashed) output filenames mean server.js can
 * reference them by a stable path without reading a build manifest.
 */
export default defineConfig({
    plugins: [react()],
    base: "/static/sidebar/",
    resolve: {
        alias: { "@": path.resolve(__dirname, "./src") },
    },
    build: {
        outDir: path.resolve(__dirname, "../public/sidebar"),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, "index.html"),
            output: {
                entryFileNames: "sidebar.js",
                chunkFileNames: "sidebar-[name].js",
                assetFileNames: (info) =>
                    info.name && info.name.endsWith(".css") ? "sidebar.css" : "assets/[name][extname]",
            },
        },
    },
});
