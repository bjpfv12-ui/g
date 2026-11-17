import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages отдаёт проект по адресу /<имя-репозитория>/, поэтому base
  // задаётся переменной окружения. Локально (dev/preview) base = '/'.
  base: process.env.VITE_BASE || '/',
  server: {
    host: '127.0.0.1',
    port: 5178,
    watch: {
      // Скриншоты и профили браузера из scripts/verify.mjs не должны дёргать HMR.
      ignored: ['**/verify/**'],
    },
  },
})
