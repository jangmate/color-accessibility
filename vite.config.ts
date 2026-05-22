import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/color-accessibility/',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 300000, // 5분 타임아웃
        proxyTimeout: 300000,
        rewrite: (path) => path
      },
    },
  },
  build: {
    outDir: 'build', // 빌드 결과물이 생성될 폴더명을 지정합니다.
  }
})
