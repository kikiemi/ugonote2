import { tr_line } from '../lang'
import { q, ic } from '../dom'
import { doc_compose } from '../doc'
import { animfx_compose } from '../animfx'
import { anim_playhead, anim_play_time } from '../state/commands/play'
import { st } from '../state/store'
import { anim_stop, anim_toggle } from './playback'
import { modal_note_meta } from './note_meta'

let preview_raf = 0

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
  if (!preview_raf) return
  cancelAnimationFrame(preview_raf)
  preview_raf = 0
  anim_stop()
  q('menu_preview_play').innerHTML = ic('play')
  q('menu_preview_play').setAttribute('aria-pressed', 'false')
  q('menu_preview_play').setAttribute('title', tr_line('作品を再生'))
}

function preview_tick(): void {
  if (!q('drawer').classList.contains('on') || q('drawer').dataset.page !== 'home') {
    home_preview_stop()
    return
  }
  preview_draw(q<HTMLCanvasElement>('note_preview_cv'), anim_playhead(), true)
  if (!st().play.on) {
    home_preview_stop()
    return
  }
  preview_raf = requestAnimationFrame(preview_tick)
}

export function home_group_show(group: string): void {
  home_preview_stop()
  q('drawer').dataset.page = group
  q('menu_heading').textContent = tr_line(({ home: 'メニュー', files: '保存・ひらく', imports: 'とりこむ', sound: '音をつける', canvas: '紙とサイズ', frames: 'コマのこと', settings: 'せってい', project: 'さくひん設定' } as Record<string, string>)[group] || 'メニュー')
  for (const section of q('drawer_body').children) {
    const el = section as HTMLElement
    el.hidden = el.dataset.menuGroup !== group
  }
  q('drawer_body').scrollTop = 0
}

export function home_show(): void {
  home_group_show('home')
  preview_draw(q<HTMLCanvasElement>('note_preview_cv'), st().doc.cur)
  q('note_preview_name').textContent = st().doc.name || 'じぶんのノート'
  q('note_preview_meta').textContent = tr_line(`${st().doc.frames.length} コマ / ${st().doc.fps} コマ/秒`)
}

export function home_mount(resume: () => void, frames: () => void): void {
  q('menu_home_back').addEventListener('click', home_show)
  q('menu_resume').addEventListener('click', resume)
  q('menu_draw').addEventListener('click', resume)
  q('menu_frames').addEventListener('click', frames)
  q('menu_details').addEventListener('click', () => home_group_show('project'))
  q('project_mode').addEventListener('click', () => q('mode_btn').click())
  q('project_meta').addEventListener('click', modal_note_meta)
  q('menu_new').addEventListener('click', () => { home_preview_stop(); q('new_btn').click() })
  q('menu_preview_play').addEventListener('click', () => {
    if (preview_raf) { home_preview_stop(); return }
    anim_toggle()
    q('menu_preview_play').innerHTML = ic('pause')
    q('menu_preview_play').setAttribute('aria-pressed', 'true')
    q('menu_preview_play').setAttribute('title', tr_line('再生をとめる'))
    preview_raf = requestAnimationFrame(preview_tick)
  })
  q('drawer').addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-menu-group]')
    if (b?.tagName === 'BUTTON') home_group_show(b.dataset.menuGroup!)
  })
  home_show()
}
