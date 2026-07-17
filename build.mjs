import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const minify = process.argv.includes('--min')
const root = dirname(fileURLToPath(import.meta.url))
const localKey = join(root, 'src/codec/sigkey.local.ts')

const sigkeyPlugin = {
  name: 'sigkey-local',
  setup(build) {
    if (!existsSync(localKey)) return
    build.onResolve({ filter: /\.\/sigkey$/ }, () => ({ path: localKey }))
  },
}

const baseOptions = {
  plugins: [sigkeyPlugin],
  bundle: true,
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
  minify,
}

const appOptions = { ...baseOptions, entryPoints: ['src/main.ts'], format: 'iife', outfile: 'dist/app.js' }
const workerOptions = { ...baseOptions, entryPoints: ['src/worker.ts'], format: 'iife', outfile: 'dist/worker.js' }

if (watch) {
  const appContext = await esbuild.context(appOptions)
  const workerContext = await esbuild.context(workerOptions)
  await appContext.watch()
  await workerContext.watch()
  console.log('watching app + worker…')
} else {
  await esbuild.build(appOptions)
  await esbuild.build(workerOptions)
}
