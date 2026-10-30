import { animfx_active, animfx_compose, animfx_draw_cycle, animfx_loop_plan } from '../animfx'
import { anim_seed_random, animfx_normalize } from '../animset'
import { assist_analyze_frame, assist_estimate_shift } from '../assist'
import { doc_frame_new, doc_layer_canvas, pack_canvas } from '../doc'
import { esc, ic, query, toast } from '../dom'
import { l_n, motion_bounce, motion_breathe, motion_camera, motion_float, motion_none, motion_sway, type anim_fx_t, type frame_t } from '../h'
import { canvas_make, clamp } from '../lib'
import { mode_allows_runtime_anim, mode_frame_limit, mode_layer_allowed } from '../mode'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_close, modal_progress, modal_set_cleanup } from './modal'
import { sheet_open } from './sheet'
import { tr_line } from '../lang'

type motion_def_t = { id: number, label: string, detail: string }

const motions: motion_def_t[] = [
  { id: motion_none, label: 'なし', detail: '手描きゆらぎだけを使います' },
  { id: motion_breathe, label: '呼吸', detail: '中心を保って、ふくらんだり戻ったりします' },
  { id: motion_sway, label: 'ゆらゆら', detail: '足元を支点に左右へ揺れます' },
  { id: motion_float, label: 'ふわふわ', detail: '上下左右へゆっくり漂います' },
  { id: motion_bounce, label: 'ぴょこぴょこ', detail: '少しつぶれながら上下に跳ねます' },
  { id: motion_camera, label: '手持ちカメラ', detail: '画面全体へ小さなカメラ揺れを加えます' },
]

function frame_sources(frame_index: number): (HTMLCanvasElement | null)[] {
  const g = st()
  const frame = g.doc.frames[frame_index]
  const out = new Array<HTMLCanvasElement | null>(l_n).fill(null)
  if (!frame) return out
  for (let layer = 0; layer < l_n; layer++) if (frame.pk[layer]) out[layer] = doc_layer_canvas(frame_index, layer)
  return out
}

function bake_frames(fx_value: anim_fx_t, count_value: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const count = clamp(Math.round(count_value), 2, 24)
  if (g.doc.frames.length - 1 + count > mode_frame_limit(g.doc.mode)) {
    toast('コマ上限をこえるため変換できません')
    return
  }
  const fx = animfx_normalize(fx_value)
  if (!animfx_active(fx)) {
    toast('動きが設定されていません')
    return
  }
  const source_frame = g.doc.frames[g.doc.cur]
  const sources = frame_sources(g.doc.cur)
  const loop = animfx_loop_plan(g.doc.fps, fx)
  const frames: frame_t[] = []
  const progress = modal_progress('動きをコマに変換中')
  progress.note(count + 'コマのループを作ります')
  let index = 0
  const step = (): void => {
    const started = performance.now()
    while (index < count && performance.now() - started < 20) {
      const frame = doc_frame_new()
      frame.se = index === 0 ? source_frame.se : 0
      frame.hold = 1
      const cycle = index / count
      for (let layer = 0; layer < l_n; layer++) {
        if (!mode_layer_allowed(g.doc.mode, layer)) {
          frame.pk[layer] = source_frame.pk[layer]
          continue
        }
        const source = sources[layer]
        if (!source) continue
        const [canvas, context] = canvas_make(g.doc.w, g.doc.h, 1)
        context.imageSmoothingEnabled = true
        animfx_draw_cycle(source, context, g.doc.w, g.doc.h, cycle, fx, source_frame.id, loop)
        frame.pk[layer] = pack_canvas(canvas, context)
      }
      frames.push(frame)
      index++
    }
    progress.set(index / count)
    if (index < count) {
      setTimeout(step, 0)
      return
    }
    progress.close()
    if (dispatch('frame.replace_current_bulk', { frames }) < 0) {
      toast('コマへ変換できませんでした')
      return
    }
    dispatch('anim.clear', null)
    toast(count + 'コマのループに変換しました')
    sfx_play('paper')
  }
  step()
}

