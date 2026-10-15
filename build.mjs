import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const watch = process.argv.includes('--watch')
const minify = process.argv.includes('--min')
const root = dirname(fileURLToPath(import.meta.url))
const local_key = join(root, 'src/codec/sigkey.local.ts')

const sigkey_plugin = {
  name: 'sigkey-local',
  setup(build) {
    if (!existsSync(local_key)) return
    build.onResolve({ filter: /\.\/sigkey$/ }, () => ({ path: local_key }))
  },
}

const base_options = {
  plugins: [sigkey_plugin],
  bundle: true,
  target: 'es2020',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
  minify,
}

const css_options = { entryPoints: ['styles/index.css'], bundle: true, outfile: 'style.css', external: ['./assets/*'], minify, legalComments: 'none', logLevel: 'info' }

const app_options = { ...base_options, entryPoints: ['src/main.ts'], format: 'iife', outfile: 'dist/app.js' }
const worker_options = { ...base_options, entryPoints: ['src/worker.ts'], format: 'iife', outfile: 'dist/worker.js' }

if (watch) {
  const css_context = await esbuild.context(css_options)
  await css_context.watch()
  const app_context = await esbuild.context(app_options)
  const worker_context = await esbuild.context(worker_options)
  await app_context.watch()
  await worker_context.watch()
  console.log('watching app + worker…')
} else {
  await esbuild.build(css_options)
  await esbuild.build(app_options)
  await esbuild.build(worker_options)
}
