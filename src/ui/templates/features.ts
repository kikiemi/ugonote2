import { menu_action } from './parts'

// 便利機能の一覧。行は「アイコン・名前・ひとこと」。AI制作支援はノーマルモードだけに出す (sync.ts)。
export function convenience_html(): string {
  return `<section class="opt">
    <div class="opt_head"><b>うごき・つなぎ</b></div>
    <div class="menu_actions">
      ${menu_action('motion_assist_btn', 'wave', 'うごきアシスト', 'ゆらぎや動きをつける')}
      ${menu_action('trans_btn', 'transition', 'コマをつなぐ', '場面の切りかえを入れる')}
    </div>
  </section>
  <section class="opt">
    <div class="opt_head"><b>絵</b></div>
    <div class="menu_actions">
      ${menu_action('effect_btn', 'effect', '絵のエフェクト', 'ぼかしやモザイクをかける')}
      ${menu_action('flip_image_btn', 'image', '画像からうごメモ', '画像を読みこんでコマにする')}
    </div>
  </section>
  <section class="opt" id="aid_tools">
    <div class="opt_head"><b>AI制作支援</b></div>
    <div class="menu_actions">
      ${menu_action('aid_smooth_btn', 'spark', '動きをなめらかにする', '全部のコマのあいだをAIでうめる')}
      ${menu_action('aid_between_btn', 'film', '中割りをつくる', 'いまのコマと次のコマのあいだを作る')}
      ${menu_action('aid_loop_btn', 'loop', 'ループをつなぐ', 'さいごと最初のコマをつなぐ')}
    </div>
  </section>`
}
