// 絵の動きを AI で読む。RIFE v4.26 の IFNet (MIT License, Zhewei Huang ほか) を動かす (assets/ai/motion-v426.bin)。
// 2枚の絵と時間 t から、t の時の絵の点が、前の絵と後の絵のどこにあったか (動きのマップ) を求める。
// WebGPU があればそれで、なければ CPU で (Worker の中で、ゆっくり) 動かす。
// 計算のならびは1回だけ組み立てて (plan_t)、それを GPU か CPU がくり返し実行する。

import { copy_dst, copy_src, half_float, map_read, use_storage, use_uniform } from '../flipnote/ai_lines'

// 重みのならび: たたみこみは 重み [出][入][3][3]、かたより [出]。残差のたたみこみは、そのあとに beta [出]。
// 逆たたみこみは 重み [出][入][4][4]、かたより [出]。
// 4 つで絵の特徴を作り、そのあと段 (block) ごとに、たたみこみ 2 つ、残差 8 つ、逆たたみこみ 1 つがならぶ。
type layer_t = { cin: number, cout: number, w: number, b: number, a: number }

// 段ごとの、中の特徴の数と入力の数と、絵をちぢめる割合。
const block_c = Int32Array.of(192, 128, 96, 64, 32)
const block_in = Int32Array.of(15, 28, 28, 28, 28)
const block_scale = Int32Array.of(16, 8, 4, 2, 1)
const block_n = 5
const res_n = 8
// 絵の特徴を作るたたみこみの数。段の重みは、そのあとからならぶ。
const head_n = 4
// 段ごとの層の数。
const block_layers = 2 + res_n + 1
// 段の出力の数 (動き 4、重なり 1、次の段へわたす特徴 8)。
const out_c = 13
// 絵の大きさは、この倍数にする。
export const net_align = 64

const op_conv = 0
const op_deconv = 1
const op_shuffle = 2
const op_resize = 3
const op_warp = 4
const op_mix = 5
const op_copy = 6

// 計算の1つ。dst, src, other はテンソルの番号。
// conv, deconv: layer は重み、stride は歩幅、act は活性化、res は残差。warp: other は動き、from はその中の位置。
// mix: dst = src × ka + other × kb。copy: src の from から count 個を、dst の to へ写す。
type op_t = { kind: number, dst: number, src: number, other: number, layer: number, stride: number, act: number, res: number, ka: number, kb: number, from: number, to: number, count: number, group: GPUBindGroup | null }
// 絵のならび (c 個の面、1 面は w×h)。data か buf のどちらかに入る。
type tensor_t = { c: number, w: number, h: number, data: Float32Array | null, buf: GPUBuffer | null }
// 組み立てた計算。img0, img1, time は入力、out は出力 (5 面) のテンソルの番号。
type plan_t = { w: number, h: number, tensors: tensor_t[], ops: op_t[], img0: number, img1: number, time: number, out: number, read: GPUBuffer | null }
// WebGPU のデバイスとパイプラインと重みのバッファ。
type gpu_t = { device: GPUDevice, pipes: GPUComputePipeline[], weights: GPUBuffer }

export type motion_net_t = { data: Float32Array, layers: layer_t[], gpu: gpu_t | null, plans: Map<number, plan_t> }

const head = 'struct dims { w: u32, h: u32, ow: u32, oh: u32, cin: u32, cout: u32, stride: u32, woff: u32, boff: u32, aoff: u32, act: u32, res: u32 }'

