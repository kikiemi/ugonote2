import { ease_at, ease_even, ease_slow_both, ease_slow_end, ease_slow_start } from '../aid/between'
import type { aid_input_t, aid_layer_t, aid_output_t } from '../aid/job'
import { motion_weights } from '../aid/weights'
import { doc_frame_clone, doc_frame_new, doc_frame_order, doc_frame_paper } from '../doc'
import { query, toast } from '../dom'
import { hold_max, l_n, l_p, mode_normal, type frame_t, type rle_t } from '../h'
import { clamp, hex_rgb } from '../lib'
import { mode_frame_limit, mode_speeds } from '../mode'
import { pixel_source_is } from '../pixel_source'
import { sfx_play } from '../snd'
import { dispatch } from '../state/commands/index'
import { st, type deep_ro_t } from '../state/store'
import { aid_run_async } from '../workercli'
import { modal_close, modal_progress } from './modal'
import { sheet_open } from './sheet'
import { choices, range_row } from './templates/parts'

// 前に選んだもの。count: 中割りの枚数。ease: 中割りの動きの緩急。rate: なめらかにする倍率。
const aid_choice = { count: 3, ease: ease_even, rate: 2 }

// 動きで説明できた割合がこれより小さい2コマは、中割りしない。全部のコマをなめらかにするときは確かな所だけにする。
// 測定 (うごメモ 202 組) では、0.5 以上の組で元の絵のままより誤差が 23% へり、86% の組で良くなる。
const least_all = 0.5
// コマを指定して作るときは、もう少しゆるくする。
const least_pair = 0.3
// なめらかにする倍率の上限。
const rate_max = 6

// コマの組で作るレイヤー。ids はレイヤーの番号、layers はそのならび (下から順)、moved は絵のちがうレイヤーの番号。
type aid_pair_t = { ids: number[], layers: aid_layer_t[], moved: number[] }

// 動画から読みこんだ絵など、点を読めない絵か。
export function pk_locked(pk: deep_ro_t<rle_t> | null): number {
  return pk && pixel_source_is(pk as rle_t) ? 1 : 0
}

// 2枚が同じ絵か。
function pk_same(a: deep_ro_t<rle_t> | null, b: deep_ro_t<rle_t> | null): number {
  if (a === b) return 1
  if (!a || !b || a.length !== b.length) return 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return 0
  return 1
}

// ノーマルモードだけで使える。
export function aid_allowed(): number {
  if (st().doc.mode === mode_normal) return 1
  toast('AI制作支援はノーマルモード専用です')
  return 0
}

function error_text(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// コマ from と to のレイヤーを、AI にわたす形に集める。
function pair_make(from: number, to: number): aid_pair_t {
  const g = st()
  const pair: aid_pair_t = { ids: [], layers: [], moved: [] }
  const order = doc_frame_order(from)
  for (let k = order.length - 1; k >= 0; k--) {
    const l = order[k]
    if (l === l_p) continue
    const a = g.doc.frames[from].pk[l]
    const b = g.doc.frames[to].pk[l]
    if (pk_locked(a) || pk_locked(b) || !a && !b) continue
    const move = pk_same(a, b) ? 0 : 1
    pair.ids.push(l)
    pair.layers.push({ a: a as rle_t | null, b: b as rle_t | null, alpha: g.doc.lvis[l] ? g.doc.lalpha[l] / 255 : 0, move })
    if (move) pair.moved.push(l)
  }
  return pair
}

// 仕事の中身を作る。
function pair_input(pair: aid_pair_t, from: number, weights: ArrayBuffer, times: number[], least: number): aid_input_t {
  const g = st()
  return { weights, w: g.doc.w, h: g.doc.h, paper: hex_rgb(doc_frame_paper(from)), layers: pair.layers, times, least }
}

// 作った絵をコマにする。near は、動かさなかったレイヤーの絵をもらうコマ。packs は moved の順に count 枚ずつならぶ。
function frame_built(near: number, moved: number[], packs: (rle_t | null)[], count: number, k: number): frame_t {
  const source = st().doc.frames[near]
  const frame = doc_frame_new()
  for (let l = 0; l < l_n; l++) frame.pk[l] = source.pk[l] as rle_t | null
  for (let p = 0; p < moved.length; p++) frame.pk[moved[p]] = packs[p * count + k]
  return frame
}

// 中割りの時間。
function pair_times(count: number, ease: number): number[] {
  const times: number[] = []
  for (let k = 0; k < count; k++) times.push(ease_at(ease, (k + 1) / (count + 1)))
  return times
}

// 設定の画面。go は決めるボタンを押したときの仕事 (画面を閉じてから呼ぶ)。
function aid_sheet(icon: string, title: string, body: string, label: string, go: () => void): HTMLElement {
  const box = sheet_open({ icon, title, pages: [{ id: 'aid', icon, label: title, body }], actions: `<button class="pbtn primary" id="ad_go">${label}</button>` })
  query(box, '#ad_go').addEventListener('click', () => {
    modal_close()
    go()
  })
  return box
}

// ひとつえらぶボタンの列。value は選んでいる値、pick は押したときに呼ぶ。
export function aid_seg(box: HTMLElement, attr: string, value: number, pick: (value: number) => void): void {
  const buttons = box.querySelectorAll<HTMLElement>('[data-' + attr + ']')
  const show = (now: number): void => {
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.getAttribute('data-' + attr) === String(now)))
  }
  show(value)
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const next = Number(button.getAttribute('data-' + attr))
      pick(next)
      show(next)
      sfx_play('tap')
    })
  }
}

