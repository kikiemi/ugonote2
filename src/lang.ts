import { en } from './locales/en'
import { storage_get, storage_remove, storage_set } from './storage'

export const lang: 'ja' | 'en' = (() => {
  const saved = storage_get('ug2_lang')
  if (saved === 'ja' || saved === 'en') return saved
  const language = (navigator.language || '').toLowerCase()
  if (!language) return 'ja'
  return language.startsWith('ja') ? 'ja' : 'en'
})()

export function lang_set(value: string): void {
  if (value === 'ja' || value === 'en') storage_set('ug2_lang', value)
  else storage_remove('ug2_lang')
  location.reload()
}

export function lang_saved(): string {
  return storage_get('ug2_lang') || ''
}

export function tr(s: string): string {
  return lang === 'en' ? (en[s] ?? s) : s
}

export function tr_line(value: string): string {
  if (lang !== 'en') return value
  if (en[value]) return en[value]
  if (value.endsWith(' · 選択中')) return tr_line(value.slice(0, -6)) + ' · Selected'
  const hotkey = value.match(/^(.*) (\([A-Za-z0-9+ ]+\))$/)
  if (hotkey && en[hotkey[1]]) return en[hotkey[1]] + ' ' + hotkey[2]
  return value
    .replace(/^レイヤー ([A-Z]+)$/, 'Layer $1')
    .replace(/^(\d+) \/ (\d+)。番号を指定して移動$/, '$1 / $2 · jump to frame')
    .replace(/^(\d+) コマ \/ ([\d.]+) コマ\/秒$/, '$1 frames / $2 fps')
    .replace(/^(\d+)コマ目を見る$/, 'View frame $1')
    .replace(/^(\d+)コマ目・音(\d+)を追加$/, 'Frame $1 · add sound $2')
    .replace(/^(\d+)コマ目・音(\d+)を鳴らす・タップで外す$/, 'Frame $1 · sound $2 on · tap to remove')
    .replace(/^(\d+)枚$/, '$1 frames')
    .replace(/^([\d.]+)\/秒$/, '$1/s')
    .replace(/^あと(\d+)コマ追加できます（合計 最大(\d+)コマ）$/, 'You can add $1 frames (maximum $2 in total)')
    .replace(/^(\d+)マス$/, '$1 cells')
    .replace(/^音\s*(\d+)$/, 'Sound $1')
    .replace(/^曲\s*(\d+)$/, 'Track $1')
    .replace(/^(?:いろ|色) (#[A-Fa-f0-9]+)$/, 'Color $1')
    .replace(/^ふとさ (\d+)$/, 'Size $1')
    .replace(/^紙のいろ (\d+) (#[A-Fa-f0-9]+)$/, 'Paper color $1 $2')
    .replace(/^([\d.]+) px \/ ドット$/, '$1 px / pixel')
    .replace(/([\d.]+) コマ\/秒$/, '$1 fps')
}

function translate_root(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const parent = node.parentElement
    if (parent && !parent.closest('[data-user-text],script,style,input,textarea')) {
      const value = node.nodeValue || ''
      const text = value.trim()
      if (text) node.nodeValue = value.replace(text, tr_line(text))
    }
    node = walker.nextNode()
  }
  for (const element of root.querySelectorAll<HTMLElement>('[title],[placeholder],[aria-label]')) {
    if (element.closest('[data-user-text]')) continue
    for (const name of ['title', 'placeholder', 'aria-label']) {
      const value = element.getAttribute(name)
      if (value) element.setAttribute(name, tr_line(value))
    }
  }
}

export function tr_html(html: string): string {
  if (lang !== 'en') return html
  if (en[html]) return en[html]
  const template = document.createElement('template')
  template.innerHTML = html
  translate_root(template.content)
  return template.innerHTML
}

export function tr_dom(root: HTMLElement): void {
  if (lang === 'en') translate_root(root)
}