const conv_code = head + /* wgsl */ `
@group(0) @binding(0) var<uniform> d: dims;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> wts: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;

// 3×3 のたたみこみ (まわりは 0)。1 回に 4 つの出力をまとめて求める。
@compute @workgroup_size(8, 8, 1)
fn conv(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;
  let o0 = id.z * 4u;
  if (x >= d.ow || y >= d.oh || o0 >= d.cout) { return; }
  let span = d.cin * 9u;
  let sx = i32(x * d.stride);
  let sy = i32(y * d.stride);
  var acc = vec4<f32>(0.0);
  for (var ky = 0; ky < 3; ky++) {
    let yy = sy + ky - 1;
    if (yy < 0 || yy >= i32(d.h)) { continue; }
    for (var kx = 0; kx < 3; kx++) {
      let xx = sx + kx - 1;
      if (xx < 0 || xx >= i32(d.w)) { continue; }
      let tap = u32(ky * 3 + kx);
      for (var c = 0u; c < d.cin; c++) {
        let v = src[(c * d.h + u32(yy)) * d.w + u32(xx)];
        let k = d.woff + o0 * span + c * 9u + tap;
        acc += v * vec4<f32>(wts[k], wts[k + span], wts[k + span * 2u], wts[k + span * 3u]);
      }
    }
  }
  for (var j = 0u; j < 4u; j++) {
    let o = o0 + j;
    var v = acc[j] + wts[d.boff + o];
    if (d.res == 1u) { v = v * wts[d.aoff + o] + src[(o * d.h + y) * d.w + x]; }
    if (d.act == 1u && v < 0.0) { v = v * 0.2; }
    dst[(o * d.oh + y) * d.ow + x] = v;
  }
}
`

const deconv_code = head + /* wgsl */ `
@group(0) @binding(0) var<uniform> d: dims;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> wts: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;

// 4×4 で 2 倍にする逆たたみこみ。出力の 1 点には、入力の 4 点がかかわる。
@compute @workgroup_size(8, 8, 1)
fn deconv(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x;
  let y = id.y;
  let o0 = id.z * 4u;
  if (x >= d.ow || y >= d.oh || o0 >= d.cout) { return; }
  let span = d.cin * 16u;
  let base_x = i32((x + 1u) / 2u);
  let base_y = i32((y + 1u) / 2u);
  let low_x = (x + 1u) % 2u;
  let low_y = (y + 1u) % 2u;
  var acc = vec4<f32>(0.0);
  for (var t = 0u; t < 4u; t++) {
    let ix = base_x - i32(t & 1u);
    let iy = base_y - i32(t >> 1u);
    if (ix < 0 || iy < 0 || ix >= i32(d.w) || iy >= i32(d.h)) { continue; }
    let tap = (low_y + (t >> 1u) * 2u) * 4u + low_x + (t & 1u) * 2u;
    for (var c = 0u; c < d.cin; c++) {
      let v = src[(c * d.h + u32(iy)) * d.w + u32(ix)];
      let k = d.woff + o0 * span + c * 16u + tap;
      acc += v * vec4<f32>(wts[k], wts[k + span], wts[k + span * 2u], wts[k + span * 3u]);
    }
  }
  for (var j = 0u; j < 4u; j++) {
    let o = o0 + j;
    dst[(o * d.oh + y) * d.ow + x] = acc[j] + wts[d.boff + o];
  }
}
`

const shuffle_code = head + /* wgsl */ `
@group(0) @binding(0) var<uniform> d: dims;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

// 4 面を 2×2 の点にならべて、たて横 2 倍の 1 面にする。
@compute @workgroup_size(8, 8, 1)
fn shuffle(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= d.ow || id.y >= d.oh || id.z >= d.cout) { return; }
  let part = id.z * 4u + (id.y % 2u) * 2u + id.x % 2u;
  dst[(id.z * d.oh + id.y) * d.ow + id.x] = src[(part * d.h + id.y / 2u) * d.w + id.x / 2u];
}
`

const resize_code = head + /* wgsl */ `
@group(0) @binding(0) var<uniform> d: dims;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

fn at(c: u32, x: i32, y: i32) -> f32 {
  let xx = u32(clamp(x, 0, i32(d.w) - 1));
  let yy = u32(clamp(y, 0, i32(d.h) - 1));
  return src[(c * d.h + yy) * d.w + xx];
}

// まわりの 4 点から大きさを変える。
@compute @workgroup_size(8, 8, 1)
fn resize(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= d.ow || id.y >= d.oh || id.z >= d.cout) { return; }
  let u = (f32(id.x) + 0.5) * f32(d.w) / f32(d.ow) - 0.5;
  let v = (f32(id.y) + 0.5) * f32(d.h) / f32(d.oh) - 0.5;
  let x0 = i32(floor(u));
  let y0 = i32(floor(v));
  let fx = u - f32(x0);
  let fy = v - f32(y0);
  let c = id.z;
  let top = at(c, x0, y0) * (1.0 - fx) + at(c, x0 + 1, y0) * fx;
  let low = at(c, x0, y0 + 1) * (1.0 - fx) + at(c, x0 + 1, y0 + 1) * fx;
  dst[(c * d.oh + id.y) * d.ow + id.x] = top * (1.0 - fy) + low * fy;
}
`

