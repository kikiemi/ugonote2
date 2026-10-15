import { gpu_wiggle, gpu_reset } from './gpu'
import { memory_budget } from './memory'
import { doc_compose, doc_frame_paper } from './doc'
import { d_stage, motion_bounce, motion_breathe, motion_camera, motion_float, motion_none, motion_sway, type anim_fx_t, type rle_t } from './h'
import { canvas_make, clamp } from './lib'
import { dirty, st } from './state/store'

type source_cache_t = {
  frame_id: number
  refs: readonly (rle_t | null)[]
  view_key: string
  w: number
  h: number
  canvas: HTMLCanvasElement
}

type wiggle_grid_t = {
  w: number
  h: number
  cell: number
  columns: number
  rows: number
  stride: number
  x_cell: Uint16Array
  x_mix: Float32Array
  y_cell: Uint16Array
  y_mix: Float32Array
}

type wiggle_field_t = {
  grid: wiggle_grid_t
  amount: number
  phase: number
  seed: number
  dx: Float32Array
  dy: Float32Array
}

type wiggle_pixels_t = {
  source: CanvasImageSource
  w: number
  h: number
  data: Uint8ClampedArray
}

type wiggle_image_t = {
  source: CanvasImageSource
  field: wiggle_field_t
  canvas: HTMLCanvasElement
}

const source_cache: source_cache_t[] = []
const wiggle_grid_cache: wiggle_grid_t[] = []
const wiggle_field_cache: wiggle_field_t[] = []
const wiggle_pixel_cache: wiggle_pixels_t[] = []
const wiggle_image_cache: wiggle_image_t[] = []
let driver_raf = 0
let driver_bucket = -1
let driver_run = 0

function refs_same(a: readonly (rle_t | null)[], b: readonly (rle_t | null)[]): number {
  if (a.length !== b.length) return 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return 0
  return 1
}

function source_view_key(): string {
  const g = st()
  return g.doc.mode + '|' + g.doc.lvis.join(',') + '|' + g.doc.lalpha.join(',') + '|' + g.doc.lord.join(',')
}

function effect_trim<t>(entries: t[], size: (entry: t) => number, fraction: number): void {
  const budget = memory_budget(st().mobile, 'effects') * fraction
  let bytes = 0
  for (const entry of entries) bytes += size(entry)
  while (bytes > budget && entries.length) bytes -= size(entries.shift() as t)
}

function source_get(frame_index: number, w: number, h: number): HTMLCanvasElement {
  const g = st()
  const frame = g.doc.frames[frame_index]
  const key = source_view_key() + '|' + (frame.kwz?.depth.join(',') || '')
  for (let index = source_cache.length - 1; index >= 0; index--) {
    const entry = source_cache[index]
    if (entry.frame_id !== frame.id || entry.w !== w || entry.h !== h || entry.view_key !== key || !refs_same(entry.refs, frame.pk)) continue
    source_cache.splice(index, 1)
    source_cache.push(entry)
    return entry.canvas
  }
  const [canvas, context] = canvas_make(w, h, 1)
  const ready = doc_compose(frame_index, context, w, h, 0)
  if (ready) source_cache.push({ frame_id: frame.id, refs: [...frame.pk], view_key: key, w, h, canvas })
  effect_trim(source_cache, entry => entry.w * entry.h * 4, 0.24)
  return canvas
}

function hash32(value: number): number {
  let x = value | 0
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}

function hash_unit(seed: number): number {
  return hash32(seed) / 0xffffffff
}

function wiggle_offset(seed: number, phase: number, column: number, row: number, axis: number, amount: number): number {
  if (amount <= 0) return 0
  const value = seed ^ Math.imul(phase + 1, 0x9e3779b1) ^ Math.imul(column + 7, 0x85ebca6b) ^ Math.imul(row + 11, 0xc2b2ae35) ^ Math.imul(axis + 1, 0x27d4eb2d)
  return (hash_unit(value) * 2 - 1) * amount
}

function motion_seed_phase(fx: Readonly<anim_fx_t>): number {
  return hash_unit(fx.motion_seed ^ 0x61c88647) * Math.PI * 2
}

function motion_phase(time: number, fx: Readonly<anim_fx_t>): number {
  const speed = clamp(fx.motion_rate, 0.25, 6) * 0.25
  return time * speed * Math.PI * 2 + motion_seed_phase(fx)
}

