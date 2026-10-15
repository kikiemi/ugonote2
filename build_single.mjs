import { readFile, writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const bytes = path => readFile(new URL(path, import.meta.url))
const [index, base, app, worker, font, dot_font, memo_font, font_license, library_licenses] = await Promise.all([
  read('index.html'), read('style.css'), read('dist/app.js'), read('dist/worker.js'),
  bytes('assets/rounded.woff'), bytes('assets/dot.woff2'), bytes('assets/memo.woff2'), read('assets/font-LICENSE.txt'), read('assets/library_licenses.txt')
])
const css = (await transform(base, { loader: 'css', minify: true })).code
  .replaceAll('./assets/rounded.woff', 'data:font/woff;base64,' + font.toString('base64'))
  .replaceAll('./assets/dot.woff2', 'data:font/woff2;base64,' + dot_font.toString('base64'))
  .replaceAll('./assets/memo.woff2', 'data:font/woff2;base64,' + memo_font.toString('base64'))
const js = value => value.replace(/<\/script/gi, '<\\/script')
let html = index.replace(/\s*<link[^>]+rel="(?:manifest|icon|apple-touch-icon)"[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="style.css">', () => '<style>' + css + '</style>')
  .replace('<script src="dist/app.js" defer></script>', () => '<script>window.__ug2_worker_src=' + js(JSON.stringify(worker)) + ';</script><script>' + js(app) + '</script>')
html = html.replace('</head>', () => '<script type="application/json" id="third_party_notices">' + js(JSON.stringify({ fonts: font_license, libraries: library_licenses })) + '</script></head>')
await writeFile(new URL('dist/ugonote.html', import.meta.url), html)
console.log('Built dist/ugonote.html (' + Buffer.byteLength(html) + ' bytes)')