const warp_code = head + /* wgsl */ `
@group(0) @binding(0) var<uniform> d: dims;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read> flow: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;

fn at(c: u32, x: i32, y: i32) -> f32 {
  let xx = u32(clamp(x, 0, i32(d.w) - 1));
  let yy = u32(clamp(y, 0, i32(d.h) - 1));
  return src[(c * d.h + yy) * d.w + xx];
}

// 動きのマップに合わせて絵をずらす。stride が動きの面の位置。
@compute @workgroup_size(8, 8, 1)
fn warp(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= d.w || id.y >= d.h || id.z >= d.cout) { return; }
  let i = id.y * d.w + id.x;
  let n = d.w * d.h;
  let u = clamp(f32(id.x) + flow[d.stride * n + i], 0.0, f32(d.w - 1u));
  let v = clamp(f32(id.y) + flow[(d.stride + 1u) * n + i], 0.0, f32(d.h - 1u));
  let x0 = i32(floor(u));
  let y0 = i32(floor(v));
  let fx = u - f32(x0);
  let fy = v - f32(y0);
  let c = id.z;
  let top = at(c, x0, y0) * (1.0 - fx) + at(c, x0 + 1, y0) * fx;
  let low = at(c, x0, y0 + 1) * (1.0 - fx) + at(c, x0 + 1, y0 + 1) * fx;
  dst[(c * d.h + id.y) * d.w + id.x] = top * (1.0 - fy) + low * fy;
}
`

const mix_code = /* wgsl */ `
struct dims { n: u32, ka: f32, kb: f32 }
@group(0) @binding(0) var<uniform> d: dims;
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(64, 1, 1)
fn blend(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x >= d.n) { return; }
  dst[id.x] = a[id.x] * d.ka + b[id.x] * d.kb;
}
`

// 重みの表を作る。
function layers_make(): layer_t[] {
  const out: layer_t[] = []
  let p = 0
  const add = (cin: number, cout: number, taps: number, beta: number): void => {
    const w = p
    p += cout * cin * taps
    const b = p
    p += cout
    const a = p
    p += beta
    out.push({ cin, cout, w, b, a })
  }
  add(3, 16, 9, 0)
  add(16, 16, 9, 0)
  add(16, 16, 9, 0)
  add(16, 4, 16, 0)
  for (let k = 0; k < block_n; k++) {
    const c = block_c[k]
    add(block_in[k], c >> 1, 9, 0)
    add(c >> 1, c, 9, 0)
    for (let r = 0; r < res_n; r++) add(c, c, 9, c)
    add(c, 52, 16, 0)
  }
  return out
}

// 重みの数。
function layers_total(layers: layer_t[]): number {
  const last = layers[layers.length - 1]
  return last.a
}

// 重みを読みこむ。WebGPU が使えれば GPU の準備もする。
export async function motion_net_open(blob: ArrayBuffer): Promise<motion_net_t> {
  const bits = new Uint16Array(blob)
  const data = new Float32Array(bits.length)
  for (let i = 0; i < bits.length; i++) data[i] = half_float(bits[i])
  const layers = layers_make()
  if (layers_total(layers) !== data.length) throw new Error('AI の重みの大きさが合いません')
  let gpu: gpu_t | null = null
  try {
    gpu = await gpu_open(data)
  } catch {
    gpu = null
  }
  return { data, layers, gpu, plans: new Map() }
}

function pipe_make(device: GPUDevice, code: string, entry: string): GPUComputePipeline {
  return device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code }), entryPoint: entry } })
}

