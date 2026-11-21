import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type PluginOption} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';
import {visualizer} from 'rollup-plugin-visualizer';

const ROOT_DIR = import.meta.dirname;

const STRICT_CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

export default defineConfig(() => {
  const analyzeEnabled = process.env.ANALYZE === 'true';

  const plugins: PluginOption[] = [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: [
        'icon.svg',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png',
        'pwa-maskable-512x512.png',
      ],
      manifest: {
        id: '/',
        name: 'Mandala Studio — Android & Web Creation Engine',
        short_name: 'Mandala',
        description:
          'Motore geometrico radiale, speculare e frattale per Android e Web con supporto stilo e accessibilità CUD.',
        theme_color: '#090d16',
        background_color: '#090d16',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2,wasm}'],
        runtimeCaching: [
          {
            // Class 1: Immutable / fingerprinted .wasm binaries (Cache-First)
            urlPattern: /\.wasm$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'mandala-wasm-immutable-cache',
              expiration: {
                maxEntries: 8,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Class 2: Entry documents & manifest (Network-First, 3s timeout fallback)
            urlPattern: ({request, url}) =>
              request.mode === 'navigate' || url.pathname.endsWith('manifest.webmanifest'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'mandala-shell-network-first',
              networkTimeoutSeconds: 3,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Class 3: Local self-hosted fonts & static media assets (Stale-While-Revalidate)
            urlPattern: /\.(?:woff2?|svg|png|ico)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'mandala-local-assets-swr',
              expiration: {
                maxEntries: 48,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
    // Copies src/assets into dist/ so root-relative URLs like
    // "/src/assets/images/..." (e.g. generate_image output) still resolve
    // in production builds. Do not remove.
    {
      name: 'copy-unbundled-src-assets',
      apply: 'build',
      closeBundle(error?: Error): void {
        if (error) {
          return;
        }
        const distDir = path.resolve(ROOT_DIR, 'dist');
        const srcAssets = path.resolve(ROOT_DIR, 'src/assets');
        const distAssets = path.resolve(distDir, 'src/assets');
        if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
          fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
        }
      },
    },
  ];

  if (analyzeEnabled) {
    plugins.push(
      visualizer({
        filename: path.resolve(ROOT_DIR, 'reports/bundle-stats.html'),
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }) as PluginOption,
    );
  }

  return {
    plugins,
    build: {
      assetsInlineLimit: 0,
      modulePreload: {
        resolveDependencies(_filename, deps) {
          return deps.filter(
            (dep) => !dep.includes('motion-vendor') && !dep.includes('wasm-runtime')
          );
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) {
              return 'react-vendor';
            }
            if (id.includes('node_modules/motion/') || id.includes('node_modules/framer-motion/')) {
              return 'motion-vendor';
            }
            if (id.includes('node_modules/lucide-react/')) {
              return 'icons-vendor';
            }
            if (id.includes('node_modules/zod/') || id.includes('node_modules/zustand/')) {
              return 'state-vendor';
            }
            if (id.includes('wasmLoader') || id.includes('wasmSymmetryAdapter')) {
              return 'wasm-runtime';
            }
            return undefined;
          },
        },
      },
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: {
        '@': ROOT_DIR,
      },
    },
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'motion/react',
        'lucide-react',
        'zustand',
        'zod',
      ],
    },
    preview: {
      headers: {
        'Content-Security-Policy': STRICT_CSP_POLICY,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
