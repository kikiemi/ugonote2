import { tr_line } from '../lang'
import { q, ic } from '../dom'
import { doc_compose } from '../doc'
import { animfx_compose } from '../animfx'
import { anim_playhead, anim_play_time } from '../state/commands/play'
import { st } from '../state/store'
import { anim_stop, anim_toggle } from './playback'

let previewRaf = 0

function preview_draw(cv: HTMLCanvasElement, frame: number, playing = false): void {
  const doc = st().doc
  const width = cv.width
  const height = Math.max(1, Math.round(width * doc.h / doc.w))
  if (cv.height !== height) cv.height = height
  const x = cv.getContext('2d')!
  if (playing) animfx_compose(frame, x, width, height, 1, anim_play_time())
  else doc_compose(frame, x, width, height, 1)
}

export function home_preview_stop(): void {
  if (!previewRaf) return
  cancelAnimationFrame(previewRaf)
  previewRaf = 0
  anim_stop()
  q('menuPreviewPlay').innerHTML = ic('play')
  q('menuPreviewPlay').setAttribute('aria-pressed', 'false')
  q('menuPreviewPlay').setAttribute('title', tr_line('作品を再生'))
}

function preview_tick(): void {
  if (!q('drawer').classList.contains('on') || q('drawer').dataset.page !== 'home') {
    home_preview_stop()
    return
  }
  preview_draw(q<HTMLCanvasElement>('notePreviewCv'), anim_playhead(), true)
  if (!st().play.on) {
    home_preview_stop()
    return
  }
  previewRaf = requestAnimationFrame(preview_tick)
}

export function home_group_show(group: string): void {
  home_preview_stop()
  q('drawer').dataset.page = group
  q('menuCrumb').textContent = tr_line(group === 'home' ? '' : 'メニュー / 作品の道具')
  q('menuHeading').textContent = tr_line(({ home: 'メニュー', files: '保存・ひらく', imports: 'とりこむ', make: 'うごきをつくる', sound: '音をつける', canvas: '紙とサイズ', frames: 'コマのこと', settings: 'せってい', project: 'さくひん設定' } as Record<string, string>)[group] || 'メニュー')
  for (const section of q('drawerBody').children) {
    const el = section as HTMLElement
    el.hidden = el.dataset.menuGroup !== group
  }
  q('drawerBody').scrollTop = 0
}

export function home_show(): void {
  home_group_show('home')
  preview_draw(q<HTMLCanvasElement>('notePreviewCv'), st().doc.cur)
  q('notePreviewName').textContent = st().doc.name || 'じぶんのノート'
  q('notePreviewMeta').textContent = tr_line(`${st().doc.frames.length} コマ / ${st().doc.fps} コマ/秒`)
}

export function home_mount(resume: () => void, frames: () => void): void {
  q('menuHomeBack').addEventListener('click', home_show)
  q('menuResume').addEventListener('click', resume)
  q('menuDraw').addEventListener('click', resume)
  q('menuFrames').addEventListener('click', frames)
  q('menuDetails').addEventListener('click', () => home_group_show('project'))
  q('projectMode').addEventListener('click', () => q('modeBtn').click())
  q('menuNew').addEventListener('click', () => { home_preview_stop(); q('newBtn').click() })
  q('menuPreviewPlay').addEventListener('click', () => {
    if (previewRaf) { home_preview_stop(); return }
    anim_toggle()
    q('menuPreviewPlay').innerHTML = ic('pause')
    q('menuPreviewPlay').setAttribute('aria-pressed', 'true')
    q('menuPreviewPlay').setAttribute('title', tr_line('再生をとめる'))
    previewRaf = requestAnimationFrame(preview_tick)
  })
  q('drawer').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-group]')
    if (b?.tagName === 'BUTTON') home_group_show(b.dataset.menuGroup!)
  })
  home_show()
}
