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
import { modal_close, modal_open, modal_progress, modal_set_cleanup } from './modal'

type motion_def_t = { id: number, label: string, detail: string }

const motions: motion_def_t[] = [
  { id: motion_none, label: 'なし', detail: '手描きゆらぎだけを使います' },
  { id: motion_breathe, label: '呼吸', detail: '中心を保って、ふくらんだり戻ったりします' },
  { id: motion_sway, label: 'ゆらゆら', detail: '足元を支点に左右へ揺れます' },
  { id: motion_float, label: 'ふわふわ', detail: '上下左右へゆっくり漂います' },
  { id: motion_bounce, label: 'ぴょこぴょこ', detail: '少しつぶれながら上下に跳ねます' },
  { id: motion_camera, label: '手持ちカメラ', detail: '画面全体へ小さなカメラ揺れを加えます' },
]

function motion_options(selected: number): string {
  let html = ''
  for (const motion of motions) html += '<option value="' + motion.id + '"' + (motion.id === selected ? ' selected' : '') + '>' + esc(motion.label) + '</option>'
  return html
}

function motion_detail(id: number): string {
  for (const motion of motions) if (motion.id === id) return motion.detail
  return motions[0].detail
}

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

export function modal_animation_assist(): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const runtime = mode_allows_runtime_anim(g.doc.mode)
  let fx: anim_fx_t = { ...g.doc.anim }
  if (!fx.wiggle && fx.motion === motion_none) fx.wiggle = 1
  const size = preview_size()
  const intro = runtime ? '絵の画素は変えず、再生時だけ手描きの揺れや動きを加えられます。処理は端末内だけで行います。' : 'うごメモ系モードでは再生時だけの動きを保存できないため、設定した動きを必ず編集可能な実コマへ変換します。'
  const badge = runtime ? '設定だけなら 0コマ' : '実コマへ変換'
  const bake_html = runtime ? '<button class="mbtn" id="aa_bake">この絵をループ化</button>' : ''
  const clear_html = runtime ? '<button class="mbtn" id="aa_clear">動きを解除</button>' : ''
  const apply_label = runtime ? '設定だけで動かす' : '8コマにして適用'
  const box = modal_open(
    '<div class="mhead">' + ic('spark') + 'うごきアシスト</div>' +
    '<div class="mbody dim">' + intro + '</div>' +
    '<div class="aagrid"><div class="aapreview"><canvas id="aa_preview" width="' + size.w + '" height="' + size.h + '"></canvas><div class="aabadge">' + badge + '</div><div class="aadetail" id="aa_result">手描きゆらぎをプレビューしています</div></div>' +
    '<div class="aaopts"><div class="aacard"><div class="msub">手描きゆらぎ</div>' +
    '<div class="mrow"><button class="tgl" id="aa_wiggle">線と塗りをウネウネ</button><button class="mbtn sm" id="aa_seed">揺れ方を変える</button></div>' +
    '<div class="mrow rng"><span class="rlab">つよさ</span><input type="range" id="aa_wiggle_amount" min="0" max="8" step="0.5"><b class="rval" id="aa_wiggle_amount_v"></b></div>' +
    '<div class="mrow rng"><span class="rlab">細かさ</span><input type="range" id="aa_wiggle_cell" min="8" max="72" step="2"><b class="rval" id="aa_wiggle_cell_v"></b></div>' +
    '<div class="mrow rng"><span class="rlab">速さ</span><input type="range" id="aa_wiggle_rate" min="1" max="16" step="1"><b class="rval" id="aa_wiggle_rate_v"></b></div>' +
    '<div class="mrow rng"><span class="rlab">絵の枚数</span><input type="range" id="aa_wiggle_phases" min="2" max="8" step="1"><b class="rval" id="aa_wiggle_phases_v"></b></div></div>' +
    '<div class="aacard"><div class="msub">ローカル動作支援</div>' +
    '<div class="mrow"><button class="mbtn primary" id="aa_auto">' + ic('spark') + '絵を見ておまかせ</button></div>' +
    '<div class="mrow"><span class="rlab">動き</span><select id="aa_motion" class="grow">' + motion_options(fx.motion) + '</select></div>' +
    '<div class="mrow rng"><span class="rlab">大きさ</span><input type="range" id="aa_motion_amount" min="0" max="12" step="0.5"><b class="rval" id="aa_motion_amount_v"></b></div>' +
    '<div class="mrow rng"><span class="rlab">速さ</span><input type="range" id="aa_motion_rate" min="0.5" max="6" step="0.25"><b class="rval" id="aa_motion_rate_v"></b></div>' +
    '<div class="mrow rng"><span class="rlab">支点 横</span><input type="range" id="aa_anchor_x" min="0" max="100" step="1"><b class="rval" id="aa_anchor_xv"></b></div>' +
    '<div class="mrow rng"><span class="rlab">支点 縦</span><input type="range" id="aa_anchor_y" min="0" max="100" step="1"><b class="rval" id="aa_anchor_yv"></b></div></div>' +
    '<div class="aacard"><div class="msub">コマを作る場合</div>' +
    '<div class="mrow rng"><span class="rlab">ループ枚数</span><input type="range" id="aa_loop_frames" min="2" max="16" step="1" value="8"><b class="rval" id="aa_loop_frames_v">8</b></div>' +
    '<div class="mrow rng"><span class="rlab">中割り枚数</span><input type="range" id="aa_between_frames" min="1" max="8" step="1" value="3"><b class="rval" id="aa_between_frames_v">3</b></div>' +
    '<div class="mrow wrap">' + bake_html + '<button class="mbtn" id="aa_between">次のコマと中割り</button></div></div></div></div>' +
    '<div class="mrow end">' + clear_html + '<button class="mbtn" id="aa_no">やめる</button><button class="mbtn primary" id="aa_apply">' + apply_label + '</button></div>',
    1
  )
  box.classList.add('wide')
  const preview = query<HTMLCanvasElement>(box, '#aa_preview')
  const preview_context = preview.getContext('2d') as CanvasRenderingContext2D
  const result = query(box, '#aa_result')
  const wiggle_button = query(box, '#aa_wiggle')
  const motion_select = query<HTMLSelectElement>(box, '#aa_motion')
  const wiggle_amount = query<HTMLInputElement>(box, '#aa_wiggle_amount')
  const wiggle_cell = query<HTMLInputElement>(box, '#aa_wiggle_cell')
  const wiggle_rate = query<HTMLInputElement>(box, '#aa_wiggle_rate')
  const wiggle_phases = query<HTMLInputElement>(box, '#aa_wiggle_phases')
  const motion_amount = query<HTMLInputElement>(box, '#aa_motion_amount')
  const motion_rate = query<HTMLInputElement>(box, '#aa_motion_rate')
  const anchor_x = query<HTMLInputElement>(box, '#aa_anchor_x')
  const anchor_y = query<HTMLInputElement>(box, '#aa_anchor_y')
  const loop_frames = query<HTMLInputElement>(box, '#aa_loop_frames')
  const between_count = query<HTMLInputElement>(box, '#aa_between_frames')
  const apply_button = query(box, '#aa_apply')
  const sync_controls = (): void => {
    wiggle_button.classList.toggle('on', fx.wiggle ? true : false)
    motion_select.value = String(fx.motion)
    wiggle_amount.value = String(fx.wiggle_amount)
    wiggle_cell.value = String(fx.wiggle_cell)
    wiggle_rate.value = String(fx.wiggle_rate)
    wiggle_phases.value = String(fx.wiggle_phases)
    motion_amount.value = String(fx.motion_amount)
    motion_rate.value = String(fx.motion_rate)
    anchor_x.value = String(Math.round(fx.motion_anchor_x * 100))
    anchor_y.value = String(Math.round(fx.motion_anchor_y * 100))
    query(box, '#aa_wiggle_amount_v').textContent = fx.wiggle_amount.toFixed(1)
    query(box, '#aa_wiggle_cell_v').textContent = Math.round(fx.wiggle_cell) + 'px'
    query(box, '#aa_wiggle_rate_v').textContent = Math.round(fx.wiggle_rate) + '/秒'
    query(box, '#aa_wiggle_phases_v').textContent = Math.round(fx.wiggle_phases) + '枚'
    query(box, '#aa_motion_amount_v').textContent = fx.motion_amount.toFixed(1)
    query(box, '#aa_motion_rate_v').textContent = fx.motion_rate.toFixed(2)
    query(box, '#aa_anchor_xv').textContent = Math.round(fx.motion_anchor_x * 100) + '%'
    query(box, '#aa_anchor_yv').textContent = Math.round(fx.motion_anchor_y * 100) + '%'
    query(box, '#aa_loop_frames_v').textContent = loop_frames.value
    query(box, '#aa_between_frames_v').textContent = between_count.value
    if (!runtime) apply_button.textContent = loop_frames.value + 'コマにして適用'
  }
  const read_controls = (): void => {
    fx = animfx_normalize({
      ...fx,
      wiggle: wiggle_button.classList.contains('on') ? 1 : 0,
      wiggle_amount: Number(wiggle_amount.value),
      wiggle_cell: Number(wiggle_cell.value),
      wiggle_rate: Number(wiggle_rate.value),
      wiggle_phases: Number(wiggle_phases.value),
      motion: Number(motion_select.value),
      motion_amount: Number(motion_amount.value),
      motion_rate: Number(motion_rate.value),
      motion_anchor_x: Number(anchor_x.value) / 100,
      motion_anchor_y: Number(anchor_y.value) / 100,
    })
    result.textContent = motion_detail(fx.motion)
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
  query(box, '#aa_seed').addEventListener('click', () => {
    const seed = anim_seed_random()
    fx.wiggle_seed = seed
    fx.motion_seed = seed ^ 0x9e3779b9
    result.textContent = '揺れ方の組み合わせを変えました'
    sfx_play('tap')
  })
  query(box, '#aa_auto').addEventListener('click', () => {
    const analysis = assist_analyze_frame(g.doc.cur, fx)
    fx = analysis.fx
    result.textContent = analysis.label + '：' + analysis.detail
    sync_controls()
    sfx_play('sparkle')
  })
  for (const input of [wiggle_amount, wiggle_cell, wiggle_rate, wiggle_phases, motion_amount, motion_rate, anchor_x, anchor_y, motion_select]) input.addEventListener('input', read_controls)
  loop_frames.addEventListener('input', sync_controls)
  between_count.addEventListener('input', sync_controls)
  const clear_button = box.querySelector<HTMLElement>('#aa_clear')
  if (clear_button) {
    clear_button.addEventListener('click', () => {
      modal_close()
      dispatch('anim.clear', null)
      toast('再生時の動きを解除しました')
    })
  }
  query(box, '#aa_no').addEventListener('click', modal_close)
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
  const bake_button = box.querySelector<HTMLElement>('#aa_bake')
  if (bake_button) {
    bake_button.addEventListener('click', () => {
      read_controls()
      const count = Number(loop_frames.value)
      modal_close()
      bake_frames(fx, count)
    })
  }
  query(box, '#aa_between').addEventListener('click', () => {
    const count = Number(between_count.value)
    modal_close()
    between_frames(count)
  })
}
