import { animfx_active, animfx_compose, animfx_draw_cycle, animfx_loop_plan } from '../animfx'
import { anim_seed_random, animfx_normalize } from '../animset'
import { assist_analyze_frame, assist_estimate_shift } from '../assist'
import { doc_frame_new, doc_layer_canvas, pack_canvas } from '../doc'
import { esc, ic, query, toast } from '../dom'
import { L_N, MOTION_BOUNCE, MOTION_BREATHE, MOTION_CAMERA, MOTION_FLOAT, MOTION_NONE, MOTION_SWAY, type AnimFx, type Frame } from '../h'
import { canvas_make, clamp } from '../lib'
import { mode_allows_runtime_anim, mode_frame_limit, mode_layer_allowed } from '../mode'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st } from '../state/store'
import { modal_close, modal_open, modal_progress, modal_set_cleanup } from './modal'

type MotionDef = { id: number, label: string, detail: string }

const MOTIONS: MotionDef[] = [
  { id: MOTION_NONE, label: 'なし', detail: '手描きゆらぎだけを使います' },
  { id: MOTION_BREATHE, label: '呼吸', detail: '中心を保って、ふくらんだり戻ったりします' },
  { id: MOTION_SWAY, label: 'ゆらゆら', detail: '足元を支点に左右へ揺れます' },
  { id: MOTION_FLOAT, label: 'ふわふわ', detail: '上下左右へゆっくり漂います' },
  { id: MOTION_BOUNCE, label: 'ぴょこぴょこ', detail: '少しつぶれながら上下に跳ねます' },
  { id: MOTION_CAMERA, label: '手持ちカメラ', detail: '画面全体へ小さなカメラ揺れを加えます' },
]

function motion_options(selected: number): string {
  let html = ''
  for (const motion of MOTIONS) html += '<option value="' + motion.id + '"' + (motion.id === selected ? ' selected' : '') + '>' + esc(motion.label) + '</option>'
  return html
}

function motion_detail(id: number): string {
  for (const motion of MOTIONS) if (motion.id === id) return motion.detail
  return MOTIONS[0].detail
}

function frame_sources(frameIndex: number): (HTMLCanvasElement | null)[] {
  const g = st()
  const frame = g.doc.frames[frameIndex]
  const out = new Array<HTMLCanvasElement | null>(L_N).fill(null)
  if (!frame) return out
  for (let layer = 0; layer < L_N; layer++) if (frame.pk[layer]) out[layer] = doc_layer_canvas(frameIndex, layer)
  return out
}

