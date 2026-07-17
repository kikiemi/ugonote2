import { report_error, report_warning } from './diagnostics'
import { doc_boot_size, doc_unpack_live } from './doc'
import { q, toast } from './dom'
import { D_ALL } from './h'
import { input_mount } from './input'
import { tr_dom } from './lang'
import { marks_load } from './mark'
import { panels_mount, modal_firstrun } from './panels'
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
      return { w: wrap.clientWidth, h: wrap.clientHeight }
    },
  })
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
  const menuSeen = storage_get('ug2_menuseen') === '1' ? 1 : 0
  if (!menuSeen) q('menuBtn').classList.add('pulse')
  store_boot(loaded => {
    dispatch('project.set_booted', null)
    if (loaded) toast('まえのつづきから再開したよ')
    dirty(D_ALL)
    const seen = storage_get('ug2_seen') === '1' ? 1 : 0
    requestAnimationFrame(() => {
      dispatch('view.fit', null)
      if (!loaded && !seen) {
        modal_firstrun(() => {
          storage_set('ug2_seen', '1')
          requestAnimationFrame(() => {
            dispatch('view.fit', null)
            tut_offer()
          })
        })
      } else {
        storage_set('ug2_seen', '1')
        tut_offer()
      }
    })
  })
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(error => report_warning('Service Workerの登録に失敗しました', error))
  }
  q('title').setAttribute('placeholder', 'ノートの名前')
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
else boot()
