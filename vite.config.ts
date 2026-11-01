import { defineConfig, defaultClientConditions, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import fs from 'fs'
import path from 'path'

const RDKIT_FILES = ['RDKit_minimal.js', 'RDKit_minimal.wasm']

/** Copy the pinned @rdkit/rdkit WASM into public/rdkit so the page loads it from this origin. */
function vendorRdkit(): Plugin {
  const copy = () => {
    const srcDir = path.resolve(__dirname, 'node_modules/@rdkit/rdkit/dist')
    const destDir = path.resolve(__dirname, 'public/rdkit')
    fs.mkdirSync(destDir, { recursive: true })
    for (const name of RDKIT_FILES) {
      fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name))
    }
  }
  return { name: 'vendor-rdkit', buildStart: copy, configureServer: copy }
}

function copyRecursive(src: string, dest: string) {
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dest, name))
    return
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, fs.readFileSync(src))
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // WSL2/NTFS workaround: copyFileSync fails on Windows paths.
    // copyPublicDir is disabled; this plugin copies public/ using writeFileSync.
    vendorRdkit(),
    {
      name: 'inline-core-version',
      enforce: 'pre',
      transform(_code, id) {
        const file = id.split('?')[0]
        if (!file.endsWith(`${path.sep}packages${path.sep}core${path.sep}src${path.sep}version.ts`)) return
        const version = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'packages/core/package.json'), 'utf8')).version as string
        return `export const CORE_VERSION = ${JSON.stringify(version)};\n`
      },
    },
    {
      name: 'copy-public-wsl',
      closeBundle() {
        const publicDir = path.resolve(__dirname, 'public')
        const outDir = path.resolve(__dirname, 'dist')
        if (!fs.existsSync(publicDir)) return
        for (const file of fs.readdirSync(publicDir)) {
          copyRecursive(path.join(publicDir, file), path.join(outDir, file))
        }
      },
    },
  ],
  base: '/',
  // Resolve @paretomol/core to its TypeScript source (package.json "source"
  // condition) so the app and the package share one copy of the logic.
  resolve: {
    conditions: ['source', ...defaultClientConditions],
  },
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  build: {
    copyPublicDir: false, // handled by copy-public-wsl plugin above
  },
})
