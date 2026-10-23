import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {},
  preload: { build: { externalizeDeps: false } },
  renderer: {
    define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'development') },
    plugins: [
      vue(),
      {
        name: 'development-csp',
        apply: 'serve',
        transformIndexHtml: (html) => html
          .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
          .replace("connect-src 'self'", "connect-src 'self' ws://localhost:* ws://127.0.0.1:*")
      }
    ]
  }
})