// WebGPU の準備をする (使えなければ null)。パイプラインは計算の種類 (op_conv など) の順。
async function gpu_open(data: Float32Array): Promise<gpu_t | null> {
  const nav = globalThis.navigator as Navigator | undefined
  const gpu = nav ? nav.gpu : undefined
  if (!gpu) return null
  const adapter = await gpu.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  const weights = device.createBuffer({ size: data.byteLength, usage: use_storage | copy_dst })
  device.queue.writeBuffer(weights, 0, data)
  const pipes = [
    pipe_make(device, conv_code, 'conv'),
    pipe_make(device, deconv_code, 'deconv'),
    pipe_make(device, shuffle_code, 'shuffle'),
    pipe_make(device, resize_code, 'resize'),
    pipe_make(device, warp_code, 'warp'),
    pipe_make(device, mix_code, 'blend'),
  ]
  return { device, pipes, weights }
}

// GPU で動かすか。
export function motion_net_fast(net: motion_net_t): number {
  return net.gpu ? 1 : 0
}

function tensor(p: plan_t, c: number, w: number, h: number): number {
  p.tensors.push({ c, w, h, data: null, buf: null })
  return p.tensors.length - 1
}

function op_new(kind: number, dst: number, src: number): op_t {
  return { kind, dst, src, other: -1, layer: 0, stride: 1, act: 0, res: 0, ka: 1, kb: 0, from: 0, to: 0, count: 0, group: null }
}

function emit_conv(p: plan_t, dst: number, src: number, layer: number, stride: number, act: number, res: number): void {
  const op = op_new(op_conv, dst, src)
  op.layer = layer
  op.stride = stride
  op.act = act
  op.res = res
  p.ops.push(op)
}

function emit_deconv(p: plan_t, dst: number, src: number, layer: number): void {
  const op = op_new(op_deconv, dst, src)
  op.layer = layer
  p.ops.push(op)
}

function emit_warp(p: plan_t, dst: number, src: number, flow: number, from: number): void {
  const op = op_new(op_warp, dst, src)
  op.other = flow
  op.from = from
  p.ops.push(op)
}

// dst = a × ka + b × kb。
function emit_mix(p: plan_t, dst: number, a: number, ka: number, b: number, kb: number): void {
  const op = op_new(op_mix, dst, a)
  op.other = b
  op.ka = ka
  op.kb = kb
  p.ops.push(op)
}

// src の from 面から count 面を、dst の to 面へ写す。
function emit_copy(p: plan_t, dst: number, to: number, src: number, from: number, count: number): void {
  const op = op_new(op_copy, dst, src)
  op.from = from
  op.to = to
  op.count = count
  p.ops.push(op)
}

// list のテンソルの面をつないで dst へ入れる。
function emit_join(p: plan_t, dst: number, list: number[]): void {
  let to = 0
  for (let i = 0; i < list.length; i++) {
    const c = p.tensors[list[i]].c
    emit_copy(p, dst, to, list[i], 0, c)
    to += c
  }
}

// 絵から特徴を作る。
function emit_head(p: plan_t, img: number): number {
  const w = p.w >> 1
  const h = p.h >> 1
  const a = tensor(p, 16, w, h)
  const b = tensor(p, 16, w, h)
  const c = tensor(p, 16, w, h)
  const out = tensor(p, 4, p.w, p.h)
  emit_conv(p, a, img, 0, 2, 1, 0)
  emit_conv(p, b, a, 1, 1, 1, 0)
  emit_conv(p, c, b, 2, 1, 1, 0)
  emit_deconv(p, out, c, 3)
  return out
}

// 段 k を組み立てる。input は全面の大きさの入力、flow はこれまでの動き (はじめの段では -1)。
// 結果 (動き 4、重なり 1、特徴 8) は全面の大きさのテンソル up に入る。
function emit_block(p: plan_t, k: number, input: number, flow: number, up: number): void {
  const scale = block_scale[k]
  const c = block_c[k]
  const w = p.w / scale
  const h = p.h / scale
  const first = head_n + k * block_layers
  let small = input
  if (scale > 1) {
    small = tensor(p, p.tensors[input].c, w, h)
    p.ops.push(op_new(op_resize, small, input))
  }
  let start = small
  if (flow >= 0) {
    let flow_s = flow
    if (scale > 1) {
      const raw = tensor(p, 4, w, h)
      p.ops.push(op_new(op_resize, raw, flow))
      flow_s = tensor(p, 4, w, h)
      emit_mix(p, flow_s, raw, 1 / scale, raw, 0)
    }
    start = tensor(p, block_in[k], w, h)
    emit_join(p, start, [small, flow_s])
  }
  const half = tensor(p, c >> 1, w >> 1, h >> 1)
  const ping = tensor(p, c, w >> 2, h >> 2)
  const pong = tensor(p, c, w >> 2, h >> 2)
  emit_conv(p, half, start, first, 2, 1, 0)
  emit_conv(p, ping, half, first + 1, 2, 1, 0)
  let src = ping
  let dst = pong
  for (let r = 0; r < res_n; r++) {
    emit_conv(p, dst, src, first + 2 + r, 1, 1, 1)
    const used = src
    src = dst
    dst = used
  }
  const wide = tensor(p, 52, w >> 1, h >> 1)
  emit_deconv(p, wide, src, first + 2 + res_n)
  const done = scale > 1 ? tensor(p, out_c, w, h) : up
  p.ops.push(op_new(op_shuffle, done, wide))
  if (scale > 1) p.ops.push(op_new(op_resize, up, done))
}

