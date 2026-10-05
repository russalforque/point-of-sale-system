// Capture-only Vite config: the real app, with SQLite swapped for sql.js and demo data seeded.
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import path from 'node:path'
import base from '../../../vite.config'

const ROOT = path.resolve(__dirname, '../../..')
const HERE = __dirname
const SWAP: Record<string, string> = {
  [path.join(ROOT, 'src/database/sqlite.ts')]: path.join(HERE, 'sqlite-web.ts'),
  [path.join(ROOT, 'src/database/seed.ts')]: path.join(HERE, 'seed-demo.ts'),
  [path.join(ROOT, 'src/services/printer/printerService.ts')]: path.join(HERE, 'printer-demo.ts'),
}

function captureSwap(): Plugin {
  return {
    name: 'sellix-capture-swap',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || importer.startsWith(HERE)) return null
      if (source === '@capacitor/core') return path.join(HERE, 'capacitor-core.ts')
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      return resolved && SWAP[resolved.id] ? SWAP[resolved.id] : null
    },
  }
}

export default mergeConfig(base as any, defineConfig({
  root: ROOT,
  plugins: [captureSwap()],
  server: { port: 5199, strictPort: true, fs: { allow: [ROOT] } },
}))
