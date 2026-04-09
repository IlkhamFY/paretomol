import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // WSL2/NTFS workaround: copyFileSync fails on Windows paths.
    // copyPublicDir is disabled; this plugin copies public/ using writeFileSync.
    {
      name: 'copy-public-wsl',
      closeBundle() {
        const publicDir = path.resolve(__dirname, 'public')
        const outDir = path.resolve(__dirname, 'dist')
        if (!fs.existsSync(publicDir)) return
        for (const file of fs.readdirSync(publicDir)) {
          const src = path.join(publicDir, file)
          const dest = path.join(outDir, file)
          fs.writeFileSync(dest, fs.readFileSync(src))
        }
      },
    },
  ],
  base: '/',
  build: {
    copyPublicDir: false, // handled by copy-public-wsl plugin above
  },
})