// 枚数のスライダー。
function aid_count_bind(box: HTMLElement): void {
  const range = query<HTMLInputElement>(box, '#ad_count')
  const output = query(box, '#ad_count_v')
  range.value = String(aid_choice.count)
  output.textContent = aid_choice.count + '枚'
  range.addEventListener('input', () => {
    aid_choice.count = clamp(Math.round(Number(range.value)), 1, 8)
    output.textContent = aid_choice.count + '枚'
  })
}

// コマ from と to のあいだの絵を count 枚作り、コマの at の位置へ入れる。ease は動きの緩急。
async function between_work(from: number, to: number, at: number, count: number, ease: number): Promise<void> {
  const pair = pair_make(from, to)
  const times = pair_times(count, ease)
  const progress = modal_progress('中割りを作成中')
  progress.note('AIが絵の動きを読んでいます')
  let out: aid_output_t
  try {
    const weights = await motion_weights()
    if (!weights) throw new Error('AIを読みこめませんでした')
    out = await aid_run_async(pair_input(pair, from, weights, times, least_pair), value => progress.set(value))
  } catch (error) {
    progress.close()
    toast(error_text(error))
    return
  }
  progress.close()
  if (out.score < least_pair) {
    toast('絵がちがいすぎるので、中割りできません')
    return
  }
  const frames: frame_t[] = []
  for (let k = 0; k < count; k++) frames.push(frame_built(times[k] <= 0.5 ? from : to, pair.moved, out.packs, count, k))
  if (dispatch('frame.insert_steps', { at, frames }) < 0) {
    toast('中割りを追加できませんでした')
    return
  }
  toast(count + '枚の中割りを追加しました')
  sfx_play('paper')
}

// コマ from と to のあいだの絵を count 枚作り、コマの at の位置へ入れる。
export function aid_between_run(from: number, to: number, at: number, count: number, ease: number): void {
  dispatch('frame.sync_live', null)
  const g = st()
  if (g.doc.frames.length + count > mode_frame_limit(g.doc.mode)) {
    toast('コマ上限をこえるため作れません')
    return
  }
  if (!pair_make(from, to).moved.length) {
    toast('2つのコマで動いている絵がありません')
    return
  }
  void between_work(from, to, at, count, ease)
}

export function modal_aid_between(): void {
  if (!aid_allowed()) return
  const g = st()
  const from = g.doc.cur
  if (from + 1 >= g.doc.frames.length) {
    toast('次のコマがありません')
    return
  }
  const body = `<section class="opt">
    <div class="opt_head"><b>${from + 1} → ${from + 2} のあいだ</b></div>
    <p class="mbody dim">AIが2つのコマの絵の動きを読んで、あいだのコマを作ります。</p>
    ${range_row('ad_count', '枚数', 1, 8, 1)}
    <div class="opt_head"><b>動き方</b></div>
    ${choices('ad_ease', 'ease', [[String(ease_even), '一定'], [String(ease_slow_end), 'ゆっくり止まる'], [String(ease_slow_start), 'ゆっくり出る'], [String(ease_slow_both), '両方']])}
  </section>`
  const box = aid_sheet('film', '中割りをつくる', body, 'つくる', () => aid_between_run(from, from + 1, from + 1, aid_choice.count, aid_choice.ease))
  aid_count_bind(box)
  aid_seg(box, 'ease', aid_choice.ease, value => { aid_choice.ease = value })
}

export function modal_aid_loop(): void {
  if (!aid_allowed()) return
  const last = st().doc.frames.length - 1
  if (last < 1) {
    toast('コマが2つ以上必要です')
    return
  }
  const body = `<section class="opt">
    <div class="opt_head"><b>${last + 1} → 1 のあいだ</b></div>
    <p class="mbody dim">さいごのコマから最初のコマへもどる動きを作って、ループをなめらかにします。</p>
    ${range_row('ad_count', '枚数', 1, 8, 1)}
  </section>`
  const box = aid_sheet('loop', 'ループをつなぐ', body, 'つくる', () => aid_between_run(last, 0, last + 1, aid_choice.count, ease_even))
  aid_count_bind(box)
}

