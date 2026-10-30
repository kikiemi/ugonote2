import { ic } from '../../dom'

// パネルの中で使う部品 (styles/panel.css)。

// オン・オフを切りかえる行。
export function switch_row(id: string, icon: string, label: string): string {
  return `<button class="sw" id="${id}" aria-pressed="false">${ic(icon)}<span>${label}</span><i class="toggle_knob" aria-hidden="true"></i></button>`
}

// 押すとすぐ絵や画面が変わるタイル。
export function action_tile(id: string, icon: string, label: string, cls = ''): string {
  return `<button class="act${cls ? ' ' + cls : ''}" id="${id}">${ic(icon)}<span>${label}</span></button>`
}

// ほかの画面へ進む・ファイルを作る大きいボタン。extra に featured を渡すとオレンジにする。
export function menu_action(id: string, icon: string, title: string, hint: string, extra = ''): string {
  return `<button class="menu_action${extra ? ' ' + extra : ''}" id="${id}"><span class="action_glyph">${ic(icon)}</span><span class="action_copy"><b>${title}</b><small>${hint}</small></span></button>`
}

// ひとつえらぶボタンの列。list は [値, 名前]。
export function choices(id: string, attr: string, list: [string, string][]): string {
  return `<div class="seg" id="${id}">${list.map(([value, label]) => `<button data-${attr}="${value}" aria-pressed="false">${label}</button>`).join('')}</div>`
}
