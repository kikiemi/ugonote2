// AI の重みを読みこむ (画面の側で使う)。1つのファイルにまとめた版では、ページに入れてある。

import { app_asset } from '../runtime'

let weights: Promise<ArrayBuffer | null> | null = null

async function weights_load(): Promise<ArrayBuffer | null> {
  const inline = (globalThis as { __ug2_ai_motion?: string }).__ug2_ai_motion
  if (inline) return Uint8Array.from(atob(inline), c => c.charCodeAt(0)).buffer
  return fetch(app_asset('assets/ai/motion-v426.bin')).then(r => r.ok ? r.arrayBuffer() : null, () => null)
}

// 動きを読む AI の重み (読めなければ null)。
export function motion_weights(): Promise<ArrayBuffer | null> {
  if (!weights) weights = weights_load()
  return weights
}