// コマ frame を、表示時間 ticks で list へ入れる。1コマの表示時間の上限をこえる分は、同じコマをつづける。
function frame_keep(list: frame_t[], frame: deep_ro_t<frame_t>, ticks: number): void {
  let rest = ticks
  let first = 1
  while (rest > 0) {
    const hold = Math.min(rest, hold_max)
    // はじめの1つは同じコマのまま (番号を変えないので、前後の設定やサムネイルが保たれる)。
    const copy = first ? { ...frame, pk: [...frame.pk] } as frame_t : doc_frame_clone(frame)
    copy.hold = hold
    if (!first) copy.se = 0
    list.push(copy)
    rest -= hold
    first = 0
  }
}

// 全部のコマのあいだに中割りを入れ、再生の速さを rate 倍にして、再生の時間を変えずにコマをふやす。
async function smooth_work(rate: number): Promise<void> {
  dispatch('frame.sync_live', null)
  const g = st()
  const total = g.doc.frames.length
  const count = rate - 1
  const times = pair_times(count, ease_even)
  let stop = 0
  const progress = modal_progress('動きをなめらかにしています', () => { stop = 1 })
  progress.note('AIが絵の動きを読んでいます')
  const list: frame_t[] = []
  let smoothed = 0
  let kept = 0
  try {
    const weights = await motion_weights()
    if (!weights) throw new Error('AIを読みこめませんでした')
    for (let i = 0; i < total && !stop; i++) {
      const frame = g.doc.frames[i]
      const ticks = frame.hold * rate
      if (i + 1 === total) {
        frame_keep(list, frame, ticks)
        break
      }
      const pair = pair_make(i, i + 1)
      let out: aid_output_t | null = null
      if (pair.moved.length) out = await aid_run_async(pair_input(pair, i, weights, times, least_all), () => {})
      progress.set((i + 1) / total)
      if (!out || !out.packs.length) {
        if (pair.moved.length) kept++
        frame_keep(list, frame, ticks)
        continue
      }
      smoothed++
      frame_keep(list, frame, ticks - count)
      for (let k = 0; k < count; k++) list.push(frame_built(times[k] <= 0.5 ? i : i + 1, pair.moved, out.packs, count, k))
    }
  } catch (error) {
    progress.close()
    toast(error_text(error))
    return
  }
  progress.close()
  if (stop) {
    toast('やめました')
    return
  }
  if (!smoothed) {
    toast('なめらかにできる動きが見つかりませんでした')
    return
  }
  if (list.length > mode_frame_limit(g.doc.mode)) {
    toast('コマ上限をこえるため作れません')
    return
  }
  if (dispatch('frame.note_apply', { frames: list, fps: g.doc.fps * rate }) < 0) {
    toast('コマを追加できませんでした')
    return
  }
  toast(smoothed + 'か所をなめらかにしました' + (kept ? '（' + kept + 'か所はそのまま）' : ''))
  sfx_play('paper')
}

// いまの速さで使える倍率 (速さの表にある速さになる倍率)。
function smooth_rates(): number[] {
  const g = st()
  const speeds = mode_speeds(g.doc.mode)
  const out: number[] = []
  for (let rate = 2; rate <= rate_max; rate++) if (speeds.includes(g.doc.fps * rate)) out.push(rate)
  return out
}

export function modal_aid_smooth(): void {
  if (!aid_allowed()) return
  const g = st()
  if (g.doc.frames.length < 2) {
    toast('コマが2つ以上必要です')
    return
  }
  const rates = smooth_rates()
  if (!rates.length) {
    toast('いまの速さがほぼ最高なので、これ以上なめらかにできません')
    return
  }
  if (!rates.includes(aid_choice.rate)) aid_choice.rate = rates[0]
  const list: [string, string][] = []
  for (let i = 0; i < rates.length; i++) list.push([String(rates[i]), rates[i] + '倍（' + g.doc.fps * rates[i] + 'コマ/秒）'])
  const slow = 'gpu' in navigator ? '' : '<p class="mbody dim">この端末ではAIをCPUで動かすので、時間がかかります。</p>'
  const body = `<section class="opt">
    <div class="opt_head"><b>全部のコマ（${g.doc.frames.length}コマ）</b></div>
    <p class="mbody dim">AIが動いている所を読んで中割りを入れます。再生の時間は変わりません。文字が出る所や場面の切りかわりなど、動きとして読めない所はそのままにします。「もどす」で元にもどせます。</p>
    ${choices('ad_rate', 'rate', list)}
    ${slow}
  </section>`
  const box = aid_sheet('spark', '動きをなめらかにする', body, 'なめらかにする', () => void smooth_work(aid_choice.rate))
  aid_seg(box, 'rate', aid_choice.rate, value => { aid_choice.rate = value })
}