function motion_transform_phase(context: CanvasRenderingContext2D, w: number, h: number, phase: number, fx: Readonly<anim_fx_t>): void {
  if (fx.motion === motion_none || fx.motion_amount <= 0) return
  const amount = clamp(fx.motion_amount, 0, 24)
  const anchor_x = clamp(fx.motion_anchor_x, 0, 1) * w
  const anchor_y = clamp(fx.motion_anchor_y, 0, 1) * h
  let dx = 0
  let dy = 0
  let rotation = 0
  let scale_x = 1
  let scale_y = 1
  if (fx.motion === motion_breathe) {
    const scale = 1 + Math.sin(phase) * amount * 0.004
    scale_x = scale
    scale_y = 1 + Math.sin(phase) * amount * 0.006
    dy = -Math.sin(phase) * amount * 0.16
  } else if (fx.motion === motion_sway) {
    rotation = Math.sin(phase) * amount * 0.007
    dx = Math.sin(phase) * amount * 0.15
  } else if (fx.motion === motion_float) {
    dx = Math.sin(phase) * amount
    dy = Math.cos(phase) * amount * 0.72
    rotation = Math.sin(phase * 2) * amount * 0.0018
  } else if (fx.motion === motion_bounce) {
    dy = -Math.abs(Math.sin(phase)) * amount * 1.8
    const squash = Math.max(0, -Math.cos(phase)) * amount * 0.003
    scale_x = 1 + squash
    scale_y = 1 - squash
  } else if (fx.motion === motion_camera) {
    const seed_phase = hash_unit(fx.motion_seed ^ 0x243f6a88) * Math.PI * 2
    dx = (Math.sin(phase + seed_phase) + Math.sin(phase * 2) * 0.35) * amount * 0.55
    dy = (Math.cos(phase + seed_phase) + Math.sin(phase * 3) * 0.35) * amount * 0.45
    rotation = Math.sin(phase * 2 + seed_phase) * amount * 0.0025
  }
  context.translate(anchor_x + dx, anchor_y + dy)
  context.rotate(rotation)
  context.scale(scale_x, scale_y)
  context.translate(-anchor_x, -anchor_y)
}