// w×h の絵で動かす計算を組み立てる。
function plan_make(net: motion_net_t, w: number, h: number): plan_t {
  const p: plan_t = { w, h, tensors: [], ops: [], img0: 0, img1: 0, time: 0, out: 0, read: null }
  p.img0 = tensor(p, 3, w, h)
  p.img1 = tensor(p, 3, w, h)
  p.time = tensor(p, 1, w, h)
  p.out = tensor(p, 5, w, h)
  const feat0 = emit_head(p, p.img0)
  const feat1 = emit_head(p, p.img1)
  const flow = tensor(p, 4, w, h)
  const next = tensor(p, 4, w, h)
  const delta = tensor(p, 4, w, h)
  const part = tensor(p, 4, w, h)
  const mask = tensor(p, 1, w, h)
  const feat = tensor(p, 8, w, h)
  const warp0 = tensor(p, 3, w, h)
  const warp1 = tensor(p, 3, w, h)
  const warp_f0 = tensor(p, 4, w, h)
  const warp_f1 = tensor(p, 4, w, h)
  const up = tensor(p, out_c, w, h)
  const start = tensor(p, block_in[0], w, h)
  const input = tensor(p, 24, w, h)
  emit_join(p, start, [p.img0, p.img1, feat0, feat1, p.time])
  emit_block(p, 0, start, -1, up)
  emit_copy(p, part, 0, up, 0, 4)
  emit_mix(p, flow, part, block_scale[0], part, 0)
  emit_copy(p, mask, 0, up, 4, 1)
  emit_copy(p, feat, 0, up, 5, 8)
  for (let k = 1; k < block_n; k++) {
    emit_warp(p, warp0, p.img0, flow, 0)
    emit_warp(p, warp1, p.img1, flow, 2)
    emit_warp(p, warp_f0, feat0, flow, 0)
    emit_warp(p, warp_f1, feat1, flow, 2)
    emit_join(p, input, [warp0, warp1, warp_f0, warp_f1, p.time, mask, feat])
    emit_block(p, k, input, flow, up)
    emit_copy(p, part, 0, up, 0, 4)
    emit_mix(p, delta, part, block_scale[k], part, 0)
    emit_mix(p, next, flow, 1, delta, 1)
    emit_copy(p, flow, 0, next, 0, 4)
    emit_copy(p, mask, 0, up, 4, 1)
    emit_copy(p, feat, 0, up, 5, 8)
  }
  emit_join(p, p.out, [flow, mask])
  if (net.gpu) gpu_bind(net, net.gpu, p)
  else for (let i = 0; i < p.tensors.length; i++) cpu_alloc(p.tensors[i])
  return p
}

function cpu_alloc(t: tensor_t): void {
  t.data = new Float32Array(t.c * t.w * t.h)
}

