export type GpuField = { grid: { w: number, h: number, cell: number, columns: number, rows: number, stride: number }, dx: Float32Array, dy: Float32Array }
type Gpu = { canvas: HTMLCanvasElement, gl: WebGL2RenderingContext, program: WebGLProgram, source: WebGLTexture, field: WebGLTexture, size: WebGLUniformLocation, cell: WebGLUniformLocation, sourceImage: CanvasImageSource | null, fieldImage: GpuField | null, limit: number }
let gpu: Gpu | null = null
let unavailable = 0

const vertex = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`
const fragment = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D sourceTex;
uniform sampler2D fieldTex;
uniform vec2 size;
uniform float cell;
out vec4 color;
void main() {
  vec2 p = vec2(floor(gl_FragCoord.x), size.y - 1.0 - floor(gl_FragCoord.y));
  ivec2 c = ivec2(floor(p / cell));
  vec2 start = vec2(c) * cell;
  vec2 end = min(size, start + cell);
  vec2 mixValue = clamp((p + 0.5 - start) / max(vec2(1.0), end - start), 0.0, 1.0);
  mixValue = mixValue * mixValue * (3.0 - 2.0 * mixValue);
  vec2 top = mix(texelFetch(fieldTex,c,0).rg,texelFetch(fieldTex,c+ivec2(1,0),0).rg,mixValue.x);
  vec2 bottom = mix(texelFetch(fieldTex,c+ivec2(0,1),0).rg,texelFetch(fieldTex,c+ivec2(1,1),0).rg,mixValue.x);
  vec2 position = clamp(p-mix(top,bottom,mixValue.y),vec2(0.0),size-1.0);
  ivec2 a = ivec2(floor(position));
  ivec2 b = min(a+1,ivec2(size)-1);
  vec2 f = fract(position);
  vec4 s00 = texelFetch(sourceTex,a,0);
  vec4 s10 = texelFetch(sourceTex,ivec2(b.x,a.y),0);
  vec4 s01 = texelFetch(sourceTex,ivec2(a.x,b.y),0);
  vec4 s11 = texelFetch(sourceTex,b,0);
  vec4 weights = vec4((1.0-f.x)*(1.0-f.y),f.x*(1.0-f.y),(1.0-f.x)*f.y,f.x*f.y);
  vec4 alpha = vec4(s00.a,s10.a,s01.a,s11.a);
  vec4 premult = weights * alpha;
  float sum = dot(premult,vec4(1.0));
  if (sum < 0.5/255.0) { color = vec4(0.0); return; }
  vec3 rgb = (s00.rgb*premult.x+s10.rgb*premult.y+s01.rgb*premult.z+s11.rgb*premult.w)/sum;
  float coverage = max(sum,max(max(alpha.x,alpha.y),max(alpha.z,alpha.w))*0.58);
  color = vec4(rgb,coverage);
}`

function shader_make(gl: WebGL2RenderingContext, kind: number, source: string): WebGLShader {
  const shader = gl.createShader(kind)
  if (!shader) throw new Error('Shader allocation failed')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error('Shader compilation failed') }
  return shader
}

function texture_make(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Texture allocation failed')
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return texture
}

function gpu_get(): Gpu | null {
  if (unavailable) return null
  if (gpu) return gpu
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false })
  if (!gl) { unavailable = 1; return null }
  try {
    const vs = shader_make(gl, gl.VERTEX_SHADER, vertex)
    const fs = shader_make(gl, gl.FRAGMENT_SHADER, fragment)
    const program = gl.createProgram()
    if (!program) throw new Error('Program allocation failed')
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Program linking failed')
    gl.useProgram(program)
    gl.uniform1i(gl.getUniformLocation(program, 'sourceTex'), 0)
    gl.uniform1i(gl.getUniformLocation(program, 'fieldTex'), 1)
    const size = gl.getUniformLocation(program, 'size')
    const cell = gl.getUniformLocation(program, 'cell')
    if (!size || !cell) throw new Error('Uniform lookup failed')
    const source = texture_make(gl)
    const field = texture_make(gl)
    gpu = { canvas, gl, program, source, field, size, cell, sourceImage: null, fieldImage: null, limit: Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) }
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); gpu = null; unavailable = 1 })
    canvas.addEventListener('webglcontextrestored', () => { gpu = null; unavailable = 0 })
    return gpu
  } catch { unavailable = 1; gl.getExtension('WEBGL_lose_context')?.loseContext(); return null }
}

export function gpu_wiggle(source: CanvasImageSource, field: GpuField): HTMLCanvasElement | null {
  const g = gpu_get()
  if (!g || g.gl.isContextLost()) return null
  const { w, h, cell, columns, rows } = field.grid
  if (w > g.limit || h > g.limit) return null
  const gl = g.gl
  try {
    if (g.canvas.width !== w || g.canvas.height !== h) {
      g.canvas.width = w
      g.canvas.height = h
      g.sourceImage = null
      g.fieldImage = null
    }
    gl.viewport(0, 0, w, h)
    gl.useProgram(g.program)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, g.source)
    if (g.sourceImage !== source) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
      g.sourceImage = source
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, g.field)
    if (g.fieldImage !== field) {
      const offsets = new Float32Array(field.dx.length * 2)
      for (let i = 0; i < field.dx.length; i++) { offsets[i * 2] = field.dx[i]; offsets[i * 2 + 1] = field.dy[i] }
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, columns + 1, rows + 1, 0, gl.RG, gl.FLOAT, offsets)
      g.fieldImage = field
    }
    gl.uniform2f(g.size, w, h)
    gl.uniform1f(g.cell, cell)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    if (gl.getError() !== gl.NO_ERROR) { gpu_reset(); unavailable = 1; return null }
    return g.canvas
  } catch { gpu_reset(); unavailable = 1; return null }
}

export function gpu_reset(): void {
  if (!gpu) return
  const g = gpu
  gpu = null
  g.gl.deleteTexture(g.source)
  g.gl.deleteTexture(g.field)
  g.gl.deleteProgram(g.program)
  g.canvas.width = 0
  g.canvas.height = 0
}
