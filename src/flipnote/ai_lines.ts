// 線や塗りを AI でなめらかにする (β)。Real-ESRGAN の realesr-animevideov3 (BSD-3-Clause, Xintao Wang ほか) を、
// 白黒むけに入力と出力を1色にまとめたもの (assets/ai/lines-v3.bin) を動かす。
// WebGPU があればそれで、なければ WebGL2 で、どちらもなければ CPU で (Worker の中で、ゆっくり) 動かす。
// 明るさの絵 (0〜1、1 が白) から、元の 4 倍の大きさの濃さ (0〜1、1 が黒) を作る。

// 重みのならび: 18 個のたたみこみごとに、重み [出][入][3][3]、かたより [出]、(最後のほかは) PReLU の傾き [出]。
// k 番目のたたみこみの入力と出力の数は layer_cin[k] と layer_cout[k] (はじめは 1→64、あいだの 16 個は 64→64、最後は 64→16)。
const layer_count = 18

// たたみこみごとの数の表。はじめは first、最後は last、あいだは middle。
function layer_table(first: number, middle: number, last: number): Int32Array {
  const out = new Int32Array(layer_count).fill(middle)
  out[0] = first
  out[layer_count - 1] = last
  return out
}

const layer_cin = layer_table(1, 64, 64)
const layer_cout = layer_table(64, 64, 16)

// たたみこみごとの、重み (w)、かたより (b)、傾き (a) の始まりの位置。
type at_t = { w: number, b: number, a: number }[]
// WebGPU で動かすときの、デバイスと2つのパイプラインと、重みのバッファ。
type gpu_t = { device: GPUDevice, conv: GPUComputePipeline, shuffle: GPUComputePipeline, weights: GPUBuffer }
// WebGL2 で動かすときの、コンテキストと2つのプログラムと、たたみこみごとの重みのテクスチャ。
type gl_t = { gl: WebGL2RenderingContext, conv: WebGLProgram, shuffle: WebGLProgram, weights: WebGLTexture[] }
// gpu も gl もなければ CPU で動かす。
export type ai_net_t = { data: Float32Array, at: at_t, gpu: gpu_t | null, gl: gl_t | null }

const head = 'struct dims { w: u32, h: u32, cin: u32, cout: u32, woff: u32, boff: u32, aoff: u32, act: u32 }'

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
  if (x >= d.w || y >= d.h || o0 >= d.cout) { return; }
  let stride = d.cin * 9u;
  var acc = vec4<f32>(0.0);
  for (var c = 0u; c < d.cin; c++) {
    for (var ky = 0u; ky < 3u; ky++) {
      let yy = i32(y) + i32(ky) - 1;
      if (yy < 0 || yy >= i32(d.h)) { continue; }
      for (var kx = 0u; kx < 3u; kx++) {
        let xx = i32(x) + i32(kx) - 1;
        if (xx < 0 || xx >= i32(d.w)) { continue; }
        let v = src[(c * d.h + u32(yy)) * d.w + u32(xx)];
        let k = d.woff + o0 * stride + c * 9u + ky * 3u + kx;
        acc += v * vec4<f32>(wts[k], wts[k + stride], wts[k + stride * 2u], wts[k + stride * 3u]);
      }
    }
  }
  for (var j = 0u; j < 4u; j++) {
    let o = o0 + j;
    var v = acc[j] + wts[d.boff + o];
    if (d.act == 1u && v < 0.0) { v = v * wts[d.aoff + o]; }
    dst[(o * d.h + y) * d.w + x] = v;
  }
}
`

const shuffle_code = head + /* wgsl */ `
@group(0) @binding(0) var<uniform> e: dims;
@group(0) @binding(1) var<storage, read> part: array<f32>;
@group(0) @binding(2) var<storage, read> base: array<f32>;
@group(0) @binding(3) var<storage, read_write> out: array<f32>;