// テンソルのバッファとユニフォームを作り、計算ごとのバインドグループを用意する。
function gpu_bind(net: motion_net_t, gpu: gpu_t, p: plan_t): void {
  const device = gpu.device
  for (let i = 0; i < p.tensors.length; i++) {
    const t = p.tensors[i]
    t.buf = device.createBuffer({ size: t.c * t.w * t.h * 4, usage: use_storage | copy_src | copy_dst })
  }
  p.read = device.createBuffer({ size: p.tensors[p.out].c * p.w * p.h * 4, usage: map_read | copy_dst })
  for (let i = 0; i < p.ops.length; i++) {
    const op = p.ops[i]
    if (op.kind === op_copy) continue
    const dst = p.tensors[op.dst]
    const src = p.tensors[op.src]
    const pipe = gpu.pipes[op.kind]
    const values = new ArrayBuffer(48)
    const ints = new Uint32Array(values)
    const floats = new Float32Array(values)
    const entries: GPUBindGroupEntry[] = [{ binding: 1, resource: { buffer: src.buf as GPUBuffer } }]
    if (op.kind === op_mix) {
      ints[0] = dst.c * dst.w * dst.h
      floats[1] = op.ka
      floats[2] = op.kb
      entries.push({ binding: 2, resource: { buffer: p.tensors[op.other].buf as GPUBuffer } }, { binding: 3, resource: { buffer: dst.buf as GPUBuffer } })
    } else {
      ints.set([src.w, src.h, dst.w, dst.h, src.c, dst.c, op.kind === op_warp ? op.from : op.stride])
      if (op.kind === op_conv || op.kind === op_deconv) {
        const at = net.layers[op.layer]
        ints.set([at.w, at.b, at.a, op.act, op.res], 7)
        entries.push({ binding: 2, resource: { buffer: gpu.weights } }, { binding: 3, resource: { buffer: dst.buf as GPUBuffer } })
      } else if (op.kind === op_warp) {
        entries.push({ binding: 2, resource: { buffer: p.tensors[op.other].buf as GPUBuffer } }, { binding: 3, resource: { buffer: dst.buf as GPUBuffer } })
      } else {
        entries.push({ binding: 2, resource: { buffer: dst.buf as GPUBuffer } })
      }
    }
    const uniform = device.createBuffer({ size: 48, usage: use_uniform | copy_dst })
    device.queue.writeBuffer(uniform, 0, values)
    entries.push({ binding: 0, resource: { buffer: uniform } })
    op.group = device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries })
  }
}

// 計算を1回まわす。GPU を長く独り占めしないよう、いくつかずつに分けて送る。
async function gpu_run(gpu: gpu_t, p: plan_t): Promise<Float32Array> {
  const device = gpu.device
  let encoder = device.createCommandEncoder()
  let pass: GPUComputePassEncoder | null = null
  let done = 0
  for (let i = 0; i < p.ops.length; i++) {
    const op = p.ops[i]
    if (op.kind === op_copy) {
      if (pass) pass.end()
      pass = null
      const src = p.tensors[op.src]
      const dst = p.tensors[op.dst]
      const plane = src.w * src.h * 4
      encoder.copyBufferToBuffer(src.buf as GPUBuffer, op.from * plane, dst.buf as GPUBuffer, op.to * plane, op.count * plane)
      continue
    }
    const dst = p.tensors[op.dst]
    if (!pass) pass = encoder.beginComputePass()
    pass.setPipeline(gpu.pipes[op.kind])
    pass.setBindGroup(0, op.group as GPUBindGroup)
    if (op.kind === op_mix) pass.dispatchWorkgroups(Math.ceil(dst.c * dst.w * dst.h / 64))
    else if (op.kind === op_conv || op.kind === op_deconv) pass.dispatchWorkgroups(Math.ceil(dst.w / 8), Math.ceil(dst.h / 8), dst.c >> 2)
    else pass.dispatchWorkgroups(Math.ceil(dst.w / 8), Math.ceil(dst.h / 8), dst.c)
    if (++done % 16) continue
    pass.end()
    pass = null
    device.queue.submit([encoder.finish()])
    encoder = device.createCommandEncoder()
  }
  if (pass) pass.end()
  const out = p.tensors[p.out]
  const read = p.read as GPUBuffer
  encoder.copyBufferToBuffer(out.buf as GPUBuffer, 0, read, 0, read.size)
  device.queue.submit([encoder.finish()])
  await read.mapAsync(map_read)
  const result = new Float32Array(read.getMappedRange().slice(0))
  read.unmap()
  return result
}

