import { ic } from '../../dom'

export function convenience_html(): string {
  return `<div class="menu_actions">
    <button class="menu_action" id="motion_assist_btn"><span class="action_glyph">${ic('spark')}</span><span class="action_copy"><b>うごきアシスト</b><small>手描きのゆらぎ・動きをつける</small></span></button>
    <button class="menu_action" id="effect_btn"><span class="action_glyph">${ic('effect')}</span><span class="action_copy"><b>絵のエフェクト</b><small>色や見た目を変える</small></span></button>
    <button class="menu_action" id="trans_btn"><span class="action_glyph">${ic('transition')}</span><span class="action_copy"><b>コマをつなぐ</b><small>絵の切り替わりに動きをつける</small></span></button>
    <button class="menu_action" id="flip_image_btn"><span class="action_glyph">${ic('image')}</span><span class="action_copy"><b>画像からうごメモ</b><small>実機で見られる絵に変換する</small></span></button>
  </div>`
}
