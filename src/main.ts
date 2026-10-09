import { report_error, report_warning } from './diagnostics'
import { doc_boot_size, doc_unpack_live } from './doc'
import { q, toast } from './dom'
import { D_ALL } from './h'
import { input_mount } from './input'
import { LANG, tr, tr_dom } from './lang'
import { marks_load } from './mark'
import { panels_mount, modal_new } from './panels'
import { store_boot } from './persist'
import { prefs_load } from './prefs'
import { shell_build } from './shell'
import { sfx_play } from './snd'
import { dispatch } from './state/commands/index'
import { fx_hooks_set } from './state/fx_hooks'
import { dirty } from './state/store'
import { storage_get, storage_set } from './storage'
import { sync_mount } from './sync'
import { tut_mount, tut_offer } from './tut'
import { responsive_mount } from './ui/responsive'

function detect_mobile(): number {
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches
  return coarse || window.innerWidth < 900 ? 1 : 0
}

function boot(): void {
  const embedded = !!(globalThis as { __UG2_EMBEDDED?: number }).__UG2_EMBEDDED
  const root = document.getElementById('app')
  if (!root) {
    document.body.textContent = '#app が見つからないよ'
    return
  }
  fx_hooks_set({
    toast,
    sfx: sfx_play,
    stage_size: () => {
      const wrap = q('stageWrap')
      const bounds = wrap.getBoundingClientRect()
      const fit = q('paperFit').getBoundingClientRect()
      return { w: fit.width, h: fit.height, x: fit.left - bounds.left, y: fit.top - bounds.top }
    },
  })
  document.documentElement.lang = LANG
  document.title = tr('うごくノート2')
  prefs_load()
  dispatch('project.boot_prefs', { mobile: detect_mobile(), marks: [], custom: [] })
  marks_load()
  shell_build(root)
  tr_dom(root)
  dispatch('project.boot_empty', null)
  doc_boot_size()
  doc_unpack_live()
  sync_mount()
  responsive_mount()
  panels_mount()
  input_mount()
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
  const menuSeen = embedded || storage_get('ug2_menuseen') === '1' ? 1 : 0
  if (!menuSeen) q('menuBtn').classList.add('pulse')
  store_boot(loaded => {
    dispatch('project.set_booted', null)
    if (loaded) toast('まえのつづきから再開したよ')
    dirty(D_ALL)
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
  if (!(globalThis as { __UG2_WORKER_SRC?: string }).__UG2_WORKER_SRC && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(error => report_warning('Service Workerの登録に失敗しました', error))
  }
  q('title').setAttribute('placeholder', 'ノートの名前')
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