function between_frames(count_value: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const from = g.doc.cur
  const to = from + 1
  if (to >= g.doc.frames.length) {
    toast('次のコマがありません')
    return
  }
  const count = clamp(Math.round(count_value), 1, 12)
  if (g.doc.frames.length + count > mode_frame_limit(g.doc.mode)) {
    toast('コマ上限をこえるため作れません')
    return
  }
  const shift = assist_estimate_shift(from, to)
  const source_a = frame_sources(from)
  const source_b = frame_sources(to)
  const frames: frame_t[] = []
  const progress = modal_progress('中割りを作成中')
  progress.note('絵の移動を端末内で見つけています')
  let index = 0
  const step = (): void => {
    const started = performance.now()
    while (index < count && performance.now() - started < 20) {
      const t = (index + 1) / (count + 1)
      const frame = doc_frame_new()
      frame.hold = 1
      for (let layer = 0; layer < l_n; layer++) {
        const a = source_a[layer]
        const b = source_b[layer]
        if (!a && !b) continue
        const [canvas, context] = canvas_make(g.doc.w, g.doc.h, 1)
        context.imageSmoothingEnabled = true
        if (a) {
          context.globalAlpha = 1 - t
          context.drawImage(a, shift.dx * t, shift.dy * t)
        }
        if (b) {
          context.globalAlpha = t
          context.drawImage(b, -shift.dx * (1 - t), -shift.dy * (1 - t))
        }
        context.globalAlpha = 1
        frame.pk[layer] = pack_canvas(canvas, context)
      }
      frames.push(frame)
      index++
    }
    progress.set(index / count)
    if (index < count) {
      setTimeout(step, 0)
      return
    }
    progress.close()
    if (dispatch('frame.insert_bulk', { at: to, frames, set_cur: to }) < 0) {
      toast('中割りを追加できませんでした')
      return
    }
    toast(count + '枚の中割りを追加しました')
    sfx_play('paper')
  }
  step()
}

function preview_size(): { w: number, h: number } {
  const g = st()
  const scale = Math.min(360 / g.doc.w, 230 / g.doc.h, 1)
  return { w: Math.max(160, Math.round(g.doc.w * scale)), h: Math.max(100, Math.round(g.doc.h * scale)) }
}

function range_row(id: string, label: string, min: number, max: number, step: number): string {
  return `<div class="opt_row"><label class="plab" for="${id}">${label}</label><input type="range" id="${id}" min="${min}" max="${max}" step="${step}"><output id="${id}_v"></output></div>`
}

