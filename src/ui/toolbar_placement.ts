export type toolbar_rect_t = { x: number, y: number, w: number, h: number }
export type toolbar_point_t = { x: number, y: number }

export function toolbar_place(bounds: toolbar_rect_t, width: number, height: number, preferred: toolbar_point_t, obstacles: toolbar_rect_t[]): toolbar_point_t {
  const right = Math.max(bounds.x, bounds.x + bounds.w - width)
  const bottom = Math.max(bounds.y, bounds.y + bounds.h - height)
  const limit_x = (x: number): number => Math.max(bounds.x, Math.min(right, x))
  const limit_y = (y: number): number => Math.max(bounds.y, Math.min(bottom, y))
  const xs = [limit_x(preferred.x), bounds.x, right]
  const ys = [limit_y(preferred.y), bounds.y, bottom]
  for (const r of obstacles) {
    xs.push(limit_x(r.x - width - 8), limit_x(r.x + r.w + 8))
    ys.push(limit_y(r.y - height - 8), limit_y(r.y + r.h + 8))
  }
  let best = { x: xs[0], y: ys[0] }
  let best_area = Infinity
  let best_distance = Infinity
  for (const y of ys) for (const x of xs) {
    let area = 0
    for (const r of obstacles) {
      const w = Math.max(0, Math.min(x + width, r.x + r.w + 8) - Math.max(x, r.x - 8))
      const h = Math.max(0, Math.min(y + height, r.y + r.h + 8) - Math.max(y, r.y - 8))
      area += w * h
    }
    const distance = (x - preferred.x) ** 2 + (y - preferred.y) ** 2
    if (area > best_area || area === best_area && distance >= best_distance) continue
    best = { x, y }
    best_area = area
    best_distance = distance
  }
  return best
}
