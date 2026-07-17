import { doc_compose } from './doc'
import { D_STAGE, MOTION_BOUNCE, MOTION_BREATHE, MOTION_CAMERA, MOTION_FLOAT, MOTION_NONE, MOTION_SWAY, type AnimFx, type Rle } from './h'
import { canvas_make, clamp } from './lib'
import { dirty, st } from './state/store'

type SourceCache = {
  frameId: number
  refs: readonly (Rle | null)[]
  viewKey: string
  w: number
  h: number
  canvas: HTMLCanvasElement
}

type WiggleGrid = {
  w: number
  h: number
  cell: number
  columns: number
  rows: number
  stride: number
  xCell: Uint16Array
  xMix: Float32Array
  yCell: Uint16Array
  yMix: Float32Array
}

type WiggleField = {
  grid: WiggleGrid
  amount: number
  phase: number
  seed: number
  dx: Float32Array
  dy: Float32Array
}

type WigglePixels = {
  source: CanvasImageSource
  w: number
  h: number
  data: Uint8ClampedArray
}

type WiggleImage = {
  source: CanvasImageSource
  field: WiggleField
  canvas: HTMLCanvasElement
}

const sourceCache: SourceCache[] = []
const wiggleGridCache: WiggleGrid[] = []
const wiggleFieldCache: WiggleField[] = []
const wigglePixelCache: WigglePixels[] = []
const wiggleImageCache: WiggleImage[] = []
let driverRaf = 0
let driverBucket = -1
let driverRun = 0

function refs_same(a: readonly (Rle | null)[], b: readonly (Rle | null)[]): number {
  if (a.length !== b.length) return 0
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return 0
  return 1
}

function source_view_key(): string {
  const g = st()
  return g.doc.mode + '|' + g.doc.lvis.join(',') + '|' + g.doc.lalpha.join(',') + '|' + g.doc.lord.join(',')
}

function source_cache_cap(w: number, h: number): number {
  const g = st()
  const bytes = Math.max(1, w * h * 4)
  const budget = g.mobile ? 18 << 20 : 48 << 20
  return clamp(Math.floor(budget / bytes), 4, g.mobile ? 16 : 32)
}