function bake_frames(fxValue: AnimFx, countValue: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const count = clamp(Math.round(countValue), 2, 24)
  if (g.doc.frames.length - 1 + count > mode_frame_limit(g.doc.mode)) {
    toast('コマ上限をこえるため変換できません')
    return
  }
  const fx = animfx_normalize(fxValue)
  if (!animfx_active(fx)) {
    toast('動きが設定されていません')
    return
  }
  const sourceFrame = g.doc.frames[g.doc.cur]
  const sources = frame_sources(g.doc.cur)
  const loop = animfx_loop_plan(g.doc.fps, fx)
  const frames: Frame[] = []
  const progress = modal_progress('動きをコマに変換中')
  progress.note(count + 'コマのループを作ります')
  let index = 0
  const step = (): void => {
    const started = performance.now()
    while (index < count && performance.now() - started < 20) {
      const frame = doc_frame_new()
      frame.se = index === 0 ? sourceFrame.se : 0
      frame.hold = 1
      const cycle = index / count
      for (let layer = 0; layer < L_N; layer++) {
        if (!mode_layer_allowed(g.doc.mode, layer)) {
          frame.pk[layer] = sourceFrame.pk[layer]
          continue
        }
        const source = sources[layer]
        if (!source) continue
        const [canvas, context] = canvas_make(g.doc.w, g.doc.h, 1)
        context.imageSmoothingEnabled = true
        animfx_draw_cycle(source, context, g.doc.w, g.doc.h, cycle, fx, sourceFrame.id, loop)
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

function between_frames(countValue: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  const from = g.doc.cur
  const to = from + 1
  if (to >= g.doc.frames.length) {
    toast('次のコマがありません')
    return
  }
  const count = clamp(Math.round(countValue), 1, 12)
  if (g.doc.frames.length + count > mode_frame_limit(g.doc.mode)) {
    toast('コマ上限をこえるため作れません')
    return
  }
  const shift = assist_estimate_shift(from, to)
  const sourceA = frame_sources(from)
  const sourceB = frame_sources(to)
  const frames: Frame[] = []
  const progress = modal_progress('中割りを作成中')
  progress.note('絵の移動を端末内で見つけています')
  let index = 0
  const step = (): void => {
    const started = performance.now()
    while (index < count && performance.now() - started < 20) {
      const t = (index + 1) / (count + 1)
      const frame = doc_frame_new()
      frame.hold = 1
      for (let layer = 0; layer < L_N; layer++) {
        const a = sourceA[layer]
        const b = sourceB[layer]
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
    if (dispatch('frame.insert_bulk', { at: to, frames, setCur: to }) < 0) {
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
  let fx: AnimFx = { ...g.doc.anim }
  if (!fx.wiggle && fx.motion === MOTION_NONE) fx.wiggle = 1
  const size = preview_size()
  const intro = runtime ? '絵の画素は変えず、再生時だけ手描きの揺れや動きを加えられます。処理は端末内だけで行います。' : 'うごメモ系モードでは再生時だけの動きを保存できないため、設定した動きを必ず編集可能な実コマへ変換します。'
  const badge = runtime ? '設定だけなら 0コマ' : '実コマへ変換'
  const bakeHtml = runtime ? '<button class="mbtn" id="aaBake">この絵をループ化</button>' : ''
  const clearHtml = runtime ? '<button class="mbtn" id="aaClear">動きを解除</button>' : ''
  const applyLabel = runtime ? '設定だけで動かす' : '8コマにして適用'
  const box = modal_open(
    '<div class="mhead">' + ic('spark') + 'うごきアシスト</div>' +
    '<div class="mbody dim">' + intro + '</div>' +
    '<div class="aagrid"><div class="aapreview"><canvas id="aaPreview" width="' + size.w + '" height="' + size.h + '"></canvas><div class="aabadge">' + badge + '</div><div class="aadetail" id="aaResult">手描きゆらぎをプレビューしています</div></div>' +
    '<div class="aaopts"><div class="aacard"><div class="msub">手描きゆらぎ</div>' +
    '<div class="mrow"><button class="tgl" id="aaWiggle">線と塗りをウネウネ</button><button class="mbtn sm" id="aaSeed">揺れ方を変える</button></div>' +
    '<div class="mrow rng"><span class="rlab">つよさ</span><input type="range" id="aaWiggleAmount" min="0" max="8" step="0.5"><b class="rval" id="aaWiggleAmountV"></b></div>' +
    '<div class="mrow rng"><span class="rlab">細かさ</span><input type="range" id="aaWiggleCell" min="8" max="72" step="2"><b class="rval" id="aaWiggleCellV"></b></div>' +
    '<div class="mrow rng"><span class="rlab">速さ</span><input type="range" id="aaWiggleRate" min="1" max="16" step="1"><b class="rval" id="aaWiggleRateV"></b></div>' +
    '<div class="mrow rng"><span class="rlab">絵の枚数</span><input type="range" id="aaWigglePhases" min="2" max="8" step="1"><b class="rval" id="aaWigglePhasesV"></b></div></div>' +
    '<div class="aacard"><div class="msub">ローカル動作支援</div>' +
    '<div class="mrow"><button class="mbtn primary" id="aaAuto">' + ic('spark') + '絵を見ておまかせ</button></div>' +
    '<div class="mrow"><span class="rlab">動き</span><select id="aaMotion" class="grow">' + motion_options(fx.motion) + '</select></div>' +
    '<div class="mrow rng"><span class="rlab">大きさ</span><input type="range" id="aaMotionAmount" min="0" max="12" step="0.5"><b class="rval" id="aaMotionAmountV"></b></div>' +
    '<div class="mrow rng"><span class="rlab">速さ</span><input type="range" id="aaMotionRate" min="0.5" max="6" step="0.25"><b class="rval" id="aaMotionRateV"></b></div>' +
    '<div class="mrow rng"><span class="rlab">支点 横</span><input type="range" id="aaAnchorX" min="0" max="100" step="1"><b class="rval" id="aaAnchorXV"></b></div>' +
    '<div class="mrow rng"><span class="rlab">支点 縦</span><input type="range" id="aaAnchorY" min="0" max="100" step="1"><b class="rval" id="aaAnchorYV"></b></div></div>' +
    '<div class="aacard"><div class="msub">コマを作る場合</div>' +
    '<div class="mrow rng"><span class="rlab">ループ枚数</span><input type="range" id="aaLoopFrames" min="2" max="16" step="1" value="8"><b class="rval" id="aaLoopFramesV">8</b></div>' +
    '<div class="mrow rng"><span class="rlab">中割り枚数</span><input type="range" id="aaBetweenFrames" min="1" max="8" step="1" value="3"><b class="rval" id="aaBetweenFramesV">3</b></div>' +
    '<div class="mrow wrap">' + bakeHtml + '<button class="mbtn" id="aaBetween">次のコマと中割り</button></div></div></div></div>' +
    '<div class="mrow end">' + clearHtml + '<button class="mbtn" id="aaNo">やめる</button><button class="mbtn primary" id="aaApply">' + applyLabel + '</button></div>',
    1
  )
  box.classList.add('wide')
  const preview = query<HTMLCanvasElement>(box, '#aaPreview')
  const previewContext = preview.getContext('2d') as CanvasRenderingContext2D
  const result = query(box, '#aaResult')
  const wiggleButton = query(box, '#aaWiggle')
  const motionSelect = query<HTMLSelectElement>(box, '#aaMotion')
  const wiggleAmount = query<HTMLInputElement>(box, '#aaWiggleAmount')
  const wiggleCell = query<HTMLInputElement>(box, '#aaWiggleCell')
  const wiggleRate = query<HTMLInputElement>(box, '#aaWiggleRate')
  const wigglePhases = query<HTMLInputElement>(box, '#aaWigglePhases')
  const motionAmount = query<HTMLInputElement>(box, '#aaMotionAmount')
  const motionRate = query<HTMLInputElement>(box, '#aaMotionRate')
  const anchorX = query<HTMLInputElement>(box, '#aaAnchorX')
  const anchorY = query<HTMLInputElement>(box, '#aaAnchorY')
  const loopFrames = query<HTMLInputElement>(box, '#aaLoopFrames')
  const betweenFrames = query<HTMLInputElement>(box, '#aaBetweenFrames')
  const applyButton = query(box, '#aaApply')
  const sync_controls = (): void => {
    wiggleButton.classList.toggle('on', fx.wiggle ? true : false)
    motionSelect.value = String(fx.motion)
    wiggleAmount.value = String(fx.wiggleAmount)
    wiggleCell.value = String(fx.wiggleCell)
    wiggleRate.value = String(fx.wiggleRate)
    wigglePhases.value = String(fx.wigglePhases)
    motionAmount.value = String(fx.motionAmount)
    motionRate.value = String(fx.motionRate)
    anchorX.value = String(Math.round(fx.motionAnchorX * 100))
    anchorY.value = String(Math.round(fx.motionAnchorY * 100))
    query(box, '#aaWiggleAmountV').textContent = fx.wiggleAmount.toFixed(1)
    query(box, '#aaWiggleCellV').textContent = Math.round(fx.wiggleCell) + 'px'
    query(box, '#aaWiggleRateV').textContent = Math.round(fx.wiggleRate) + '/秒'
    query(box, '#aaWigglePhasesV').textContent = Math.round(fx.wigglePhases) + '枚'
    query(box, '#aaMotionAmountV').textContent = fx.motionAmount.toFixed(1)
    query(box, '#aaMotionRateV').textContent = fx.motionRate.toFixed(2)
    query(box, '#aaAnchorXV').textContent = Math.round(fx.motionAnchorX * 100) + '%'
    query(box, '#aaAnchorYV').textContent = Math.round(fx.motionAnchorY * 100) + '%'
    query(box, '#aaLoopFramesV').textContent = loopFrames.value
    query(box, '#aaBetweenFramesV').textContent = betweenFrames.value
    if (!runtime) applyButton.textContent = loopFrames.value + 'コマにして適用'
  }
  const read_controls = (): void => {
    fx = animfx_normalize({
      ...fx,
      wiggle: wiggleButton.classList.contains('on') ? 1 : 0,
      wiggleAmount: Number(wiggleAmount.value),
      wiggleCell: Number(wiggleCell.value),
      wiggleRate: Number(wiggleRate.value),
      wigglePhases: Number(wigglePhases.value),
      motion: Number(motionSelect.value),
      motionAmount: Number(motionAmount.value),
      motionRate: Number(motionRate.value),
      motionAnchorX: Number(anchorX.value) / 100,
      motionAnchorY: Number(anchorY.value) / 100,
    })
    result.textContent = motion_detail(fx.motion)
    sync_controls()
  }
  let raf = 0
  let lastDraw = 0
  const loop = (now: number): void => {
    if (!box.isConnected) {
      raf = 0
      return
    }
    if (now - lastDraw >= 50) {
      lastDraw = now
      animfx_compose(g.doc.cur, previewContext, preview.width, preview.height, 1, now / 1000, fx)
    }
    raf = requestAnimationFrame(loop)
  }
  sync_controls()
  raf = requestAnimationFrame(loop)
  modal_set_cleanup(() => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  })
  wiggleButton.addEventListener('click', () => {
    fx.wiggle = fx.wiggle ? 0 : 1
    sync_controls()
    sfx_play('tap')
  })
  query(box, '#aaSeed').addEventListener('click', () => {
    const seed = anim_seed_random()
    fx.wiggleSeed = seed
    fx.motionSeed = seed ^ 0x9e3779b9
    result.textContent = '揺れ方の組み合わせを変えました'
    sfx_play('tap')
  })
  query(box, '#aaAuto').addEventListener('click', () => {
    const analysis = assist_analyze_frame(g.doc.cur, fx)
    fx = analysis.fx
    result.textContent = analysis.label + '：' + analysis.detail
    sync_controls()
    sfx_play('sparkle')
  })
  for (const input of [wiggleAmount, wiggleCell, wiggleRate, wigglePhases, motionAmount, motionRate, anchorX, anchorY, motionSelect]) input.addEventListener('input', read_controls)
  loopFrames.addEventListener('input', sync_controls)
  betweenFrames.addEventListener('input', sync_controls)
  const clearButton = box.querySelector<HTMLElement>('#aaClear')
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      modal_close()
      dispatch('anim.clear', null)
      toast('再生時の動きを解除しました')
    })
  }
  query(box, '#aaNo').addEventListener('click', modal_close)
  applyButton.addEventListener('click', () => {
    read_controls()
    const count = Number(loopFrames.value)
    modal_close()
    if (!runtime) {
      bake_frames(fx, count)
      return
    }
    dispatch('anim.set', fx)
    toast('コマを増やさず動かします')
    sfx_play('save')
  })
  const bakeButton = box.querySelector<HTMLElement>('#aaBake')
  if (bakeButton) {
    bakeButton.addEventListener('click', () => {
      read_controls()
      const count = Number(loopFrames.value)
      modal_close()
      bake_frames(fx, count)
    })
  }
  query(box, '#aaBetween').addEventListener('click', () => {
    const count = Number(betweenFrames.value)
    modal_close()
    between_frames(count)
  })
}