// 16 個の出力を 4×4 の点にならべ、入力を足して、線の濃さ (1 - 明るさ) にする。
@compute @workgroup_size(8, 8, 1)
fn shuffle(@builtin(global_invocation_id) id: vec3<u32>) {
  let ow = e.w * 4u;
  if (id.x >= ow || id.y >= e.h * 4u) { return; }
  let x = id.x / 4u;
  let y = id.y / 4u;
  let s = (id.y % 4u) * 4u + id.x % 4u;
  let v = part[(s * e.h + y) * e.w + x] + base[y * e.w + x];
  out[id.y * ow + id.x] = 1.0 - clamp(v, 0.0, 1.0);
}
`

// WebGPU のバッファの使い方 (GPUBufferUsage と GPUMapMode の値)。
const map_read = 0x1
const copy_src = 0x4
const copy_dst = 0x8
const use_uniform = 0x40
const use_storage = 0x80

// 16 ビットの浮動小数 (重みのファイルの形) を数にする。
function half(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1
  const exp = (bits >> 10) & 31
  const frac = bits & 1023
  if (exp === 0) return sign * 2 ** -14 * (frac / 1024)
  if (exp === 31) return frac ? NaN : sign * Infinity
  return sign * 2 ** (exp - 15) * (1 + frac / 1024)
}

// 重みを読みこむ。WebGPU が使えれば GPU の準備もする。
export async function ai_open(blob: ArrayBuffer): Promise<ai_net_t> {
  const bits = new Uint16Array(blob)
  const data = new Float32Array(bits.length)
  for (let i = 0; i < bits.length; i++) data[i] = half(bits[i])
  const at: at_t = []
  let p = 0
  for (let k = 0; k < layer_count; k++) {
    const cin = layer_cin[k]
    const cout = layer_cout[k]
    const w = p
    p += cout * cin * 9
    const b = p
    p += cout
    const a = p
    if (k < layer_count - 1) p += cout
    at.push({ w: w, b: b, a: a })
  }
  if (p !== data.length) throw new Error('AI の重みの大きさが合いません')
  let gpu: gpu_t | null = null
  try {
    gpu = await gpu_open(data)
  } catch {
    gpu = null
  }
  let gl: gl_t | null = null
  if (!gpu) {
    try {
      gl = gl_open(data, at)
    } catch {
      gl = null
    }
  }
  return { data: data, at: at, gpu: gpu, gl: gl }
}

// ── WebGL2 ──
// 64 の特徴を 4 つずつ RGBA にまとめ、16 組を横にならべた浮動小数のテクスチャ (16w×h) で持つ。
// 1 回のたたみこみでは、出力の 4 つを 1 点として描く。重みは、出力の組ごとに [かたより, 傾き, 4×4 の行列 × 入力の組 × 9 か所]
// をならべた 1 行のテクスチャにする (行列は 4 点で、列が入力、行が出力)。
const gl_vertex = '#version 300 es\nin vec2 p;\nvoid main() { gl_Position = vec4(p, 0.0, 1.0); }'
const gl_conv = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D src;
uniform highp sampler2D wts;
uniform int w;
uniform int h;
uniform int cin;
uniform int act;
out vec4 color;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  int g = at.x / w;
  int x = at.x - g * w;
  int y = at.y;
  int groups = (cin + 3) / 4;
  int base = g * (groups * 36 + 2);
  vec4 acc = texelFetch(wts, ivec2(base, 0), 0);
  vec4 slope = texelFetch(wts, ivec2(base + 1, 0), 0);
  for (int c = 0; c < groups; c++) {
    for (int t = 0; t < 9; t++) {
      int xx = x + t % 3 - 1;
      int yy = y + t / 3 - 1;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      vec4 v = texelFetch(src, ivec2(c * w + xx, yy), 0);
      int k = base + 2 + (c * 9 + t) * 4;
      acc += mat4(texelFetch(wts, ivec2(k, 0), 0), texelFetch(wts, ivec2(k + 1, 0), 0), texelFetch(wts, ivec2(k + 2, 0), 0), texelFetch(wts, ivec2(k + 3, 0), 0)) * v;
    }
  }
  if (act == 1) acc = max(acc, vec4(0.0)) + min(acc, vec4(0.0)) * slope;
  color = acc;
}`
const gl_shuffle = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D src;
uniform highp sampler2D base;
uniform int w;
out vec4 color;
void main() {
  ivec2 at = ivec2(gl_FragCoord.xy);
  int s = (at.y % 4) * 4 + at.x % 4;
  int x = at.x / 4;
  int y = at.y / 4;
  float v = texelFetch(src, ivec2((s / 4) * w + x, y), 0)[s % 4] + texelFetch(base, ivec2(x, y), 0).r;
  color = vec4(1.0 - clamp(v, 0.0, 1.0), 0.0, 0.0, 1.0);
}`

// シェーダー (kind の種類、中身 text) を作って program につける (うまく作れなければ throw)。
function gl_attach(gl: WebGL2RenderingContext, program: WebGLProgram, kind: number, text: string): void {
  const shader = gl.createShader(kind)!
  gl.shaderSource(shader, text)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'shader')
  gl.attachShader(program, shader)
}

// 頂点のシェーダーと frag から、WebGL2 のプログラムを作る。
function gl_program(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const program = gl.createProgram()!
  gl_attach(gl, program, gl.VERTEX_SHADER, gl_vertex)
  gl_attach(gl, program, gl.FRAGMENT_SHADER, frag)
  gl.bindAttribLocation(program, 0, 'p')
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'link')
  return program
}

// w×h の、RGBA の浮動小数のテクスチャを作る (data が null なら、中身はまだ決めない)。
function gl_texture(gl: WebGL2RenderingContext, w: number, h: number, data: Float32Array | null): WebGLTexture {
  const texture = gl.createTexture()!
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data)
  return texture
}

// k 番目のたたみこみの重みを、WebGL2 で読む形 (出力の組ごとに [かたより, 傾き, 行列…] をならべた 1 行のテクスチャ) にする。
function gl_weights(gl: WebGL2RenderingContext, data: Float32Array, at: at_t, k: number): WebGLTexture {
  const cin = layer_cin[k]
  const cout = layer_cout[k]
  const groups = Math.ceil(cin / 4)
  const row = groups * 36 + 2
  const texels = new Float32Array(cout / 4 * row * 4)
  for (let g = 0; g < cout / 4; g++) {
    const base = g * row * 4
    for (let j = 0; j < 4; j++) {
      const o = g * 4 + j
      texels[base + j] = data[at[k].b + o]
      texels[base + 4 + j] = k < layer_count - 1 ? data[at[k].a + o] : 1
      for (let c = 0; c < cin; c++) {
        for (let t = 0; t < 9; t++) texels[base + 8 + ((Math.floor(c / 4) * 9 + t) * 4 + c % 4) * 4 + j] = data[at[k].w + (o * cin + c) * 9 + t]
      }
    }
  }
  return gl_texture(gl, cout / 4 * row, 1, texels)
}

// WebGL2 の準備をする (浮動小数のテクスチャへ描けなければ null)。
function gl_open(data: Float32Array, at: at_t): gl_t | null {
  if (typeof OffscreenCanvas === 'undefined') return null
  const gl = new OffscreenCanvas(1, 1).getContext('webgl2')
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return null
  const conv = gl_program(gl, gl_conv)
  const shuffle = gl_program(gl, gl_shuffle)
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const weights: WebGLTexture[] = []
  for (let k = 0; k < layer_count; k++) weights.push(gl_weights(gl, data, at, k))
  return { gl: gl, conv: conv, shuffle: shuffle, weights: weights }
}

// 描きこむ先のテクスチャ (tw×th) を作って、フレームバッファにつなぐ。あとで消すように temps へ入れておく。
function gl_target(gl: WebGL2RenderingContext, temps: WebGLTexture[], tw: number, th: number): WebGLTexture {
  const t = gl_texture(gl, tw, th, null)
  temps.push(t)
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0)
  gl.viewport(0, 0, tw, th)
  return t
}

// WebGL2 で動かす。たたみこみごとに、出力のテクスチャへ描いて、次の入力にする。
function gl_run(net: gl_t, light: Float32Array, w: number, h: number): Float32Array {
  const gl = net.gl
  const temps: WebGLTexture[] = []
  const frame = gl.createFramebuffer()
  gl.bindFramebuffer(gl.FRAMEBUFFER, frame)
  try {
    const rgba = new Float32Array(w * h * 4)
    for (let i = 0; i < w * h; i++) rgba[i * 4] = light[i]
    const input = gl_texture(gl, w, h, rgba)
    temps.push(input)
    let src = input
    gl.useProgram(net.conv)
    gl.uniform1i(gl.getUniformLocation(net.conv, 'src'), 0)
    gl.uniform1i(gl.getUniformLocation(net.conv, 'wts'), 1)
    gl.uniform1i(gl.getUniformLocation(net.conv, 'w'), w)
    gl.uniform1i(gl.getUniformLocation(net.conv, 'h'), h)
    for (let k = 0; k < layer_count; k++) {
      const dst = gl_target(gl, temps, w * layer_cout[k] / 4, h)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, src)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, net.weights[k])
      gl.uniform1i(gl.getUniformLocation(net.conv, 'cin'), layer_cin[k])
      gl.uniform1i(gl.getUniformLocation(net.conv, 'act'), k < layer_count - 1 ? 1 : 0)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      src = dst
    }
    gl.useProgram(net.shuffle)
    gl_target(gl, temps, w * 4, h * 4)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, src)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, input)
    gl.uniform1i(gl.getUniformLocation(net.shuffle, 'src'), 0)
    gl.uniform1i(gl.getUniformLocation(net.shuffle, 'base'), 1)
    gl.uniform1i(gl.getUniformLocation(net.shuffle, 'w'), w)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    const pixels = new Float32Array(w * h * 16 * 4)
    gl.readPixels(0, 0, w * 4, h * 4, gl.RGBA, gl.FLOAT, pixels)
    const out = new Float32Array(w * h * 16)
    for (let i = 0; i < out.length; i++) out[i] = pixels[i * 4]
    return out
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(frame)
    for (let i = 0; i < temps.length; i++) gl.deleteTexture(temps[i])
  }
}

// WebGPU の準備をする (使えなければ null)。重みは、はじめに GPU のバッファへ写しておく。
async function gpu_open(data: Float32Array): Promise<gpu_t | null> {
  const nav = globalThis.navigator as Navigator | undefined
  const gpu = nav ? nav.gpu : undefined
  if (!gpu) return null
  const adapter = await gpu.requestAdapter()
  if (!adapter) return null
  const device = await adapter.requestDevice()
  const weights = device.createBuffer({ size: data.byteLength, usage: use_storage | copy_dst })
  device.queue.writeBuffer(weights, 0, data)
  const conv = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: conv_code }), entryPoint: 'conv' } })
  const shuffle = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: shuffle_code }), entryPoint: 'shuffle' } })
  return { device: device, conv: conv, shuffle: shuffle, weights: weights }
}

// 明るさの絵 (w×h) から、4w×4h の濃さを作る。
// 軽くするため、白でない所を囲む四角に、まわり 20 点の余白をつけた所だけを動かす (AI が見るのはまわり 18 点までなので、
// 余白の外を見なくても結果は同じ)。ほかは白のまま (濃さ 0)。
export async function ai_run(net: ai_net_t, light: Float32Array, w: number, h: number): Promise<Float32Array> {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (light[y * w + x] >= 1) continue
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  }
  const out = new Float32Array(w * h * 16)
  if (x1 < 0) return out
  const pad = 20
  const cx = Math.max(0, x0 - pad)
  const cy = Math.max(0, y0 - pad)
  const cw = Math.min(w, x1 + pad + 1) - cx
  const ch = Math.min(h, y1 + pad + 1) - cy
  const crop = new Float32Array(cw * ch)
  for (let y = 0; y < ch; y++) crop.set(light.subarray((y + cy) * w + cx, (y + cy) * w + cx + cw), y * cw)
  const part = net.gpu ? await gpu_run(net.gpu, net.at, crop, cw, ch) : net.gl ? gl_run(net.gl, crop, cw, ch) : cpu_run(net, crop, cw, ch)
  // 切り出した四角のふちは、AI には黒いふちに見えるので、絵のある所のまわり 2 点までだけを使う。
  const ax = Math.max(cx, x0 - 2) * 4
  const bx = (Math.min(cx + cw, x1 + 3)) * 4
  for (let y = Math.max(cy, y0 - 2) * 4; y < Math.min(cy + ch, y1 + 3) * 4; y++) {
    const from = (y - cy * 4) * cw * 4 - cx * 4
    out.set(part.subarray(from + ax, from + bx), y * w * 4 + ax)
  }
  return out
}

// CPU で動かす。まわりに 0 の1点のふちをつけた形で持ち、たたみこみはずらした行をまとめて足す。
function cpu_run(net: ai_net_t, light: Float32Array, w: number, h: number): Float32Array {
  const pw = w + 2
  const plane = pw * (h + 2)
  let src: Float32Array = new Float32Array(plane)
  for (let y = 0; y < h; y++) src.set(light.subarray(y * w, y * w + w), (y + 1) * pw + 1)
  for (let k = 0; k < layer_count; k++) src = cpu_conv(net, src, w, h, k)
  const ow = w * 4
  const out = new Float32Array(ow * h * 4)
  for (let y = 0; y < h * 4; y++) {
    for (let x = 0; x < ow; x++) {
      const s = (y % 4) * 4 + x % 4
      const v = src[s * plane + ((y >> 2) + 1) * pw + (x >> 2) + 1] + light[(y >> 2) * w + (x >> 2)]
      out[y * ow + x] = 1 - Math.max(0, Math.min(1, v))
    }
  }
  return out
}

// CPU で、k 番目のたたみこみを1つ動かす (src も、かえす特徴も、ふちをつけた形で、1つの特徴ごとに plane 点)。
function cpu_conv(net: ai_net_t, src: Float32Array, w: number, h: number, k: number): Float32Array {
  const data = net.data
  const cin = layer_cin[k]
  const cout = layer_cout[k]
  const pw = w + 2
  const plane = pw * (h + 2)
  const dst = new Float32Array(cout * plane)
  const wo = net.at[k].w
  const bo = net.at[k].b
  const ao = net.at[k].a
  for (let o = 0; o < cout; o++) {
    const out = o * plane
    for (let y = 1; y <= h; y++) dst.fill(data[bo + o], out + y * pw + 1, out + y * pw + 1 + w)
    for (let c = 0; c < cin; c++) {
      const inp = c * plane
      for (let t = 0; t < 9; t++) {
        const weight = data[wo + (o * cin + c) * 9 + t]
        if (!weight) continue
        const shift = inp + (Math.floor(t / 3) - 1) * pw + (t % 3) - 1
        for (let y = 1; y <= h; y++) {
          const row = y * pw + 1
          for (let x = 0; x < w; x++) dst[out + row + x] += weight * src[shift + row + x]
        }
      }
    }
    if (k < layer_count - 1) {
      const slope = data[ao + o]
      for (let y = 1; y <= h; y++) {
        const row = out + y * pw + 1
        for (let x = 0; x < w; x++) if (dst[row + x] < 0) dst[row + x] *= slope
      }
    }
  }
  return dst
}

// たたみこみの数をわたすユニフォームのバッファ (values は 8 個) を作る。あとで消すように uniforms へ入れておく。
function gpu_uniform(device: GPUDevice, uniforms: GPUBuffer[], values: number[]): GPUBuffer {
  const buffer = device.createBuffer({ size: 32, usage: use_uniform | copy_dst })
  device.queue.writeBuffer(buffer, 0, Uint32Array.from(values))
  uniforms.push(buffer)
  return buffer
}

// WebGPU で動かす。たたみこみの出力は、2つのバッファへかわるがわる書く。
async function gpu_run(net: gpu_t, at: at_t, light: Float32Array, w: number, h: number): Promise<Float32Array> {
  const device = net.device
  const n = w * h
  const storage = use_storage
  const input = device.createBuffer({ size: n * 4, usage: storage | copy_dst })
  device.queue.writeBuffer(input, 0, light)
  const ping: GPUBuffer[] = []
  for (let i = 0; i < 2; i++) ping.push(device.createBuffer({ size: n * 64 * 4, usage: storage }))
  const out = device.createBuffer({ size: n * 16 * 4, usage: storage | copy_src })
  const read = device.createBuffer({ size: n * 16 * 4, usage: map_read | copy_dst })
  const uniforms: GPUBuffer[] = []
  const encoder = device.createCommandEncoder()
  try {
    let src = input
    for (let k = 0; k < layer_count; k++) {
      const cin = layer_cin[k]
      const cout = layer_cout[k]
      const dst = ping[k % 2]
      const step = at[k]
      const pass = encoder.beginComputePass()
      pass.setPipeline(net.conv)
      pass.setBindGroup(0, device.createBindGroup({
        layout: net.conv.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: gpu_uniform(device, uniforms, [w, h, cin, cout, step.w, step.b, step.a, k < layer_count - 1 ? 1 : 0]) } },
          { binding: 1, resource: { buffer: src } },
          { binding: 2, resource: { buffer: net.weights } },
          { binding: 3, resource: { buffer: dst } },
        ],
      }))
      pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), cout / 4)
      pass.end()
      src = dst
    }
    const last = encoder.beginComputePass()
    last.setPipeline(net.shuffle)
    last.setBindGroup(0, device.createBindGroup({
      layout: net.shuffle.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: gpu_uniform(device, uniforms, [w, h, 0, 0, 0, 0, 0, 0]) } },
        { binding: 1, resource: { buffer: src } },
        { binding: 2, resource: { buffer: input } },
        { binding: 3, resource: { buffer: out } },
      ],
    }))
    last.dispatchWorkgroups(Math.ceil(w * 4 / 8), Math.ceil(h * 4 / 8), 1)
    last.end()
    encoder.copyBufferToBuffer(out, 0, read, 0, n * 16 * 4)
    device.queue.submit([encoder.finish()])
    await read.mapAsync(map_read)
    return new Float32Array(read.getMappedRange().slice(0))
  } finally {
    read.unmap()
    input.destroy()
    out.destroy()
    read.destroy()
    for (let i = 0; i < ping.length; i++) ping[i].destroy()
    for (let i = 0; i < uniforms.length; i++) uniforms[i].destroy()
  }
}