function cpu_conv(net: motion_net_t, op: op_t, src: tensor_t, dst: tensor_t): void {
  const at = net.layers[op.layer]
  const data = net.data
  const input = src.data as Float32Array
  const out = dst.data as Float32Array
  const cin = at.cin
  const cout = at.cout
  const w = src.w
  const h = src.h
  const ow = dst.w
  const oh = dst.h
  const stride = op.stride
  out.fill(0)
  for (let o = 0; o < cout; o++) {
    for (let c = 0; c < cin; c++) {
      for (let t = 0; t < 9; t++) {
        const k = data[at.w + (o * cin + c) * 9 + t]
        const kx = t % 3 - 1
        const ky = (t - t % 3) / 3 - 1
        // はみ出さない x の範囲。
        const x0 = Math.max(0, Math.ceil(-kx / stride))
        const x1 = Math.min(ow, Math.ceil((w - kx) / stride))
        for (let y = 0; y < oh; y++) {
          const sy = y * stride + ky
          if (sy < 0 || sy >= h) continue
          const to = (o * oh + y) * ow
          let s = (c * h + sy) * w + x0 * stride + kx
          for (let x = x0; x < x1; x++) {
            out[to + x] += k * input[s]
            s += stride
          }
        }
      }
    }
  }
  const plane = ow * oh
  for (let o = 0; o < cout; o++) {
    const bias = data[at.b + o]
    const beta = data[at.a + o]
    for (let i = 0; i < plane; i++) {
      let v = out[o * plane + i] + bias
      if (op.res) v = v * beta + input[o * plane + i]
      out[o * plane + i] = op.act && v < 0 ? v * 0.2 : v
    }
  }
}

function cpu_deconv(net: motion_net_t, op: op_t, src: tensor_t, dst: tensor_t): void {
  const at = net.layers[op.layer]
  const data = net.data
  const input = src.data as Float32Array
  const out = dst.data as Float32Array
  const cin = at.cin
  const cout = at.cout
  const w = src.w
  const h = src.h
  const ow = dst.w
  const oh = dst.h
  out.fill(0)
  for (let o = 0; o < cout; o++) {
    for (let c = 0; c < cin; c++) {
      for (let t = 0; t < 16; t++) {
        const k = data[at.w + (o * cin + c) * 16 + t]
        const kx = t & 3
        const ky = t >> 2
        // はみ出さない入力の x の範囲。
        const x0 = kx ? 0 : 1
        const x1 = kx === 3 ? w - 1 : w
        for (let iy = 0; iy < h; iy++) {
          const y = iy * 2 + ky - 1
          if (y < 0 || y >= oh) continue
          const from = (c * h + iy) * w
          let to = (o * oh + y) * ow + x0 * 2 + kx - 1
          for (let ix = x0; ix < x1; ix++) {
            out[to] += k * input[from + ix]
            to += 2
          }
        }
      }
    }
  }
  const plane = ow * oh
  for (let o = 0; o < cout; o++) {
    const bias = data[at.b + o]
    for (let i = 0; i < plane; i++) out[o * plane + i] += bias
  }
}

function cpu_shuffle(src: tensor_t, dst: tensor_t): void {
  const input = src.data as Float32Array
  const out = dst.data as Float32Array
  for (let c = 0; c < dst.c; c++) {
    for (let y = 0; y < dst.h; y++) {
      for (let x = 0; x < dst.w; x++) {
        const part = c * 4 + (y & 1) * 2 + (x & 1)
        out[(c * dst.h + y) * dst.w + x] = input[(part * src.h + (y >> 1)) * src.w + (x >> 1)]
      }
    }
  }
}

// 面 c の (u, v) の値を、まわりの 4 点から求める。
function cpu_bilinear(input: Float32Array, c: number, w: number, h: number, u: number, v: number): number {
  const x0 = Math.floor(u)
  const y0 = Math.floor(v)
  const fx = u - x0
  const fy = v - y0
  const ax = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0
  const bx = x0 + 1 < 0 ? 0 : x0 + 1 >= w ? w - 1 : x0 + 1
  const ay = (y0 < 0 ? 0 : y0 >= h ? h - 1 : y0) * w
  const by = (y0 + 1 < 0 ? 0 : y0 + 1 >= h ? h - 1 : y0 + 1) * w
  const base = c * h * w
  const top = input[base + ay + ax] * (1 - fx) + input[base + ay + bx] * fx
  const low = input[base + by + ax] * (1 - fx) + input[base + by + bx] * fx
  return top * (1 - fy) + low * fy
}