// うごきアシスト。見本を見ながら、ゆらぎ・動き・コマにする の3ページで設定する。
export function modal_animation_assist(): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const runtime = mode_allows_runtime_anim(g.doc.mode)
  let fx: anim_fx_t = { ...g.doc.anim }
  if (!fx.wiggle && fx.motion === motion_none) fx.wiggle = 1
  const size = preview_size()
  const badge = runtime ? '0コマ（設定だけ）' : '実コマへ変換'
  const motion_buttons = motions.map(m => `<button data-motion="${m.id}" title="${esc(m.detail)}" aria-pressed="false">${esc(m.label)}</button>`).join('')
  const box = sheet_open({
    icon: 'wave',
    title: 'うごきアシスト',
    wide: 1,
    preview: `<canvas id="aa_preview" width="${size.w}" height="${size.h}"></canvas><div class="sheet_caption" id="aa_result">${badge}</div>`,
    pages: [
      {
        id: 'wiggle',
        icon: 'wave',
        label: 'ゆらぎ',
        body: `<section class="opt">
          <button class="sw" id="aa_wiggle" aria-pressed="false">${ic('wave')}<span>線と塗りをゆらす</span><i class="toggle_knob" aria-hidden="true"></i></button>
          ${range_row('aa_wiggle_amount', 'つよさ', 0, 8, 0.5)}
          ${range_row('aa_wiggle_cell', '細かさ', 8, 72, 2)}
          ${range_row('aa_wiggle_rate', '速さ', 1, 16, 1)}
          ${range_row('aa_wiggle_phases', '絵の枚数', 2, 8, 1)}
          <div class="opt_row"><button class="pbtn" id="aa_seed">${ic('reset')}揺れ方を変える</button></div>
        </section>`,
      },
      {
        id: 'motion',
        icon: 'move',
        label: '動き',
        body: `<section class="opt">
          <div class="opt_head"><b>動きの種類</b></div>
          <div class="seg wrap" id="aa_motions">${motion_buttons}</div>
          <div class="opt_row"><button class="pbtn" id="aa_auto">${ic('spark')}絵を見ておまかせ</button></div>
        </section>
        <section class="opt">
          ${range_row('aa_motion_amount', '大きさ', 0, 12, 0.5)}
          ${range_row('aa_motion_rate', '速さ', 0.5, 6, 0.25)}
          ${range_row('aa_anchor_x', '支点 横', 0, 100, 1)}
          ${range_row('aa_anchor_y', '支点 縦', 0, 100, 1)}
        </section>`,
      },
      {
        id: 'frames',
        icon: 'film',
        label: 'コマにする',
        body: `<section class="opt">
          <div class="opt_head"><b>ループ</b></div>
          ${range_row('aa_loop_frames', '枚数', 2, 16, 1)}
          ${runtime ? '<div class="opt_row"><button class="pbtn" id="aa_bake">この絵をループ化</button></div>' : ''}
        </section>
        <section class="opt">
          <div class="opt_head"><b>中割り</b></div>
          ${range_row('aa_between_frames', '枚数', 1, 8, 1)}
          <div class="opt_row"><button class="pbtn" id="aa_between">次のコマと中割り</button></div>
        </section>`,
      },
    ],
    actions: runtime
      ? '<button class="pbtn" id="aa_clear">動きを解除</button><button class="pbtn primary" id="aa_apply">設定だけで動かす</button>'
      : '<button class="pbtn primary" id="aa_apply">8コマにして適用</button>',
  })
  const preview = query<HTMLCanvasElement>(box, '#aa_preview')
  const preview_context = preview.getContext('2d') as CanvasRenderingContext2D
  const result = query(box, '#aa_result')
  const wiggle_button = query(box, '#aa_wiggle')
  const apply_button = query(box, '#aa_apply')
  const input = (id: string): HTMLInputElement => query<HTMLInputElement>(box, '#' + id)
  const loop_frames = input('aa_loop_frames')
  const between_count = input('aa_between_frames')
  loop_frames.value = '8'
  between_count.value = '3'
  const show = (id: string, text: string): void => {
    query(box, '#' + id + '_v').textContent = tr_line(text)
  }
  const sync_controls = (): void => {
    wiggle_button.setAttribute('aria-pressed', String(!!fx.wiggle))
    for (const button of box.querySelectorAll<HTMLElement>('[data-motion]')) button.setAttribute('aria-pressed', String(Number(button.dataset.motion) === fx.motion))
    input('aa_wiggle_amount').value = String(fx.wiggle_amount)
    input('aa_wiggle_cell').value = String(fx.wiggle_cell)
    input('aa_wiggle_rate').value = String(fx.wiggle_rate)
    input('aa_wiggle_phases').value = String(fx.wiggle_phases)
    input('aa_motion_amount').value = String(fx.motion_amount)
    input('aa_motion_rate').value = String(fx.motion_rate)
    input('aa_anchor_x').value = String(Math.round(fx.motion_anchor_x * 100))
    input('aa_anchor_y').value = String(Math.round(fx.motion_anchor_y * 100))
    show('aa_wiggle_amount', fx.wiggle_amount.toFixed(1))
    show('aa_wiggle_cell', Math.round(fx.wiggle_cell) + 'px')
    show('aa_wiggle_rate', Math.round(fx.wiggle_rate) + '/秒')
    show('aa_wiggle_phases', Math.round(fx.wiggle_phases) + '枚')
    show('aa_motion_amount', fx.motion_amount.toFixed(1))
    show('aa_motion_rate', fx.motion_rate.toFixed(2))
    show('aa_anchor_x', Math.round(fx.motion_anchor_x * 100) + '%')
    show('aa_anchor_y', Math.round(fx.motion_anchor_y * 100) + '%')
    show('aa_loop_frames', loop_frames.value)
    show('aa_between_frames', between_count.value)
    if (!runtime) apply_button.textContent = loop_frames.value + 'コマにして適用'
  }
  const read_controls = (): void => {
    fx = animfx_normalize({
      ...fx,
      wiggle_amount: Number(input('aa_wiggle_amount').value),
      wiggle_cell: Number(input('aa_wiggle_cell').value),
      wiggle_rate: Number(input('aa_wiggle_rate').value),
      wiggle_phases: Number(input('aa_wiggle_phases').value),
      motion_amount: Number(input('aa_motion_amount').value),
      motion_rate: Number(input('aa_motion_rate').value),
      motion_anchor_x: Number(input('aa_anchor_x').value) / 100,
      motion_anchor_y: Number(input('aa_anchor_y').value) / 100,
    })
    sync_controls()
  }
  let raf = 0
  let last_draw = 0
  const loop = (now: number): void => {
    if (!box.isConnected) {
      raf = 0
      return
    }
    if (now - last_draw >= 50) {
      last_draw = now
      animfx_compose(g.doc.cur, preview_context, preview.width, preview.height, 1, now / 1000, fx)
    }
    raf = requestAnimationFrame(loop)
  }
  sync_controls()
  raf = requestAnimationFrame(loop)
  modal_set_cleanup(() => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  })
  wiggle_button.addEventListener('click', () => {
    fx.wiggle = fx.wiggle ? 0 : 1
    sync_controls()
    sfx_play('tap')
  })
  query(box, '#aa_motions').addEventListener('click', e => {
    const button = (e.target as HTMLElement).closest<HTMLElement>('[data-motion]')
    if (!button) return
    fx = animfx_normalize({ ...fx, motion: Number(button.dataset.motion) })
    sync_controls()
    sfx_play('tap')
  })
  query(box, '#aa_seed').addEventListener('click', () => {
    const seed = anim_seed_random()
    fx.wiggle_seed = seed
    fx.motion_seed = seed ^ 0x9e3779b9
    result.textContent = '揺れ方を変えました'
    sfx_play('tap')
  })
  query(box, '#aa_auto').addEventListener('click', () => {
    const analysis = assist_analyze_frame(g.doc.cur, fx)
    fx = analysis.fx
    result.textContent = analysis.label
    sync_controls()
    sfx_play('sparkle')
  })
  for (const id of ['aa_wiggle_amount', 'aa_wiggle_cell', 'aa_wiggle_rate', 'aa_wiggle_phases', 'aa_motion_amount', 'aa_motion_rate', 'aa_anchor_x', 'aa_anchor_y']) input(id).addEventListener('input', read_controls)
  loop_frames.addEventListener('input', sync_controls)
  between_count.addEventListener('input', sync_controls)
  box.querySelector('#aa_clear')?.addEventListener('click', () => {
    modal_close()
    dispatch('anim.clear', null)
    toast('動きを解除しました')
  })
  apply_button.addEventListener('click', () => {
    read_controls()
    const count = Number(loop_frames.value)
    modal_close()
    if (!runtime) {
      bake_frames(fx, count)
      return
    }
    dispatch('anim.set', fx)
    toast('コマを増やさず動かします')
    sfx_play('save')
  })
  box.querySelector('#aa_bake')?.addEventListener('click', () => {
    read_controls()
    const count = Number(loop_frames.value)
    modal_close()
    bake_frames(fx, count)
  })
  query(box, '#aa_between').addEventListener('click', () => {
    const count = Number(between_count.value)
    modal_close()
    between_frames(count)
  })
}
