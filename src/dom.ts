import { tr_html } from './lang'

export function q<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id)
  if (!n) throw new Error('q: #' + id + ' not found')
  return n as T
}

export function query<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector(selector)
  if (!node) throw new Error('query: ' + selector + ' not found')
  return node as T
}

export function pointer_capture(node: Element, pointerId: number): number {
  if (typeof node.setPointerCapture !== 'function') return 0
  try {
    node.setPointerCapture(pointerId)
    return 1
  } catch {
    return 0
  }
}

export function pointer_release(node: Element, pointerId: number): void {
  if (typeof node.releasePointerCapture !== 'function') return
  try {
    if (typeof node.hasPointerCapture !== 'function' || node.hasPointerCapture(pointerId)) node.releasePointerCapture(pointerId)
  } catch {}
}

export function el(tag: string, cls: string, html: string): HTMLElement {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (html) n.innerHTML = html
  return n
}

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const IC: { [k: string]: string } = {
  pen: '<path d="M4 20l1-4L16 5l3 3L8 19l-4 1z"/><path d="M14 7l3 3"/>',
  fill: '<path d="M8 3l9 9-7 7-7-7 6-6z"/><path d="M5 12h11"/><path d="M19 15c1.2 1.6 2 2.7 2 3.7a2 2 0 0 1-4 0c0-1 .8-2.1 2-3.7z"/>',
  eraser: '<path d="M7 20h10"/><path d="M5 15l9-9 5 5-7 7H8l-3-3z"/><path d="M11 8l5 5"/>',
  eyedrop: '<path d="M4 20l1-3 9-9 2 2-9 9-3 1z"/><path d="M13 5l2-2a2.1 2.1 0 0 1 3 3l-2 2"/><path d="M12 6l4 4"/>',
  pixel: '<path d="M4 4h6v6H4z"/><path d="M14 10h6v6h-6z"/><path d="M8 14h6v6H8z"/>',
  line: '<path d="M4 20L20 4"/><circle cx="4" cy="20" r="1.6"/><circle cx="20" cy="4" r="1.6"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 5.9L12 16.4 6.7 19.3l1.2-5.9L3.4 9.3l6-.7L12 3z"/>',
  heart: '<path d="M12 20S4 14.5 4 9.3C4 6.4 6.2 4.5 8.6 4.5c1.5 0 2.7.8 3.4 2 .7-1.2 1.9-2 3.4-2 2.4 0 4.6 1.9 4.6 4.8C20 14.5 12 20 12 20z"/>',
  text: '<path d="M5 5h14"/><path d="M12 5v14"/><path d="M9 19h6"/>',
  select: '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M17 4h2a1 1 0 0 1 1 1v2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M10 4h4M4 10v4M20 10v4M10 20h4" stroke-dasharray="2 3"/>',
  lasso: '<path d="M12 4c4.4 0 8 2 8 5s-3.6 5-8 5c-1 0-2-.1-2.9-.3"/><path d="M4 9c0-1.6 1-3 2.7-3.9"/><path d="M9 13.5c-2 1-3 2.6-3 4.5 0 1.1.9 2 2 2"/><circle cx="7" cy="20" r="1.4"/>',
  paste: '<rect x="6" y="5" width="12" height="15" rx="2"/><path d="M9 5a3 3 0 0 1 6 0"/><path d="M9 11h6M9 15h4"/>',
  hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 11V5a1.5 1.5 0 0 1 3 0v6"/><path d="M14 11V6.5a1.5 1.5 0 0 1 3 0V13"/><path d="M8 12l-1.8-1.8a1.6 1.6 0 0 0-2.4 2.2L8 17c1.4 2.2 3 4 6 4 4 0 6-2.5 6-6v-2"/>',
  undo: '<path d="M8 7L4 11l4 4"/><path d="M4 11h9a6 6 0 0 1 6 6v1"/>',
  redo: '<path d="M16 7l4 4-4 4"/><path d="M20 11h-9a6 6 0 0 0-6 6v1"/>',
  play: '<path d="M8 5.5v13l10-6.5-10-6.5z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="1.5"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  first: '<path d="M17 5l-7 7 7 7"/><path d="M7 5v14"/>',
  last: '<path d="M7 5l7 7-7 7"/><path d="M17 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H6a2 2 0 0 0-2 2v10"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  onion: '<circle cx="10" cy="12" r="6"/><circle cx="14" cy="12" r="6" stroke-dasharray="3 3"/>',
  grid: '<path d="M4 4h16v16H4z"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  layers: '<path d="M12 4l8 4.5-8 4.5-8-4.5L12 4z"/><path d="M4 13l8 4.5 8-4.5"/><path d="M4 17l8 4.5 8-4.5" opacity=".5"/>',
  sound: '<path d="M4 10v4h3l5 4V6l-5 4H4z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.5 6.5a8 8 0 0 1 0 11"/>',
  left: '<path d="M14.5 5l-6 7 6 7"/>',
  right: '<path d="M9.5 5l6 7-6 7"/>',
  gear: '<path d="M9.6 3.2l.5 1.7a7.7 7.7 0 0 1 3.8 0l.5-1.7 2.8 1.6-.9 1.6a8 8 0 0 1 1.9 3.3H20V13h-1.8a8 8 0 0 1-1.9 3.3l.9 1.6-2.8 1.6-.5-1.7a7.7 7.7 0 0 1-3.8 0l-.5 1.7-2.8-1.6.9-1.6A8 8 0 0 1 5.8 13H4V9.7h1.8a8 8 0 0 1 1.9-3.3l-.9-1.6 2.8-1.6z"/><circle cx="12" cy="11.35" r="3.1"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
  film: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M8 5v14M16 5v14"/><path d="M3 9.5h5M3 14.5h5M16 9.5h5M16 14.5h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  download: '<path d="M12 4v11"/><path d="M7 11l5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 20V9"/><path d="M7 13l5-5 5 5"/><path d="M5 4h14"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M4 18l5-5 3 3 4-4 4 4"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10l5-3v10l-5-3"/>',
  mic: '<rect x="9" y="4" width="6" height="11" rx="3"/><path d="M6 12a6 6 0 0 0 12 0"/><path d="M12 18v3"/>',
  move: '<path d="M12 3v18M3 12h18"/><path d="M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
  cut: '<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.6L20 20M8.2 15.4L20 4"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  loop: '<path d="M7 8h9a3 3 0 0 1 3 3v1"/><path d="M17 16H8a3 3 0 0 1-3-3v-1"/><path d="M9.5 5.5L7 8l2.5 2.5"/><path d="M14.5 13.5L17 16l-2.5 2.5"/>',
  zin: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/><path d="M11 8.5v5M8.5 11h5"/>',
  zout: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/><path d="M8.5 11h5"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  rotl: '<path d="M6 8a7 7 0 1 1-1.5 5"/><path d="M6 3v5h5"/>',
  rotr: '<path d="M18 8a7 7 0 1 0 1.5 5"/><path d="M18 3v5h-5"/>',
  fliph: '<path d="M12 3v18" stroke-dasharray="3 3"/><path d="M8 7L4 12l4 5V7z"/><path d="M16 7l4 5-4 5V7z"/>',
  flipv: '<path d="M3 12h18" stroke-dasharray="3 3"/><path d="M7 8l5-4 5 4H7z"/><path d="M7 16l5 4 5-4H7z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8v.5"/><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>',
  file: '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4"/>',
  swap: '<path d="M7 4l-3 3 3 3"/><path d="M4 7h12"/><path d="M17 14l3 3-3 3"/><path d="M20 17H8"/>',
  drag: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-.8 2-1.8 0-.9-.6-1.4-.6-2.2 0-1 .8-1.7 2-1.7H17a4 4 0 0 0 4-4c0-4.6-4-8.3-9-8.3z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10.5" cy="7.5" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  moon: '<path d="M20 13.5A8 8 0 0 1 10.5 4 8 8 0 1 0 20 13.5z"/>',
  warn: '<path d="M12 4L2.5 20h19L12 4z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.2" r=".8" fill="currentColor" stroke="none"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff: '<path d="M4 4l16 16"/><path d="M9.9 5.9A9.5 9.5 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.2 3.9M6 7.3A16.6 16.6 0 0 0 2.5 12S6 18.5 12 18.5c1 0 2-.2 2.9-.5"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  up: '<path d="M6 14l6-6 6 6"/>',
  down: '<path d="M6 10l6 6 6-6"/>',
  mergedown: '<path d="M12 4v9"/><path d="M8 9l4 4 4-4"/><path d="M5 17h14v3H5z"/>',
  dots: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  save: '<path d="M5 4h11l3 3v13H5V4z"/><path d="M8 4v5h7V4"/><rect x="8" y="13" width="8" height="5"/>',
  note: '<path d="M6 3h12a1 1 0 0 1 1 1v16l-3-2-3 2-3-2-4 2V4a1 1 0 0 1 1-1z" transform="rotate(0)"/><path d="M9 8h6M9 12h6"/>',
  record: '<circle cx="12" cy="12" r="6" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  ab: '<path d="M3 5v14M21 5v14"/><path d="M8 15V9l3 6V9"/><path d="M14 9h3a2 2 0 0 1 0 4h-3zm0 4h3"/>',
  reset: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  marker: '<path d="M4 20l3-1 10-10-2-2L5 17z"/><path d="M13 7l4 4"/><path d="M3 21h6"/>',
  pencil: '<path d="M4 20l2-.5L18 7.5 16.5 6 4.5 18z"/><path d="M14 5l4 4"/>',
  brush: '<path d="M9 14c-2 0-4 1.5-4 4 0 1.5 1 3 3 3 3 0 4-3 3-5"/><path d="M11 13L20 4l-1-1-9 9"/>',
  airbrush: '<rect x="8" y="9" width="6" height="11" rx="1"/><path d="M14 11h4M14 14h5M14 8h3"/><path d="M9 9V5h4v4"/>',
  crayon: '<path d="M8 21h8l-1-4H9z"/><path d="M9 17l1.5-11h3L15 17"/>',
  callig: '<path d="M5 19l9-13 2 1.5-8 13z"/><path d="M4 20l3-1"/>',
  bdots: '<circle cx="7" cy="8" r="1.5"/><circle cx="14" cy="7" r="1.5"/><circle cx="17" cy="13" r="1.5"/><circle cx="9" cy="15" r="1.5"/><circle cx="15" cy="17" r="1.5"/>',
  blur: '<circle cx="12" cy="12" r="8" opacity="0.35"/><circle cx="12" cy="12" r="5" opacity="0.6"/><circle cx="12" cy="12" r="2"/>',
  mosaic: '<rect x="4" y="4" width="5" height="5"/><rect x="11" y="4" width="5" height="5" opacity="0.5"/><rect x="4" y="11" width="5" height="5" opacity="0.5"/><rect x="11" y="11" width="5" height="5"/>',
  outline: '<path d="M5 7V5h2M17 5h2v2M19 17v2h-2M7 19H5v-2"/><path d="M8 12h8M12 8v8"/>',
  glow: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  chroma: '<circle cx="9" cy="12" r="6" opacity="0.6"/><circle cx="15" cy="12" r="6" opacity="0.6"/>',
  noise: '<path d="M3 12h2l1-3 2 6 2-9 2 12 2-6 1 3h4"/>',
  wave: '<path d="M3 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/><path d="M3 17c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/>',
  water: '<path d="M12 3c3 4 6 7.2 6 10.4A6 6 0 0 1 6 13.4C6 10.2 9 7 12 3z"/><path d="M9 14c0 1.8 1.4 3 3 3"/>',
  neon: '<path d="M8 4v6a4 4 0 0 0 8 0V4"/><path d="M12 14v6"/><path d="M9 20h6" opacity="0.6"/>',
  chalk: '<rect x="9" y="4" width="6" height="13" rx="1.5"/><path d="M9 17l1.5 3h3L15 17" opacity="0.6"/>',
  spat: '<circle cx="8" cy="9" r="2.4"/><circle cx="15" cy="6" r="1.5"/><circle cx="16" cy="13" r="1.9"/><circle cx="10" cy="16" r="1.2"/><circle cx="18" cy="18" r="1"/>',
  ribbon: '<path d="M4 9h16v6H4z"/><path d="M4 9c2 3 2 3 0 6M20 9c-2 3-2 3 0 6" opacity="0.5"/>',
  skipback: '<path d="M6 5v14"/><path d="M18 6l-8 6 8 6z"/>',
  effect: '<path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"/><circle cx="18" cy="6" r="1.5"/><circle cx="6" cy="18" r="1.5"/>',
  mark: '<path d="M12 3l2.5 6H21l-5 4 2 6-6-4-6 4 2-6-5-4h6.5z"/>',
  transition: '<path d="M3 12h7M14 12h7"/><path d="M10 8l4 4-4 4M14 16l-4-4 4-4" opacity="0.5"/>',
  goto: '<path d="M4 12h12"/><path d="M12 7l5 5-5 5"/><path d="M20 5v14"/>',
  many: '<rect x="3" y="7" width="5" height="10" rx="1"/><rect x="10" y="7" width="5" height="10" rx="1"/><path d="M17 12h4M19 10v4"/>',
  zoomin: '<circle cx="11" cy="11" r="6"/><path d="M11 8v6M8 11h6"/><path d="M16 16l5 5"/>',
}

export function ic(name: string): string {
  const p = IC[name] || IC.warn
  return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'
}

let toastT: ReturnType<typeof setTimeout> | 0 = 0

export function toast(msg: string): void {
  msg = tr_html(msg)
  let n = document.getElementById('toast')
  if (!n) {
    n = el('div', '', '')
    n.id = 'toast'
    document.body.appendChild(n)
  }
  n.textContent = msg
  n.classList.add('on')
  if (toastT) clearTimeout(toastT)
  toastT = setTimeout(() => {
    n.classList.remove('on')
    toastT = 0
  }, 1800)
}
