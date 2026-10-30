import { action_tile } from './parts'

export function convenience_html(): string {
  return `<div class="acts two">
    ${action_tile('motion_assist_btn', 'wave', 'うごきアシスト', 'big')}
    ${action_tile('effect_btn', 'effect', '絵のエフェクト', 'big')}
    ${action_tile('trans_btn', 'transition', 'コマをつなぐ', 'big')}
    ${action_tile('flip_image_btn', 'image', '画像からうごメモ', 'big')}
  </div>`
}