function smooth_mix(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function wiggle_grid_get(w: number, h: number, cell: number): wiggle_grid_t {
  for (let index = wiggle_grid_cache.length - 1; index >= 0; index--) {
    const entry = wiggle_grid_cache[index]
    if (entry.w !== w || entry.h !== h || entry.cell !== cell) continue
    wiggle_grid_cache.splice(index, 1)
    wiggle_grid_cache.push(entry)
    return entry
  }
  const columns = Math.max(1, Math.ceil(w / cell))
  const rows = Math.max(1, Math.ceil(h / cell))
  const stride = columns + 1
  const x_cell = new Uint16Array(w)
  const x_mix = new Float32Array(w)
  const y_cell = new Uint16Array(h)
  const y_mix = new Float32Array(h)
  for (let x = 0; x < w; x++) {
    const column = Math.min(columns - 1, Math.floor(x / cell))
    const start = column * cell
    const end = column === columns - 1 ? w : Math.min(w, start + cell)
    x_cell[x] = column
    x_mix[x] = smooth_mix((x + 0.5 - start) / Math.max(1, end - start))
  }
  for (let y = 0; y < h; y++) {
    const row = Math.min(rows - 1, Math.floor(y / cell))
    const start = row * cell
    const end = row === rows - 1 ? h : Math.min(h, start + cell)
    y_cell[y] = row
    y_mix[y] = smooth_mix((y + 0.5 - start) / Math.max(1, end - start))
  }
  const grid = { w, h, cell, columns, rows, stride, x_cell, x_mix, y_cell, y_mix }
  wiggle_grid_cache.push(grid)
  effect_trim(wiggle_grid_cache, entry => entry.x_cell.byteLength + entry.x_mix.byteLength + entry.y_cell.byteLength + entry.y_mix.byteLength, 0.06)
  return grid
}

function wiggle_field_get(w: number, h: number, cell: number, amount: number, phase: number, seed: number): wiggle_field_t {
  for (let index = wiggle_field_cache.length - 1; index >= 0; index--) {
    const entry = wiggle_field_cache[index]
    if (entry.grid.w !== w || entry.grid.h !== h || entry.grid.cell !== cell || entry.amount !== amount || entry.phase !== phase || entry.seed !== seed) continue
    wiggle_field_cache.splice(index, 1)
    wiggle_field_cache.push(entry)
    return entry
  }
  const grid = wiggle_grid_get(w, h, cell)
  const count = (grid.columns + 1) * (grid.rows + 1)
  const dx = new Float32Array(count)
  const dy = new Float32Array(count)
  for (let row = 0; row <= grid.rows; row++) {
    for (let column = 0; column <= grid.columns; column++) {
      const index = row * grid.stride + column
      if (column === 0 || row === 0 || column === grid.columns || row === grid.rows) continue
      dx[index] = wiggle_offset(seed, phase, column, row, 0, amount)
      dy[index] = wiggle_offset(seed, phase, column, row, 1, amount)
    }
  }
  const field = { grid, amount, phase, seed, dx, dy }
  wiggle_field_cache.push(field)
  effect_trim(wiggle_field_cache, entry => entry.dx.byteLength + entry.dy.byteLength, 0.22)
  return field
}

function wiggle_pixels_get(source: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  for (let index = wiggle_pixel_cache.length - 1; index >= 0; index--) {
    const entry = wiggle_pixel_cache[index]
    if (entry.source !== source || entry.w !== w || entry.h !== h) continue
    wiggle_pixel_cache.splice(index, 1)
    wiggle_pixel_cache.push(entry)
    return entry.data
  }
  const [, context] = canvas_make(w, h, 1)
  context.clearRect(0, 0, w, h)
  context.drawImage(source, 0, 0, w, h)
  const data = context.getImageData(0, 0, w, h).data
  wiggle_pixel_cache.push({ source, w, h, data })
  effect_trim(wiggle_pixel_cache, entry => entry.data.byteLength, 0.24)
  return data
}

export function wiggle_render(source: Uint8ClampedArray, field: wiggle_field_t): HTMLCanvasElement {
  const grid = field.grid
  const w = grid.w
  const h = grid.h
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const row = grid.y_cell[y]
    const ty = grid.y_mix[y]
    const top = row * grid.stride
    const bottom = top + grid.stride
    for (let x = 0; x < w; x++) {
      const column = grid.x_cell[x]
      const tx = grid.x_mix[x]
      const dxt = field.dx[top + column] + (field.dx[top + column + 1] - field.dx[top + column]) * tx
      const dxb = field.dx[bottom + column] + (field.dx[bottom + column + 1] - field.dx[bottom + column]) * tx
      const dyt = field.dy[top + column] + (field.dy[top + column + 1] - field.dy[top + column]) * tx
      const dyb = field.dy[bottom + column] + (field.dy[bottom + column + 1] - field.dy[bottom + column]) * tx
      const sx = clamp(x - dxt - (dxb - dxt) * ty, 0, w - 1)
      const sy = clamp(y - dyt - (dyb - dyt) * ty, 0, h - 1)
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const x1 = Math.min(w - 1, x0 + 1)
      const y1 = Math.min(h - 1, y0 + 1)
      const fx = sx - x0
      const fy = sy - y0
      const w00 = (1 - fx) * (1 - fy)
      const w10 = fx * (1 - fy)
      const w01 = (1 - fx) * fy
      const w11 = fx * fy
      const i00 = (y0 * w + x0) * 4
      const i10 = (y0 * w + x1) * 4
      const i01 = (y1 * w + x0) * 4
      const i11 = (y1 * w + x1) * 4
      const a00 = source[i00 + 3]
      const a10 = source[i10 + 3]
      const a01 = source[i01 + 3]
      const a11 = source[i11 + 3]
      const p00 = a00 * w00
      const p10 = a10 * w10
      const p01 = a01 * w01
      const p11 = a11 * w11
      const alpha = p00 + p10 + p01 + p11
      const oi = (y * w + x) * 4
      if (alpha < 0.5) continue
      out[oi] = (source[i00] * p00 + source[i10] * p10 + source[i01] * p01 + source[i11] * p11) / alpha
      out[oi + 1] = (source[i00 + 1] * p00 + source[i10 + 1] * p10 + source[i01 + 1] * p01 + source[i11 + 1] * p11) / alpha
      out[oi + 2] = (source[i00 + 2] * p00 + source[i10 + 2] * p10 + source[i01 + 2] * p01 + source[i11 + 2] * p11) / alpha
      out[oi + 3] = Math.max(alpha, Math.max(a00, a10, a01, a11) * 0.58)
    }
  }
  const [canvas, context] = canvas_make(w, h)
  context.putImageData(new ImageData(out, w, h), 0, 0)
  return canvas
}

