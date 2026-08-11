import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { visualizer } from "rollup-plugin-visualizer";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    visualizer({
      filename: path.resolve(import.meta.dirname, "dist/stats.html"),
      gzipSize: true,
      brotliSize: true,
      template: "treemap",
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 300,
    rollupOptions: {
      output: {
        // Match on the RESOLVED package name, never on a raw substring of `id`.
        // pnpm's virtual store encodes peer deps in the directory name, e.g.
        //   .pnpm/@radix-ui+react-dialog@1.1.15_..._react-dom@19.1.0_react@19.1.0/
        // so `id.includes("react-dom")` matches most of the React ecosystem. That
        // sent 23 @radix-ui packages into react-vendor while the low-level ones
        // with no react-dom peer stayed in radix-ui; the two halves import each
        // other, and a circular chunk dependency boots as
        //   "Cannot read properties of undefined (reading 'useLayoutEffect')".
        //
        // react/react-dom/scheduler are kept together deliberately: that closure
        // imports nothing else, so react-vendor stays a LEAF chunk and cannot be
        // one end of a cycle no matter how the rest is grouped.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          const after = id.split("node_modules/").pop() ?? "";
          const pkg = after.startsWith("@")
            ? after.split("/").slice(0, 2).join("/")
            : (after.split("/")[0] ?? "");

          if (pkg === "react" || pkg === "react-dom" || pkg === "scheduler") {
            return "react-vendor";
          }
          if (pkg.startsWith("@radix-ui/")) return "radix-ui";
          if (pkg === "recharts" || pkg.startsWith("d3-")) return "recharts";
          if (pkg.startsWith("@tanstack/")) return "tanstack";
          if (pkg === "framer-motion") return "framer";
          if (pkg === "lucide-react" || pkg === "react-icons") return "icons";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:8080",
        changeOrigin: true,
      },
      "/v1": {
        target: process.env.VITE_API_BASE_URL || "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
