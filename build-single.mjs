import { readFile, writeFile } from 'node:fs/promises'
import { transform } from 'esbuild'
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const bytes = path => readFile(new URL(path, import.meta.url))
const [index, base, app, worker, grid, font, dotFont, memoFont, gridLicense, fontLicense] = await Promise.all([
  read('index.html'), read('style.css'), read('dist/app.js'), read('dist/worker.js'),
  bytes('assets/paper-grid.png'), bytes('assets/rounded.woff'), bytes('assets/dot.woff2'), bytes('assets/memo.woff2'), read('assets/paper-grid-LICENSE.txt'), read('assets/font-LICENSE.txt')
])
const css = (await transform(base, { loader: 'css', minify: true })).code
  .replaceAll('./assets/paper-grid.png', 'data:image/png;base64,' + grid.toString('base64'))
  .replaceAll('./assets/rounded.woff', 'data:font/woff;base64,' + font.toString('base64'))
  .replaceAll('./assets/dot.woff2', 'data:font/woff2;base64,' + dotFont.toString('base64'))
  .replaceAll('./assets/memo.woff2', 'data:font/woff2;base64,' + memoFont.toString('base64'))
const js = value => value.replace(/<\/script/gi, '<\\/script')
let html = index.replace(/\s*<link[^>]+rel="(?:manifest|icon|apple-touch-icon)"[^>]*>/g, '')
  .replace('<link rel="stylesheet" href="style.css">', () => '<style>' + css + '</style>')
  .replace('<script src="dist/app.js" defer></script>', () => '<script>window.__UG2_WORKER_SRC=' + js(JSON.stringify(worker)) + ';</script><script>' + js(app) + '</script>')
html = html.replace('</head>', () => '<!-- Third-party notices:\n' + gridLicense + '\n' + fontLicense + '\n--></head>')
await writeFile(new URL('dist/ugonote-switch.html', import.meta.url), html)
console.log('Built dist/ugonote-switch.html (' + Buffer.byteLength(html) + ' bytes)')