function wiggle_image_get(source: CanvasImageSource, field: wiggle_field_t): HTMLCanvasElement {
  for (let index = wiggle_image_cache.length - 1; index >= 0; index--) {
    const entry = wiggle_image_cache[index]
    if (entry.source !== source || entry.field.grid.w !== field.grid.w || entry.field.grid.h !== field.grid.h || entry.field.grid.cell !== field.grid.cell || entry.field.amount !== field.amount || entry.field.phase !== field.phase || entry.field.seed !== field.seed) continue
    wiggle_image_cache.splice(index, 1)
    wiggle_image_cache.push(entry)
    return entry.canvas
  }
  const canvas = wiggle_render(wiggle_pixels_get(source, field.grid.w, field.grid.h), field)
  wiggle_image_cache.push({ source, field, canvas })
  effect_trim(wiggle_image_cache, entry => entry.canvas.width * entry.canvas.height * 4, 0.24)
  return canvas
}

function wiggle_draw_phase(source: CanvasImageSource, context: CanvasRenderingContext2D, w: number, h: number, phase_value: number, fx: Readonly<anim_fx_t>, seed_offset: number): void {
  if (!fx.wiggle || fx.wiggle_amount <= 0) {
    context.drawImage(source, 0, 0, w, h)
    return
  }
  const g = st()
  const scale = Math.min(w / g.doc.w, h / g.doc.h)
  const cell = clamp(Math.round(fx.wiggle_cell * scale), 6, 192)
  const requested = clamp(fx.wiggle_amount * scale, 0, 16)
  const amount = Math.round(Math.min(requested, cell * 0.2) * 16) / 16
  if (amount < 0.0625) {
    context.drawImage(source, 0, 0, w, h)
    return
  }
  const phases = clamp(Math.round(fx.wiggle_phases), 2, 12)
  const phase = ((Math.floor(phase_value) % phases) + phases) % phases
  const field = wiggle_field_get(w, h, cell, amount, phase, fx.wiggle_seed ^ seed_offset)
  context.drawImage(gpu_wiggle(source, field) || wiggle_image_get(source, field), 0, 0, w, h)
}

export function animfx_active(fx: Readonly<anim_fx_t> = st().doc.anim): number {
  if (fx.wiggle && fx.wiggle_amount > 0) return 1
  if (fx.motion !== motion_none && fx.motion_amount > 0) return 1
  return 0
}

export type anim_fx_loop_t = {
  ticks: number
  wiggle_cycles: number
  motion_cycles: number
}

export function animfx_loop_plan(fps_value: number, fx: Readonly<anim_fx_t>): anim_fx_loop_t {
  const fps = clamp(fps_value, 0.2, 30)
  const wiggle = fx.wiggle && fx.wiggle_amount > 0 ? 1 : 0
  const motion = fx.motion !== motion_none && fx.motion_amount > 0 ? 1 : 0
  if (!wiggle && !motion) return { ticks: 1, wiggle_cycles: 0, motion_cycles: 0 }
  const phases = clamp(Math.round(fx.wiggle_phases), 2, 12)
  const wiggle_period = wiggle ? phases / clamp(fx.wiggle_rate, 1, 24) : 0
  const motion_period = motion ? 4 / clamp(fx.motion_rate, 0.25, 6) : 0
  const duration = Math.max(wiggle_period, motion_period, 2 / fps)
  let wiggle_cycles = wiggle ? Math.max(1, Math.round(duration / wiggle_period)) : 0
  let motion_cycles = motion ? Math.max(1, Math.round(duration / motion_period)) : 0
  let ticks = Math.max(2, Math.round(duration * fps))
  if (wiggle) ticks = Math.max(ticks, wiggle_cycles * phases)
  if (motion) ticks = Math.max(ticks, motion_cycles * 8)
  if (ticks > 96) {
    ticks = 96
    if (wiggle) wiggle_cycles = clamp(wiggle_cycles, 1, Math.max(1, Math.floor(ticks / phases)))
    if (motion) motion_cycles = clamp(motion_cycles, 1, Math.max(1, Math.floor(ticks / 8)))
  }
  return { ticks, wiggle_cycles, motion_cycles }
}

export function animfx_time_for_tick(tick: number, fps: number): number {
  return Math.max(0, tick) / Math.max(0.2, fps)
}

