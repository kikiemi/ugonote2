import { q } from '../dom'
import { clamp } from '../lib'
import { flo_render, transform_frame_draw } from '../sel'
import { st } from '../state/store'
import { tf_begin, tf_cancel, tf_commit, tf_preview } from '../tool'

// コマ全体をうごかす (「うごかす」の画面を開いているあいだ)。
// 紙の上をドラッグで移動、角のつまみで拡大・縮小、上の丸いつまみで回転、2本指でひろげる・ひねる、ホイールで拡大・縮小。

type pose_t = { dx: number, dy: number, deg: number, scale: number }
type point_t = [number, number]

const scale_min = 0.05
const scale_max = 8

let on = 0
let layer = -1
let frame: unknown = null
let pose: pose_t = { dx: 0, dy: 0, deg: 0, scale: 1 }
let drag: { kind: 'move' | 'scale' | 'rotate', at: point_t, from: pose_t } | null = null
let pinch: { mid: point_t, dist: number, angle: number, from: pose_t } | null = null

export function frame_move_on(): number {
  return on
}

// layer が -1 のときは、すべてのレイヤーをいっしょにうごかす。
export function frame_move_start(target: number): void {
  frame_move_cancel()
  tf_begin(target)
  on = 1
  layer = target
  frame = st().doc.frames[st().doc.cur]
  pose = { dx: 0, dy: 0, deg: 0, scale: 1 }
  apply()
}

export function frame_move_target(target: number): void {
  if (on && target !== layer) frame_move_start(target)
}

export function frame_move_commit(): void {
  if (!on) return
  if (same_frame()) tf_commit()
  else tf_cancel(0)
  end()
}

export function frame_move_cancel(): void {
  if (!on) return
  tf_cancel(same_frame() ? 1 : 0)
  end()
}

export function frame_move_turn(deg: number): void {
  pose.deg += deg
  apply()
}

export function frame_move_reset(): void {
  pose = { dx: 0, dy: 0, deg: 0, scale: 1 }
  apply()
}

export function frame_move_nudge(dx: number, dy: number): void {
  pose.dx += dx
  pose.dy += dy
  apply()
}

export function frame_move_wheel(factor: number): void {
  pose.scale = clamp(pose.scale * factor, scale_min, scale_max)
  apply()
}

// 1本の指・マウスでつまむ。つまみの上なら拡大・縮小か回転、それ以外は移動。
export function frame_move_down(bx: number, by: number): void {
  pinch = null
  drag = { kind: hit(bx, by), at: [bx, by], from: { ...pose } }
}

export function frame_move_drag(bx: number, by: number, snap: boolean): void {
  if (!drag) return
  const [cx, cy] = center(drag.from)
  const [ax, ay] = drag.at
  if (drag.kind === 'move') {
    pose.dx = drag.from.dx + bx - ax
    pose.dy = drag.from.dy + by - ay
  } else if (drag.kind === 'scale') {
    pose.scale = clamp(drag.from.scale * Math.hypot(bx - cx, by - cy) / Math.max(1, Math.hypot(ax - cx, ay - cy)), scale_min, scale_max)
  } else {
    const deg = drag.from.deg + (Math.atan2(by - cy, bx - cx) - Math.atan2(ay - cy, ax - cx)) * 180 / Math.PI
    pose.deg = snap ? Math.round(deg / 15) * 15 : deg
  }
  apply()
}

// 2本指。はじめに begin で今の形をおぼえ、そこからのひろがり・ひねり・ずれを足す。
export function frame_move_pinch(a: point_t, b: point_t, begin: boolean): void {
  const mid: point_t = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
  const dist = Math.max(8, Math.hypot(b[0] - a[0], b[1] - a[1]))
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0])
  if (begin || !pinch) {
    drag = null
    pinch = { mid, dist, angle, from: { ...pose } }
    return
  }
  pose.scale = clamp(pinch.from.scale * dist / pinch.dist, scale_min, scale_max)
  pose.deg = pinch.from.deg + (angle - pinch.angle) * 180 / Math.PI
  pose.dx = pinch.from.dx + mid[0] - pinch.mid[0]
  pose.dy = pinch.from.dy + mid[1] - pinch.mid[1]
  apply()
}

export function frame_move_release(): void {
  drag = null
  pinch = null
}

function same_frame(): boolean {
  return st().doc.frames[st().doc.cur] === frame
}

function end(): void {
  on = 0
  drag = null
  pinch = null
  frame = null
  flo_render()
}

function center(p: pose_t): point_t {
  const g = st()
  return [g.doc.w / 2 + p.dx, g.doc.h / 2 + p.dy]
}

// 紙の四すみと、回転のつまみ。
function frame_shape(): { corners: number[], rotate: point_t } {
  const g = st()
  const [cx, cy] = center(pose)
  const hw = (g.doc.w / 2) * pose.scale
  const hh = (g.doc.h / 2) * pose.scale
  const r = (pose.deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const at = (lx: number, ly: number): point_t => [cx + lx * c - ly * s, cy + lx * s + ly * c]
  const corners = [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)].flat()
  return { corners, rotate: at(0, -hh - 30 / g.view.z) }
}

function hit(bx: number, by: number): 'move' | 'scale' | 'rotate' {
  const tol = 14 / st().view.z
  const { corners, rotate } = frame_shape()
  if (Math.hypot(bx - rotate[0], by - rotate[1]) <= tol) return 'rotate'
  for (let i = 0; i < 8; i += 2) if (Math.abs(bx - corners[i]) <= tol && Math.abs(by - corners[i + 1]) <= tol) return 'scale'
  return 'move'
}

function apply(): void {
  if (!on) return
  if (!same_frame()) {
    frame_move_cancel()
    return
  }
  tf_preview(pose.scale, pose.dx, pose.dy, pose.deg)
  const g = st()
  const cv = q<HTMLCanvasElement>('flo_cv')
  const x = cv.getContext('2d') as CanvasRenderingContext2D
  x.clearRect(0, 0, cv.width, cv.height)
  const { corners, rotate } = frame_shape()
  transform_frame_draw(x, corners, corners, rotate, g.view.z)
  const deg = ((Math.round(pose.deg) % 360) + 540) % 360 - 180
  q('tf_info').textContent = deg + '°・' + Math.round(pose.scale * 100) + '%'
}
