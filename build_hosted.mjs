import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const at = path => new URL(path, import.meta.url)
await mkdir(at('dist/'), { recursive: true })
await rm(at('dist/dist/'), { recursive: true, force: true })
let html = await readFile(at('index.html'), 'utf8')
html = html.replace('src="dist/app.js"', 'src="app.js"')
await writeFile(at('dist/index.html'), html)
for (const name of ['style.css', 'manifest.webmanifest', 'sw.js', 'icon.svg']) {
  await copyFile(at(name), at('dist/' + name))
}
await cp(at('assets/'), at('dist/assets/'), { recursive: true })
console.log('Built hosted PWA in dist/')
