import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  base: '/downloads/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    assetsDir: 'page',
    rollupOptions: {
      output: {
        entryFileNames: 'page/app.[hash].js',
        chunkFileNames: 'page/[name].[hash].js',
        assetFileNames: 'page/[name].[hash][extname]',
      },
    },
  },
})
