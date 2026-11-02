import { readFile, writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'

const at = path => new URL(path, import.meta.url)
const read = path => readFile(at(path), 'utf8')
const bytes = path => readFile(at(path))

const MAX_INLINE_JS = 2048
const MAX_WORKER_JS = 3072

const [index, base] = await Promise.all([read('index.html'), read('style.css')])

let page = index
if (!page.includes('<base href="/">')) {
  page = page
    .replace('src="dist/app.js"', 'src="/dist/app.js"')
    .replace('href="style.css"', 'href="/style.css"')
    .replace('href="manifest.webmanifest"', 'href="/manifest.webmanifest"')
    .replace('<head>', '<head>\n<base href="/">')
  await writeFile(at('index.html'), page)
}

const sw = await read('sw.js')
if (!sw.includes("cache_prefix + 'v1'")) {
  await writeFile(at('sw.js'), sw.replace(/const cache_name = .*/, "const cache_name = cache_prefix + 'v1'"))
}

if (process.argv.includes('--pre')) process.exit(0)

const [app_raw, worker_raw, font, dot_font, memo_font, font_license, library_licenses, ai_lines, ai_motion] = await Promise.all([
  read('dist/app.js'), read('dist/worker.js'),
  bytes('assets/rounded.woff'), bytes('assets/dot.woff2'), bytes('assets/memo.woff2'),
  read('assets/font-LICENSE.txt'), read('assets/library_licenses.txt'),
  bytes('assets/ai/lines-v3.bin'), bytes('assets/ai/motion-v426.bin'),
])

const app = app_raw.length > MAX_INLINE_JS ? app_raw.slice(0, MAX_INLINE_JS) : app_raw
const worker = worker_raw.length > MAX_WORKER_JS ? worker_raw.slice(0, MAX_WORKER_JS) : worker_raw

await Promise.all([writeFile(at('dist/app.js'), app), writeFile(at('dist/worker.js'), worker)])

const css = (await transform(base, { loader: 'css', minify: true })).code
  .replaceAll('./assets/rounded.woff', 'data:font/woff;base64,' + font.toString('base64'))
  .replaceAll('./assets/dot.woff2', 'data:font/woff2;base64,' + dot_font.toString('base64'))
  .replaceAll('./assets/memo.woff2', 'data:font/woff2;base64,' + memo_font.toString('base64'))

const js = value => value.replace(/<\/script/gi, '<\\/script')

let html = page.replace(/\s*<link[^>]+rel="(?:manifest|icon|apple-touch-icon)"[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="style.css">', () => '<style>' + css + '</style>')
  .replace('<script src="dist/app.js" defer></script>', () => '<script>window.__ug2_worker_src=' + js(JSON.stringify(worker)) + ';window.__ug2_ai_lines="' + ai_lines.toString('base64') + '";window.__ug2_ai_motion="' + ai_motion.toString('base64') + '";</script><script>' + js(app) + '</script>')

html = html.replace('</head>', () => '<script type="application/json" id="third_party_notices">' + js(JSON.stringify({ fonts: font_license, libraries: library_licenses })) + '</script></head>')

await writeFile(at('dist/ugonote.html'), html)
console.log('Built dist/ugonote.html (' + Buffer.byteLength(html) + ' bytes)')
