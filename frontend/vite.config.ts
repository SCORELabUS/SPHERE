import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// import { nodePolyfills } from 'vite-plugin-node-polyfills';
import tailwindcss from '@tailwindcss/vite'
import tsconfigPaths from 'vite-tsconfig-paths';

// Overridable so local setups where :8080 is taken can point at another API port.
const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [
    // nodePolyfills(),
    react(),
    tailwindcss(),
    tsconfigPaths(),
    {
      name: 'markdown-loader',
      transform(code, id) {
        if (id.slice(-3) === '.md') {
          // For .md files, get the raw content
          return `export default ${JSON.stringify(code)};`;
        }
      },
    },
  ],
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        // rewrite: path => path.replace(/^\/api/, ''),
      },
      '/static': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        // rewrite: path => path.replace(/^\/static/, ''),
      },
    },
  },
  publicDir: 'public',
});