function source_get(frameIndex: number, w: number, h: number): HTMLCanvasElement {
  const g = st()
  const frame = g.doc.frames[frameIndex]
  const key = source_view_key()
  for (let index = sourceCache.length - 1; index >= 0; index--) {
    const entry = sourceCache[index]
    if (entry.frameId !== frame.id || entry.w !== w || entry.h !== h || entry.viewKey !== key || !refs_same(entry.refs, frame.pk)) continue
    sourceCache.splice(index, 1)
    sourceCache.push(entry)
    return entry.canvas
  }
  const [canvas, context] = canvas_make(w, h, 1)
  doc_compose(frameIndex, context, w, h, 0)
  sourceCache.push({ frameId: frame.id, refs: [...frame.pk], viewKey: key, w, h, canvas })
  const cap = source_cache_cap(w, h)
  while (sourceCache.length > cap) sourceCache.shift()
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

function motion_seed_phase(fx: Readonly<AnimFx>): number {
  return hash_unit(fx.motionSeed ^ 0x61c88647) * Math.PI * 2
}

function motion_phase(time: number, fx: Readonly<AnimFx>): number {
  const speed = clamp(fx.motionRate, 0.25, 6) * 0.25
  return time * speed * Math.PI * 2 + motion_seed_phase(fx)
}

function motion_transform_phase(context: CanvasRenderingContext2D, w: number, h: number, phase: number, fx: Readonly<AnimFx>): void {
  if (fx.motion === MOTION_NONE || fx.motionAmount <= 0) return
  const amount = clamp(fx.motionAmount, 0, 24)
  const anchorX = clamp(fx.motionAnchorX, 0, 1) * w
  const anchorY = clamp(fx.motionAnchorY, 0, 1) * h
  let dx = 0
  let dy = 0
  let rotation = 0
  let scaleX = 1
  let scaleY = 1
  if (fx.motion === MOTION_BREATHE) {
    const scale = 1 + Math.sin(phase) * amount * 0.004
    scaleX = scale
    scaleY = 1 + Math.sin(phase) * amount * 0.006
    dy = -Math.sin(phase) * amount * 0.16
  } else if (fx.motion === MOTION_SWAY) {
    rotation = Math.sin(phase) * amount * 0.007
    dx = Math.sin(phase) * amount * 0.15
  } else if (fx.motion === MOTION_FLOAT) {
    dx = Math.sin(phase) * amount
    dy = Math.cos(phase) * amount * 0.72
    rotation = Math.sin(phase * 2) * amount * 0.0018
  } else if (fx.motion === MOTION_BOUNCE) {
    dy = -Math.abs(Math.sin(phase)) * amount * 1.8
    const squash = Math.max(0, -Math.cos(phase)) * amount * 0.003
    scaleX = 1 + squash
    scaleY = 1 - squash
  } else if (fx.motion === MOTION_CAMERA) {
    const seedPhase = hash_unit(fx.motionSeed ^ 0x243f6a88) * Math.PI * 2
    dx = (Math.sin(phase + seedPhase) + Math.sin(phase * 2) * 0.35) * amount * 0.55
    dy = (Math.cos(phase + seedPhase) + Math.sin(phase * 3) * 0.35) * amount * 0.45
    rotation = Math.sin(phase * 2 + seedPhase) * amount * 0.0025
  }
  context.translate(anchorX + dx, anchorY + dy)
  context.rotate(rotation)
  context.scale(scaleX, scaleY)
  context.translate(-anchorX, -anchorY)
}

function smooth_mix(value: number): number {
  const t = clamp(value, 0, 1)
  return t * t * (3 - 2 * t)
}

function wiggle_grid_get(w: number, h: number, cell: number): WiggleGrid {
  for (let index = wiggleGridCache.length - 1; index >= 0; index--) {
    const entry = wiggleGridCache[index]
    if (entry.w !== w || entry.h !== h || entry.cell !== cell) continue
    wiggleGridCache.splice(index, 1)
    wiggleGridCache.push(entry)
    return entry
  }
  const columns = Math.max(1, Math.ceil(w / cell))
  const rows = Math.max(1, Math.ceil(h / cell))
  const stride = columns + 1
  const xCell = new Uint16Array(w)
  const xMix = new Float32Array(w)
  const yCell = new Uint16Array(h)
  const yMix = new Float32Array(h)
  for (let x = 0; x < w; x++) {
    const column = Math.min(columns - 1, Math.floor(x / cell))
    const start = column * cell
    const end = column === columns - 1 ? w : Math.min(w, start + cell)
    xCell[x] = column
    xMix[x] = smooth_mix((x + 0.5 - start) / Math.max(1, end - start))
  }
  for (let y = 0; y < h; y++) {
    const row = Math.min(rows - 1, Math.floor(y / cell))
    const start = row * cell
    const end = row === rows - 1 ? h : Math.min(h, start + cell)
    yCell[y] = row
    yMix[y] = smooth_mix((y + 0.5 - start) / Math.max(1, end - start))
  }
  const grid = { w, h, cell, columns, rows, stride, xCell, xMix, yCell, yMix }
  wiggleGridCache.push(grid)
  const cap = st().mobile ? 8 : 16
  while (wiggleGridCache.length > cap) wiggleGridCache.shift()
  return grid
}

function wiggle_field_get(w: number, h: number, cell: number, amount: number, phase: number, seed: number): WiggleField {
  for (let index = wiggleFieldCache.length - 1; index >= 0; index--) {
    const entry = wiggleFieldCache[index]
    if (entry.grid.w !== w || entry.grid.h !== h || entry.grid.cell !== cell || entry.amount !== amount || entry.phase !== phase || entry.seed !== seed) continue
    wiggleFieldCache.splice(index, 1)
    wiggleFieldCache.push(entry)
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
  wiggleFieldCache.push(field)
  const cap = st().mobile ? 48 : 144
  while (wiggleFieldCache.length > cap) wiggleFieldCache.shift()
  return field
}

function wiggle_pixel_trim(): void {
  const budget = st().mobile ? 8 << 20 : 24 << 20
  let bytes = 0
  for (const entry of wigglePixelCache) bytes += entry.data.byteLength
  while (bytes > budget && wigglePixelCache.length > 1) {
    const entry = wigglePixelCache.shift()
    if (entry) bytes -= entry.data.byteLength
  }
}

function wiggle_pixels_get(source: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  for (let index = wigglePixelCache.length - 1; index >= 0; index--) {
    const entry = wigglePixelCache[index]
    if (entry.source !== source || entry.w !== w || entry.h !== h) continue
    wigglePixelCache.splice(index, 1)
    wigglePixelCache.push(entry)
    return entry.data
  }
  const [, context] = canvas_make(w, h, 1)
  context.clearRect(0, 0, w, h)
  context.drawImage(source, 0, 0, w, h)
  const data = context.getImageData(0, 0, w, h).data
  wigglePixelCache.push({ source, w, h, data })
  wiggle_pixel_trim()
  return data
}

function wiggle_image_trim(): void {
  const budget = st().mobile ? 14 << 20 : 56 << 20
  let bytes = 0
  for (const entry of wiggleImageCache) bytes += entry.canvas.width * entry.canvas.height * 4
  while (bytes > budget && wiggleImageCache.length > 2) {
    const entry = wiggleImageCache.shift()
    if (entry) bytes -= entry.canvas.width * entry.canvas.height * 4
  }
}

function wiggle_render(source: Uint8ClampedArray, field: WiggleField): HTMLCanvasElement {
  const grid = field.grid
  const w = grid.w
  const h = grid.h
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++) {
    const row = grid.yCell[y]
    const ty = grid.yMix[y]
    const top = row * grid.stride
    const bottom = top + grid.stride
    for (let x = 0; x < w; x++) {
      const column = grid.xCell[x]
      const tx = grid.xMix[x]
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

function wiggle_image_get(source: CanvasImageSource, field: WiggleField): HTMLCanvasElement {
  for (let index = wiggleImageCache.length - 1; index >= 0; index--) {
    const entry = wiggleImageCache[index]
    if (entry.source !== source || entry.field.grid.w !== field.grid.w || entry.field.grid.h !== field.grid.h || entry.field.grid.cell !== field.grid.cell || entry.field.amount !== field.amount || entry.field.phase !== field.phase || entry.field.seed !== field.seed) continue
    wiggleImageCache.splice(index, 1)
    wiggleImageCache.push(entry)
    return entry.canvas
  }
  const canvas = wiggle_render(wiggle_pixels_get(source, field.grid.w, field.grid.h), field)
  wiggleImageCache.push({ source, field, canvas })
  wiggle_image_trim()
  return canvas
}

function wiggle_draw_phase(source: CanvasImageSource, context: CanvasRenderingContext2D, w: number, h: number, phaseValue: number, fx: Readonly<AnimFx>, seedOffset: number): void {
  if (!fx.wiggle || fx.wiggleAmount <= 0) {
    context.drawImage(source, 0, 0, w, h)
    return
  }
  const g = st()
  const scale = Math.min(w / g.doc.w, h / g.doc.h)
  const cell = clamp(Math.round(fx.wiggleCell * scale), 6, 192)
  const requested = clamp(fx.wiggleAmount * scale, 0, 16)
  const amount = Math.round(Math.min(requested, cell * 0.2) * 16) / 16
  if (amount < 0.0625) {
    context.drawImage(source, 0, 0, w, h)
    return
  }
  const phases = clamp(Math.round(fx.wigglePhases), 2, 12)
  const phase = ((Math.floor(phaseValue) % phases) + phases) % phases
  const field = wiggle_field_get(w, h, cell, amount, phase, fx.wiggleSeed ^ seedOffset)
  context.drawImage(wiggle_image_get(source, field), 0, 0, w, h)
}

export function animfx_active(fx: Readonly<AnimFx> = st().doc.anim): number {
  if (fx.wiggle && fx.wiggleAmount > 0) return 1
  if (fx.motion !== MOTION_NONE && fx.motionAmount > 0) return 1
  return 0
}

export type AnimFxLoop = {
  ticks: number
  wiggleCycles: number
  motionCycles: number
}

export function animfx_loop_plan(fpsValue: number, fx: Readonly<AnimFx>): AnimFxLoop {
  const fps = clamp(fpsValue, 0.5, 30)
  const wiggle = fx.wiggle && fx.wiggleAmount > 0 ? 1 : 0
  const motion = fx.motion !== MOTION_NONE && fx.motionAmount > 0 ? 1 : 0
  if (!wiggle && !motion) return { ticks: 1, wiggleCycles: 0, motionCycles: 0 }
  const phases = clamp(Math.round(fx.wigglePhases), 2, 12)
  const wigglePeriod = wiggle ? phases / clamp(fx.wiggleRate, 1, 24) : 0
  const motionPeriod = motion ? 4 / clamp(fx.motionRate, 0.25, 6) : 0
  const duration = Math.max(wigglePeriod, motionPeriod, 2 / fps)
  let wiggleCycles = wiggle ? Math.max(1, Math.round(duration / wigglePeriod)) : 0
  let motionCycles = motion ? Math.max(1, Math.round(duration / motionPeriod)) : 0
  let ticks = Math.max(2, Math.round(duration * fps))
  if (wiggle) ticks = Math.max(ticks, wiggleCycles * phases)
  if (motion) ticks = Math.max(ticks, motionCycles * 8)
  if (ticks > 96) {
    ticks = 96
    if (wiggle) wiggleCycles = clamp(wiggleCycles, 1, Math.max(1, Math.floor(ticks / phases)))
    if (motion) motionCycles = clamp(motionCycles, 1, Math.max(1, Math.floor(ticks / 8)))
  }
  return { ticks, wiggleCycles, motionCycles }
}

export function animfx_time_for_tick(tick: number, fps: number): number {
  return Math.max(0, tick) / Math.max(0.5, fps)
}

export function animfx_draw_source(source: CanvasImageSource, context: CanvasRenderingContext2D, w: number, h: number, time: number, fx: Readonly<AnimFx>, seedOffset = 0): void {
  const rate = clamp(fx.wiggleRate, 1, 24)
  context.save()
  motion_transform_phase(context, w, h, motion_phase(time, fx), fx)
  wiggle_draw_phase(source, context, w, h, Math.floor(time * rate), fx, seedOffset)
  context.restore()
}

export function animfx_draw_cycle(source: CanvasImageSource, context: CanvasRenderingContext2D, w: number, h: number, cycleValue: number, fx: Readonly<AnimFx>, seedOffset = 0, loop: Readonly<AnimFxLoop> = { ticks: 1, wiggleCycles: 1, motionCycles: 1 }): void {
  const cycle = cycleValue - Math.floor(cycleValue)
  const phases = clamp(Math.round(fx.wigglePhases), 2, 12)
  context.save()
  motion_transform_phase(context, w, h, cycle * Math.PI * 2 * Math.max(1, loop.motionCycles) + motion_seed_phase(fx), fx)
  wiggle_draw_phase(source, context, w, h, Math.floor(cycle * phases * Math.max(1, loop.wiggleCycles)), fx, seedOffset)
  context.restore()
}

export function animfx_compose_cycle(frameIndex: number, context: CanvasRenderingContext2D, w: number, h: number, withPaper: number, cycle: number, loop: Readonly<AnimFxLoop>, fx: Readonly<AnimFx> = st().doc.anim): void {
  if (!animfx_active(fx)) {
    doc_compose(frameIndex, context, w, h, withPaper)
    return
  }
  const g = st()
  if (withPaper) {
    context.fillStyle = g.doc.paper
    context.fillRect(0, 0, w, h)
  } else {
    context.clearRect(0, 0, w, h)
  }
  context.imageSmoothingEnabled = w < g.doc.w
  const source = source_get(frameIndex, w, h)
  animfx_draw_cycle(source, context, w, h, cycle, fx, g.doc.frames[frameIndex].id, loop)
}

export function animfx_compose(frameIndex: number, context: CanvasRenderingContext2D, w: number, h: number, withPaper: number, time: number, fx: Readonly<AnimFx> = st().doc.anim): void {
  if (!animfx_active(fx)) {
    doc_compose(frameIndex, context, w, h, withPaper)
    return
  }
  const g = st()
  if (withPaper) {
    context.fillStyle = g.doc.paper
    context.fillRect(0, 0, w, h)
  } else {
    context.clearRect(0, 0, w, h)
  }
  context.imageSmoothingEnabled = w < g.doc.w
  const source = source_get(frameIndex, w, h)
  animfx_draw_source(source, context, w, h, time, fx, g.doc.frames[frameIndex].id)
}

export function animfx_cache_clear(): void {
  sourceCache.length = 0
  wiggleGridCache.length = 0
  wiggleFieldCache.length = 0
  wigglePixelCache.length = 0
  wiggleImageCache.length = 0
}

function driver_rate(fx: Readonly<AnimFx>): number {
  let rate = 0
  if (fx.wiggle && fx.wiggleAmount > 0) rate = Math.max(rate, clamp(fx.wiggleRate, 1, 24))
  if (fx.motion !== MOTION_NONE && fx.motionAmount > 0) rate = Math.max(rate, clamp(fx.motionRate * 4, 4, 24))
  return rate
}

function driver_step(now: number): void {
  const fx = st().doc.anim
  if (!driverRun || !animfx_active(fx)) {
    driverRaf = 0
    driverBucket = -1
    return
  }
  const rate = driver_rate(fx)
  const bucket = Math.floor(now * rate / 1000)
  if (bucket !== driverBucket) {
    driverBucket = bucket
    dirty(D_STAGE)
  }
  driverRaf = requestAnimationFrame(driver_step)
}

export function animfx_driver_sync(run: number): void {
  driverRun = run && animfx_active() ? 1 : 0
  if (!driverRun) {
    if (driverRaf) cancelAnimationFrame(driverRaf)
    driverRaf = 0
    driverBucket = -1
    return
  }
  if (!driverRaf) driverRaf = requestAnimationFrame(driver_step)
}
