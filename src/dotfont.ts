const H = (s: string): number[] => {
  const out: number[] = []
  for (let i = 0; i < 8; i++) out.push(parseInt(s.slice(i * 2, i * 2 + 2), 16))
  return out
}

const HIRA: Record<string, string> = {
  あ: '20F8203C6AACAA44', い: '000042424242424A30', う: '3C40203810040438', え: '384402081C64423C',
  お: '10FE1032585492A0', か: '1050FC5252549850', き: '20FC10FC021C221C', く: '0004081020100804',
  け: '42D2525252524A42', こ: '003C40000040403C', さ: '20FC08087002027C', し: '4040404040424438',
  す: '00FE102C34241810', せ: '1012FE1212721E10', そ: '7C0810FE10102018', た: '20F8241E20685422',
  ち: '20FC20783C04047C', つ: '0000FC0202020438', て: '007E040810101008', と: '004044584040423C',
  な: '20F82426105294AC', に: '425A424252524A42', ぬ: '245C6AAAAAB65429', ね: '40F04848505C524D',
  の: '003864A4A4A44830', は: '42D2525E52725E42', ひ: '0074A42424242418', ふ: '300400341252902C',
  へ: '0000102844828100', ほ: '42DE525E52725E42', ま: '107C107C10386C58', み: '0078081868A8AC72',
  む: '20E22422A222AC70', め: '00245C6AAAAA4C30', も: '10107C107C101E10', や: '0022FA249048281C',
  ゆ: '0034545494947810', よ: '0808083808486830', ら: '203C0038440404F8', り: '0044444444440830',
  る: '007C0810384442BC', れ: '40F04848504C5263', ろ: '007C081030444438', わ: '40F0484850586444',
  を: '20FC20304C90503C', ん: '1010202028549292',
  ぁ: '0000107810545428', ぃ: '0000004444445438', ぅ: '0000380408043038', ぇ: '0000380818244438',
  ぉ: '0000107C14385478', ゃ: '000044FA48281810', ゅ: '0000345494947810', ょ: '0000103810186830',
  っ: '0000007C02020438', ー: '000000FE00000000',
}

const KATA: Record<string, string> = {
  ア: '00FE021408102000', イ: '00040830D0101010', ウ: '1010FE8282041830', エ: '007C1010107C0000',
  オ: '0808FE0818284808', カ: '1010FE1212224486', キ: '20207C20FE202020', ク: '003C444404081060',
  ケ: '20207E4444081060', コ: '007E0202027E0200', サ: '4444FE4444040818', シ: '00420402420C7080',
  ス: '007C040418244382', セ: '1010FE1212140810', ソ: '0082420408103060', タ: '003C44A414081060',
  チ: '060878207E202040', ツ: '00925252020C7080', テ: '007C00FE10102040', ト: '004040704C404040',
  ナ: '1010FE1010102040', ニ: '003C000000007E00', ヌ: '007E022436141060', ネ: '10FE0428D6103010',
  ノ: '0004040808103060', ハ: '0028242442428181', ヒ: '40405C6440403E00', フ: '007E020202041830',
  ヘ: '0000102844828100', ホ: '1010FE1054921010', マ: '007E020214081422', ミ: '00700E00700E0060',
  ム: '00081010204486FE', メ: '000A0C08FE081020', モ: '3C1010FE10101E10', ヤ: '1012FE9212101010',
  ユ: '0038080808087E00', ヨ: '007E027E02027E00', ラ: '3C007E0204081060', リ: '0044444444040830',
  ル: '0024242424244AB1', レ: '0040404042443840', ロ: '007E4242427E4200', ワ: '007E424204081060',
  ヲ: '007E027E02041830', ン: '0060120202047880',
  ァ: '0000007C08102000', ィ: '0000081860101010', ゥ: '0010107C44081000', ェ: '0000380810380000',
  ォ: '000008782848081C', ャ: '000024FE44181010', ュ: '0000380808087C00', ョ: '00003C043C043C00',
  ッ: '0000005428041830',
}