export function animfx_draw_source(source: CanvasImageSource, context: CanvasRenderingContext2D, w: number, h: number, time: number, fx: Readonly<anim_fx_t>, seed_offset = 0): void {
  const rate = clamp(fx.wiggle_rate, 1, 24)
  context.save()
  motion_transform_phase(context, w, h, motion_phase(time, fx), fx)
  wiggle_draw_phase(source, context, w, h, Math.floor(time * rate), fx, seed_offset)
  context.restore()
}

export function animfx_draw_cycle(source: CanvasImageSource, context: CanvasRenderingContext2D, w: number, h: number, cycle_value: number, fx: Readonly<anim_fx_t>, seed_offset = 0, loop: Readonly<anim_fx_loop_t> = { ticks: 1, wiggle_cycles: 1, motion_cycles: 1 }): void {
  const cycle = cycle_value - Math.floor(cycle_value)
  const phases = clamp(Math.round(fx.wiggle_phases), 2, 12)
  context.save()
  motion_transform_phase(context, w, h, cycle * Math.PI * 2 * Math.max(1, loop.motion_cycles) + motion_seed_phase(fx), fx)
  wiggle_draw_phase(source, context, w, h, Math.floor(cycle * phases * Math.max(1, loop.wiggle_cycles)), fx, seed_offset)
  context.restore()
}

export function animfx_compose_cycle(frame_index: number, context: CanvasRenderingContext2D, w: number, h: number, with_paper: number, cycle: number, loop: Readonly<anim_fx_loop_t>, fx: Readonly<anim_fx_t> = st().doc.anim): void {
  if (!animfx_active(fx)) {
    doc_compose(frame_index, context, w, h, with_paper)
    return
  }
  const g = st()
  context.clearRect(0, 0, w, h)
  if (with_paper) {
    context.fillStyle = doc_frame_paper(frame_index)
    context.fillRect(0, 0, w, h)
  }
  context.imageSmoothingEnabled = w < g.doc.w
  const source = source_get(frame_index, w, h)
  animfx_draw_cycle(source, context, w, h, cycle, fx, g.doc.frames[frame_index].id, loop)
}

export function animfx_compose(frame_index: number, context: CanvasRenderingContext2D, w: number, h: number, with_paper: number, time: number, fx: Readonly<anim_fx_t> = st().doc.anim): void {
  if (!animfx_active(fx)) {
    doc_compose(frame_index, context, w, h, with_paper)
    return
  }
  const g = st()
  context.clearRect(0, 0, w, h)
  if (with_paper) {
    context.fillStyle = doc_frame_paper(frame_index)
    context.fillRect(0, 0, w, h)
  }
  context.imageSmoothingEnabled = w < g.doc.w
  const source = source_get(frame_index, w, h)
  animfx_draw_source(source, context, w, h, time, fx, g.doc.frames[frame_index].id)
}

export function animfx_cache_clear(): void {
  gpu_reset()
  source_cache.length = 0
  wiggle_grid_cache.length = 0
  wiggle_field_cache.length = 0
  wiggle_pixel_cache.length = 0
  wiggle_image_cache.length = 0
}

function driver_rate(fx: Readonly<anim_fx_t>): number {
  let rate = 0
  if (fx.wiggle && fx.wiggle_amount > 0) rate = Math.max(rate, clamp(fx.wiggle_rate, 1, 24))
  if (fx.motion !== motion_none && fx.motion_amount > 0) rate = Math.max(rate, clamp(fx.motion_rate * 4, 4, 24))
  return rate
}

function driver_step(now: number): void {
  const fx = st().doc.anim
  if (!driver_run || !animfx_active(fx)) {
    driver_raf = 0
    driver_bucket = -1
    return
  }
  const rate = driver_rate(fx)
  const bucket = Math.floor(now * rate / 1000)
  if (bucket !== driver_bucket) {
    driver_bucket = bucket
    dirty(d_stage)
  }
  driver_raf = requestAnimationFrame(driver_step)
}

export function animfx_driver_sync(run: number): void {
  driver_run = run && animfx_active() ? 1 : 0
  if (!driver_run) {
    if (driver_raf) cancelAnimationFrame(driver_raf)
    driver_raf = 0
    driver_bucket = -1
    return
  }
  if (!driver_raf) driver_raf = requestAnimationFrame(driver_step)
}
