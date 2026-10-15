import { animfx_cache_clear } from './animfx'
import { pixel_source_listen } from './pixel_source'
import { report_error, report_warning } from './diagnostics'
import { doc_boot_size, doc_unpack_live } from './doc'
import { q, toast } from './dom'
import { d_all, d_stage, d_thumb } from './h'
import { input_mount } from './input'
import { lang, tr, tr_dom } from './lang'
import { marks_load } from './mark'
import { panels_mount } from './panels'
import { modal_new } from './ui/project_panel'
import { store_boot } from './persist'
import { prefs_load } from './prefs'
import { shell_build } from './shell'
import { sfx_play } from './snd'
import { dispatch } from './state/commands/index'
import { fx_hooks_set } from './state/fx_hooks'
import { dirty, st } from './state/store'
import { storage_get, storage_set } from './storage'
import { paint_store_load } from './paint_storage'
import { sync_mount } from './sync'
import { tut_mount, tut_offer } from './tut'
import { ctx_hide, pop_close, rail_sheet } from './ui/overlay'
import { responsive_mount } from './ui/responsive'
import { app_asset, app_hosted } from './runtime'

function detect_mobile(): number {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  return coarse || window.innerWidth < 900 ? 1 : 0
}

function boot(): void {
  const embedded = !!(globalThis as { __ug2_embedded?: number }).__ug2_embedded
  const root = document.getElementById('app')
  if (!root) {
    document.body.textContent = '#app が見つからないよ'
    return
  }
  fx_hooks_set({
    toast,
    sfx: sfx_play,
    stage_size: () => {
      const wrap = q('stage_wrap')
      const bounds = wrap.getBoundingClientRect()
      const fit = q('paper_fit').getBoundingClientRect()
      const panel = q('frame_panel')
      const bottom = panel.getClientRects().length && getComputedStyle(panel).visibility !== 'hidden' ? Math.min(fit.bottom, panel.getBoundingClientRect().top) : fit.bottom
      return { w: fit.width, h: Math.max(0, bottom - fit.top), x: fit.left - bounds.left, y: fit.top - bounds.top }
    },
  })
  document.documentElement.lang = lang
  document.title = tr('うごくノート2')
  prefs_load()
  dispatch('project.boot_prefs', { mobile: detect_mobile(), marks: [], custom: [] })
  marks_load()
  shell_build(root)
  tr_dom(root)
  dispatch('project.boot_empty', null)
  doc_boot_size()
  doc_unpack_live()
  pixel_source_listen(error => { if (error) { report_warning('動画のコマを読み込めませんでした', error); toast('動画のコマを読み込めませんでした') }; animfx_cache_clear(); dirty(d_stage | d_thumb) })
  sync_mount()
  responsive_mount(() => { pop_close(); rail_sheet(0); ctx_hide() })
  panels_mount()
  input_mount()
  paint_store_load(1, tile => { if (tile && !st().pen.paint_tile) dispatch('pen.load_paint', tile) })
  paint_store_load(0, tile => { if (tile && !st().pen.paint_tile_normal) dispatch('pen.load_paint_normal', tile) })
  tut_mount()
  document.addEventListener('focusout', e => {
    const t = e.target as HTMLElement
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.tagName === 'SELECT')) {
      setTimeout(() => {
        window.scrollTo(0, 0)
        if (document.body) document.body.scrollTop = 0
      }, 50)
    }
  })
  window.addEventListener('error', e => {
    report_error('実行時エラー', e.error || e.message)
    const at = e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''
    toast('エラー: ' + (e.message || 'なにかおかしいかも') + at)
  })
  window.addEventListener('unhandledrejection', e => {
    report_error('未処理の非同期エラー', e.reason)
    toast('エラー(async): ' + String(e.reason).slice(0, 80))
  })
  const menu_seen = embedded || storage_get('ug2_menuseen') === '1' ? 1 : 0
  if (!menu_seen) q('menu_btn').classList.add('pulse')
  store_boot(loaded => {
    dispatch('project.set_booted', null)
    if (loaded) toast('まえのつづきから再開したよ')
    dirty(d_all)
    const seen = embedded || storage_get('ug2_seen') === '1' ? 1 : 0
    requestAnimationFrame(() => {
      dispatch('view.fit', null)
      if (!loaded && !seen) {
        modal_new(false, () => {
          storage_set('ug2_seen', '1')
          requestAnimationFrame(() => {
            dispatch('view.fit', null)
            tut_offer()
          })
        })
      } else {
        storage_set('ug2_seen', '1')
        if (!embedded) tut_offer()
      }
    })
  })
  if (app_hosted() && isSecureContext && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register(app_asset('sw.js')).catch(error => report_warning('Service Workerの登録に失敗しました', error))
  }
  q('title').setAttribute('placeholder', 'ノートの名前')
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