const LATIN: Record<string, string> = {
  A: '1028444444FE4444', B: 'F8444478444444F8', C: '3844808080804438', D: 'F0484444444448F0',
  E: 'FE808080F88080FE', F: 'FE808080F8808080', G: '38448080BC844438', H: '444444447C444444',
  I: '3810101010101038', J: '0E040404044444B8', K: '4448506050484444', L: '80808080808080FE',
  M: '82C6AA9292828282', N: '84C4A4949C8C8484', O: '3844828282824438', P: 'F8444444F8808080',
  Q: '384482829A844A34', R: 'F8444444F8484444', S: '3C4240380402843C', T: 'FE10101010101010',
  U: '4444444444444438', V: '8282444428281010', W: '82829292AAAA4444', X: '8244281028448282',
  Y: '8244281010101010', Z: 'FE040810204080FE',
  a: '0000384404744C34', b: '404078444444C478', c: '0000384440404438', d: '04043C4444444C34',
  e: '000038447C404038', f: '1820207820202020', g: '00003A44443C0438', h: '4040784444444444',
  i: '1000301010101038', j: '080018080808C870', k: '4040485060504844', l: '3010101010101038',
  m: '0000EC9292929292', n: '0000784444444444', o: '0000384444444438', p: '0000784444784040',
  q: '00003C44443C0406', r: '00005C6040404040', s: '00003C4030087844',
  t: '2020782020202418', u: '0000444444444C34', v: '0000444444282810', w: '00009292AAAA4444',
  x: '0000442810284444', y: '00004444443C0438', z: '00007C081020407C',
  '0': '3844444C54644438', '1': '1030501010101038', '2': '384404183060407C', '3': '7C04083804044438',
  '4': '0818284888FC0808', '5': '7C40780404044438', '6': '1820407844444438',
  '7': '7C04040808101010', '8': '3844443844444438', '9': '384444443C040830',
  ' ': '0000000000000000', '。': '0000000000182418', '、': '0000000000100810',
  '!': '1010101010100010', '?': '3844040810001010', '・': '0000001818000000',
  '「': '1E10101010000000', '」': '7808080808080878',
  '(': '0810202020201008', ')': '1008040404040810', '～': '0000006092000000',
  '…': '0000000000000054', ':': '0018180000181800', '.': '0000000000001818',
  ',': '0000000000181020', '\'': '1010200000000000', '-': '000000007C000000',
  '+': '000010107C101000', '=': '0000007C007C0000', '/': '0204080810204080',
}

const GLYPHS: Record<string, number[]> = {}
for (const t of [HIRA, KATA, LATIN]) for (const k of Object.keys(t)) GLYPHS[k] = H(t[k])

const DAKU_PAIRS = 'かが きぎ くぐ けげ こご さざ しじ すず せぜ そぞ ただ ちぢ つづ てで とど はば ひび ふぶ へべ ほぼ カガ キギ クグ ケゲ コゴ サザ シジ スズ セゼ ソゾ タダ チヂ ツヅ テデ トド ハバ ヒビ フブ ヘベ ホボ ウヴ'.split(' ')
const HANDAKU_PAIRS = 'はぱ ひぴ ふぷ へぺ ほぽ ハパ ヒピ フプ ヘペ ホポ'.split(' ')

function compose(basech: string, mark: number[]): number[] {
  const b = GLYPHS[basech]
  const out: number[] = []
  for (let i = 0; i < 8; i++) out.push(i === 0 ? 0 : (b[i - 1] << 1) & 0xff)
  for (let i = 0; i < 8; i++) out[i] |= mark[i]
  return out
}

const MARK_DAKU = H('0A05000000000000')
const MARK_HANDAKU = H('0705070000000000')
for (const p of DAKU_PAIRS) GLYPHS[p[1]] = compose(p[0], MARK_DAKU)
for (const p of HANDAKU_PAIRS) GLYPHS[p[1]] = compose(p[0], MARK_HANDAKU)

const TOFU = H('FE828282828282FE')

export const DOT_FONT_FAMILY = '__dot__'

export function dot_glyph(ch: string): number[] {
  const g = GLYPHS[ch]
  if (g) return g
  return TOFU
}

export function dot_text_canvas(text: string, scale: number, color: string, outline: number, ocolor: string, vert: number): HTMLCanvasElement {
  const sc = Math.max(1, Math.round(scale))
  const lines = text.replace(/\r/g, '').split('\n')
  const cell = 8
  let cols = 0
  for (const ln of lines) cols = Math.max(cols, [...ln].length)
  if (cols === 0) cols = 1
  const rows = lines.length
  const gw = vert ? rows : cols
  const gh = vert ? cols : rows
  const pad = outline ? 1 : 0
  const c = document.createElement('canvas')
  c.width = (gw * cell + pad * 2) * sc
  c.height = (gh * cell + pad * 2) * sc
  const x = c.getContext('2d') as CanvasRenderingContext2D

  const put = (gx: number, gy: number, glyph: number[], col: string, expand: number) => {
    for (let ry = 0; ry < 8; ry++) {
      const bits = glyph[ry]
      for (let rx = 0; rx < 8; rx++) {
        if (!(bits & (0x80 >> rx))) continue
        const px = pad + gx * cell + rx
        const py = pad + gy * cell + ry
        if (expand) {
          x.fillStyle = col
          x.fillRect((px - 1) * sc, py * sc, sc * 3, sc)
          x.fillRect(px * sc, (py - 1) * sc, sc, sc * 3)
        } else {
          x.fillStyle = col
          x.fillRect(px * sc, py * sc, sc, sc)
        }
      }
    }
  }

  for (let li = 0; li < lines.length; li++) {
    const chars = [...lines[li]]
    for (let ci = 0; ci < chars.length; ci++) {
      const glyph = dot_glyph(chars[ci])
      const gx = vert ? rows - 1 - li : ci
      const gy = vert ? ci : li
      if (outline) put(gx, gy, glyph, ocolor, 1)
    }
  }
  for (let li = 0; li < lines.length; li++) {
    const chars = [...lines[li]]
    for (let ci = 0; ci < chars.length; ci++) {
      const glyph = dot_glyph(chars[ci])
      const gx = vert ? rows - 1 - li : ci
      const gy = vert ? ci : li
      put(gx, gy, glyph, color, 0)
    }
  }
  return c
}
