// うごメモのレイヤーをなめらかに描きなおす仕事を、いくつもの Worker に分けて同時に進める。
// Worker が使えない環境では、この画面の中で1枚ずつ描く。
import { report_warning } from '../diagnostics'
import { app_asset } from '../runtime'
import { ai_open, type ai_net_t } from './ai_lines'
import { smooth_pack, smooth_pack_ai, type smooth_job_t, type smooth_out_t } from './smooth'

// まだ描いていない仕事と、できたとき・失敗したときの知らせ先。
type waiting_t = { job: smooth_job_t, done: (packed: smooth_out_t) => void, fail: (error: unknown) => void }
// Worker と、それが描いている仕事 (なければ null)。
type slot_t = { worker: Worker, busy: waiting_t | null }
// Worker から返ってくる知らせ。
type reply_t = { ok: number, packed?: smooth_out_t, fallback?: number, error?: string }

// 仕事の列と Worker のようす。local が 1 なら、この画面の中で描く。ai は AI の重み、here_net はこの画面で開いた AI。
type pool_state_t = { queue: waiting_t[], slots: slot_t[], local: number, seq: number, ai: ArrayBuffer | null, here_net: Promise<ai_net_t | null> | null }

export type smooth_pool_t = { run: (job: smooth_job_t) => Promise<smooth_out_t>, size: number, close: () => void }

// 描きなおしの Worker を作る (1つのファイルにまとめた版では、ページにうめこんだ中身から作る)。
function worker_make(): Worker {
  const inline_source = (globalThis as { __ug2_worker_src?: string }).__ug2_worker_src
  if (!inline_source) return new Worker(app_asset('worker.js'))
  const url = URL.createObjectURL(new Blob([inline_source], { type: 'text/javascript' }))
  const worker = new Worker(url)
  setTimeout(() => URL.revokeObjectURL(url), 30000)
  return worker
}

// AI を開けなかったときの値。
function no_net(): null {
  return null
}

// この画面の中で描く。AI の線は、この画面で使えるときだけ使う。
async function run_here(task: waiting_t, net: Promise<ai_net_t | null> | null): Promise<void> {
  try {
    const ai = task.job.ai && net ? await net : null
    task.done(ai ? await smooth_pack_ai(task.job, ai) : smooth_pack(task.job))
  } catch (error) {
    task.fail(error)
  }
}

// この画面で使う AI (AI を使わないなら null)。はじめて使うときに開く。
function pool_net(pool: pool_state_t): Promise<ai_net_t | null> | null {
  if (pool.ai && !pool.here_net) pool.here_net = ai_open(pool.ai).catch(no_net)
  return pool.here_net
}

// Worker がこわれたら、残りの仕事はこの画面で描く。
function pool_give_up(pool: pool_state_t, error: unknown): void {
  if (pool.local) return
  pool.local = 1
  report_warning('なめらかにする Worker を使えないため、画面の中で描きます', error)
  for (let s = 0; s < pool.slots.length; s++) {
    const slot = pool.slots[s]
    slot.worker.terminate()
    if (slot.busy) pool.queue.unshift(slot.busy)
    slot.busy = null
  }
  pool.slots.length = 0
  pool_pump(pool)
}

// あいている Worker に、つぎの仕事をわたす。
function pool_pump(pool: pool_state_t): void {
  if (pool.local) {
    // 画面の中で描くときは、1つずつ間をあけて描く (進み具合を出せるように)。
    const task = pool.queue.shift()
    if (!task) return
    setTimeout(() => {
      void run_here(task, pool_net(pool)).then(() => pool_pump(pool))
    }, 0)
    return
  }
  for (let s = 0; s < pool.slots.length; s++) {
    const slot = pool.slots[s]
    if (slot.busy || !pool.queue.length) continue
    const task = pool.queue.shift()!
    slot.busy = task
    // 点の並びは写して送る (うごメモの読みこみ結果と共有しているので、渡してしまわない)。
    slot.worker.postMessage({ kind: 'smooth', id: ++pool.seq, job: task.job })
  }
}

// Worker から返ってきた結果を、その仕事の知らせ先へわたす。
function pool_reply(pool: pool_state_t, slot: slot_t, result: reply_t): void {
  const task = slot.busy
  slot.busy = null
  if (!task) return
  if (result.ok && result.packed) task.done(result.packed)
  else if (result.fallback) {
    pool.queue.unshift(task)
    pool_give_up(pool, new Error('この環境の Worker では描けません'))
    return
  } else task.fail(new Error(result.error || 'なめらかにできませんでした'))
  pool_pump(pool)
}

// 仕事を列に入れる。
function pool_run(pool: pool_state_t, job: smooth_job_t): Promise<smooth_out_t> {
  return new Promise<smooth_out_t>((done, fail) => {
    pool.queue.push({ job, done, fail })
    pool_pump(pool)
  })
}

// Worker をすべて止め、残りの仕事を捨てる。
function pool_close(pool: pool_state_t): void {
  for (let s = 0; s < pool.slots.length; s++) pool.slots[s].worker.terminate()
  pool.slots.length = 0
  pool.queue.length = 0
}

// Worker を1つ用意して、知らせを受けとれるようにする。
function slot_open(pool: pool_state_t): slot_t {
  const slot: slot_t = { worker: worker_make(), busy: null }
  if (pool.ai) slot.worker.postMessage({ kind: 'smooth-ai', id: ++pool.seq, weights: pool.ai })
  slot.worker.onmessage = (event: MessageEvent<reply_t>) => pool_reply(pool, slot, event.data)
  slot.worker.onerror = event => {
    event.preventDefault()
    pool_give_up(pool, event.error || event.message)
  }
  return slot
}

// pixels は描きなおす先のキャンバスの点の数。大きい画質では同時に描く数をへらして、メモリを使いすぎないようにする。
// ai は AI の重み (使わないなら null)。GPU は1つなので、WebGPU か WebGL2 で AI を使うときは Worker を 2 つにする
// (どちらもなく CPU で動かすときは、ふだんと同じ数で手分けする)。
// 返す run と close は、flipin.ts から使う形に合わせたもの。
export function smooth_pool_open(pixels: number, ai: ArrayBuffer | null = null): smooth_pool_t {
  const pool: pool_state_t = { queue: [], slots: [], local: typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ? 1 : 0, seq: 0, ai, here_net: null }
  if (!pool.local) {
    const gpu = 'gpu' in navigator || typeof WebGL2RenderingContext !== 'undefined'
    const size = Math.max(1, Math.min(ai && gpu || pixels > 4e6 ? 2 : 8, (navigator.hardwareConcurrency || 4) - 1))
    try {
      for (let i = 0; i < size; i++) pool.slots.push(slot_open(pool))
    } catch (error) {
      pool_give_up(pool, error)
    }
  }
  return {
    size: Math.max(1, pool.slots.length),
    run: job => pool_run(pool, job),
    close: () => pool_close(pool),
  }
}