function cpu_resize(src: tensor_t, dst: tensor_t): void {
  const input = src.data as Float32Array
  const out = dst.data as Float32Array
  const rx = src.w / dst.w
  const ry = src.h / dst.h
  for (let c = 0; c < dst.c; c++) {
    for (let y = 0; y < dst.h; y++) {
      const v = (y + 0.5) * ry - 0.5
      for (let x = 0; x < dst.w; x++) out[(c * dst.h + y) * dst.w + x] = cpu_bilinear(input, c, src.w, src.h, (x + 0.5) * rx - 0.5, v)
    }
  }
}

function cpu_warp(op: op_t, src: tensor_t, flow: tensor_t, dst: tensor_t): void {
  const input = src.data as Float32Array
  const field = flow.data as Float32Array
  const out = dst.data as Float32Array
  const w = src.w
  const h = src.h
  const n = w * h
  for (let c = 0; c < dst.c; c++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const u = Math.max(0, Math.min(w - 1, x + field[op.from * n + i]))
        const v = Math.max(0, Math.min(h - 1, y + field[(op.from + 1) * n + i]))
        out[c * n + i] = cpu_bilinear(input, c, w, h, u, v)
      }
    }
  }
}

function cpu_mix(op: op_t, a: tensor_t, b: tensor_t, dst: tensor_t): void {
  const x = a.data as Float32Array
  const y = b.data as Float32Array
  const out = dst.data as Float32Array
  for (let i = 0; i < out.length; i++) out[i] = x[i] * op.ka + y[i] * op.kb
}

function cpu_copy(op: op_t, src: tensor_t, dst: tensor_t): void {
  const plane = src.w * src.h
  const input = src.data as Float32Array
  const out = dst.data as Float32Array
  out.set(input.subarray(op.from * plane, (op.from + op.count) * plane), op.to * plane)
}

function cpu_run(net: motion_net_t, p: plan_t): Float32Array {
  for (let i = 0; i < p.ops.length; i++) {
    const op = p.ops[i]
    const src = p.tensors[op.src]
    const dst = p.tensors[op.dst]
    if (op.kind === op_conv) cpu_conv(net, op, src, dst)
    else if (op.kind === op_deconv) cpu_deconv(net, op, src, dst)
    else if (op.kind === op_shuffle) cpu_shuffle(src, dst)
    else if (op.kind === op_resize) cpu_resize(src, dst)
    else if (op.kind === op_warp) cpu_warp(op, src, p.tensors[op.other], dst)
    else if (op.kind === op_mix) cpu_mix(op, src, p.tensors[op.other], dst)
    else cpu_copy(op, src, dst)
  }
  return (p.tensors[p.out].data as Float32Array).slice()
}

// 2枚の絵 (r, g, b の 3 面、それぞれ w×h、0〜1。w, h は net_align の倍数) と時間 t から、動きのマップを求める。
// 返すのは 5 面: t の時の点が前の絵のどこにあったか (x, y の差)、後の絵のどこにあったか (x, y の差)、重なり。
export async function motion_net_read(net: motion_net_t, a: Float32Array, b: Float32Array, w: number, h: number, t: number): Promise<Float32Array> {
  const key = w * 65536 + h
  let plan = net.plans.get(key)
  if (!plan) {
    plan = plan_make(net, w, h)
    net.plans.set(key, plan)
  }
  const time = new Float32Array(w * h).fill(t)
  if (net.gpu) {
    const queue = net.gpu.device.queue
    queue.writeBuffer(plan.tensors[plan.img0].buf as GPUBuffer, 0, a)
    queue.writeBuffer(plan.tensors[plan.img1].buf as GPUBuffer, 0, b)
    queue.writeBuffer(plan.tensors[plan.time].buf as GPUBuffer, 0, time)
    return gpu_run(net.gpu, plan)
  }
  ;(plan.tensors[plan.img0].data as Float32Array).set(a)
  ;(plan.tensors[plan.img1].data as Float32Array).set(b)
  ;(plan.tensors[plan.time].data as Float32Array).set(time)
  return cpu_run(net, plan)
}
