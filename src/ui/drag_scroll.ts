import { pointer_capture } from '../dom'
import { drag_slop } from '../h'

// 横に並んだボタンの列を、マウス・ペンでもドラッグしてスライドできるようにする (指は標準のスクロールにまかせる)。
// スライドしたあとのクリックは止めて、ボタンが押されないようにする。
export function drag_scroll(el: HTMLElement): void {
  let pointer = -1
  let start_x = 0
  let start_left = 0
  let moved = 0
  el.addEventListener('pointerdown', e => {
    moved = 0
    if (e.pointerType === 'touch' || e.button !== 0) return
    pointer = e.pointerId
    start_x = e.clientX
    start_left = el.scrollLeft
  })
  el.addEventListener('pointermove', e => {
    if (e.pointerId !== pointer) return
    const dx = e.clientX - start_x
    if (!moved && Math.abs(dx) <= drag_slop) return
    if (!moved) {
      moved = 1
      pointer_capture(el, e.pointerId)
    }
    el.scrollLeft = start_left - dx
  })
  const end = (e: PointerEvent): void => {
    if (e.pointerId === pointer) pointer = -1
  }
  el.addEventListener('pointerup', end)
  el.addEventListener('pointercancel', end)
  el.addEventListener('click', e => {
    if (!moved) return
    moved = 0
    e.preventDefault()
    e.stopPropagation()
  }, true)
}
