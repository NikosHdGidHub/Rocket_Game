/* ================================================================
   debug.js — DEV-ONLY. В production build не попадает.
   Загружается динамически из main.js только при import.meta.env.DEV.

   Overlay с FPS-метриками (?debug в URL) + фасад над window.dbg*.
================================================================ */
import { renderer, scene } from '../views/scene.js'
import * as Chunks from '../views/chunks/index.js'
import * as Lod from '../views/lod/index.js'
import * as DayNight from '../views/daynight.js'
import * as Space from '../views/space.js'
import * as Game from '../core/game.js'
import { G, lod, rocketState } from '../state.js'
import { settings } from './settings.js'
import * as Quality from './quality.js'
import { debugTerrainProfile } from '../world/world.js'
import * as CardsModal from '../ui/cardsModal.js'

let _on = false
let _root = null

const _timers = {
  physics: 0,
  visuals: 0,
  chunks: 0,
  lod: 0,
  daynight: 0,
  space: 0,
  ui: 0,
  scenery: 0,
  render: 0,
  total: 0,
}

const _frameTimes = []
const _fpsWindow = 60
let _lastUpdate = 0

/* ================================================================
   MEMORY HISTORY — rolling window ~6 сек (24 обновления по 250 мс).
   Дельта к самому старому сэмплу показывает, растёт ли метрика.
================================================================ */
const _memHist = { geo: [], tex: [], prog: [], kids: [] }
const MEM_WINDOW = 24

function _pushHist(arr, v) {
  arr.push(v)
  if (arr.length > MEM_WINDOW) arr.shift()
}

function _deltaOf(arr) {
  if (arr.length < 2) return 0
  return arr[arr.length - 1] - arr[0]
}

/** Форматирует дельту с цветом. warnThresh — порог, после которого
 *  рост подсвечивается жёлтым (вероятная утечка). */
function _memDelta(d, warnThresh) {
  if (d === 0) return ''
  const sign = d > 0 ? '+' : ''
  const color = d > warnThresh ? '#ff9f1a' : d < 0 ? '#7dffa0' : '#c8c8c8'
  return ` <span style="color:${color}">${sign}${d}</span>`
}

/* ================================================================
   OVERLAY
================================================================ */
function _initOverlay() {
  _root = document.createElement('div')
  _root.id = '__dbgOverlay'
  _root.style.cssText = `
    position: fixed; top: 8px; right: 8px; z-index: 99999;
    background: rgba(0,0,0,0.82); color: #7dffa0;
    font: 11px/1.5 ui-monospace, monospace;
    padding: 8px 10px; border-radius: 6px; pointer-events: none;
    white-space: pre; min-width: 210px; border: 1px solid #2a4a2a;
  `
  document.body.appendChild(_root)
}

export function enabled() {
  return _on
}

export function mark(name, ms) {
  if (!_on) return
  _timers[name] = (_timers[name] || 0) * 0.85 + ms * 0.15
}

export function frame(realDtMs) {
  if (!_on) return
  _frameTimes.push(realDtMs)
  if (_frameTimes.length > _fpsWindow) _frameTimes.shift()

  const now = performance.now()
  if (now - _lastUpdate < 250) return
  _lastUpdate = now

  let sum = 0
  let max = 0
  for (const t of _frameTimes) {
    sum += t
    if (t > max) max = t
  }
  const avg = sum / _frameTimes.length
  const fps = 1000 / avg

  const info = renderer.info
  const calls = info.render.calls
  const tris = info.render.triangles

  // ─── Memory / scene ───
  const mem = info.memory
  const progN = info.programs ? info.programs.length : 0
  const kidsN = scene.children.length

  _pushHist(_memHist.geo, mem.geometries)
  _pushHist(_memHist.tex, mem.textures)
  _pushHist(_memHist.prog, progN)
  _pushHist(_memHist.kids, kidsN)

  const total = _timers.total
  const pct = (v) => (total > 0 ? Math.round((v / total) * 100) + '%' : '—')

  let html =
    `FPS:   ${fps.toFixed(1)}   (avg ${avg.toFixed(1)}ms, max ${max.toFixed(1)}ms)\n` +
    `Frame: ${total.toFixed(1)}ms\n` +
    `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
    `physics  ${_timers.physics.toFixed(2)}ms ${pct(_timers.physics)}\n` +
    `visuals  ${_timers.visuals.toFixed(2)}ms ${pct(_timers.visuals)}\n` +
    `chunks   ${_timers.chunks.toFixed(2)}ms ${pct(_timers.chunks)}\n` +
    `lod      ${_timers.lod.toFixed(2)}ms ${pct(_timers.lod)}\n` +
    `daynight ${_timers.daynight.toFixed(2)}ms\n` +
    `space    ${_timers.space.toFixed(2)}ms\n` +
    `ui       ${_timers.ui.toFixed(2)}ms\n` +
    `scenery  ${_timers.scenery.toFixed(2)}ms\n` +
    `render   ${_timers.render.toFixed(2)}ms ${pct(_timers.render)}\n` +
    `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
    `draw calls: ${calls}\n` +
    `triangles:  ${(tris / 1000).toFixed(0)}k\n` +
    `┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
    `geometries: ${mem.geometries}${_memDelta(_deltaOf(_memHist.geo), 10)}\n` +
    `textures:   ${mem.textures}${_memDelta(_deltaOf(_memHist.tex), 3)}\n` +
    `programs:   ${progN}${_memDelta(_deltaOf(_memHist.prog), 1)}\n` +
    `scene kids: ${kidsN}${_memDelta(_deltaOf(_memHist.kids), 30)}`

  try {
    const stats = window.__dbgChunks?.()
    if (stats) {
      html +=
        `\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n` +
        `chunks: ${stats.chunks}/${stats.persistentLoaded}\n` +
        `pool:   ${stats.poolBusy}/${stats.poolSize} busy\n` +
        `pending: ${stats.pending}\n` +
        `propsCache: ${stats.propsCache}`
    }
  } catch (_) {}

  // innerHTML — чтобы работали <span style="color:..."> для дельт.
  // Все вставляемые значения — числа из наших же модулей. Безопасно.
  _root.innerHTML = html
}

/* ================================================================
   window.dbg* — глобальные хелперы для консоли
================================================================ */
function _registerGlobalHelpers() {
  window.__dbgChunks = Chunks.getStats

  window.dbg = () => {
    const c = Chunks.getStats()
    const l = Lod.getStats()
    console.log(
      `chunks=${c.chunks} (persistent=${c.persistentLoaded}/${c.persistentTotal}) ` +
        `propsCache=${c.propsCache} ` +
        `farTiles=${l.farTiles} ` +
        `overlayChunks=${l.overlayChunks} ` +
        `pendingFar=${l.pendingFar} pendingOv=${l.pendingOverlays}`
    )
    console.log(
      `lodFade=${lod.fade.toFixed(2)} in2DMode=${lod.in2D} ` +
        `altSmooth=${lod.altSmooth.toFixed(0)} ` +
        `rocketX=${rocketState.pos.x.toFixed(0)} rocketY=${rocketState.pos.y.toFixed(0)}`
    )
  }

  window.dbgPersistent = () => console.table(Chunks.debugPersistent())
  window.dbgDayNight = () => DayNight.debug()
  window.dbgSetDayTime = (t) => DayNight.debugSetTime(t)
  window.dbgSpace = () => console.log(Space.debug())
  window.dbgTerrain = (xs) => debugTerrainProfile(xs)

  window.dbgQuality = () => ({
    setting: settings.quality,
    resolved: settings._resolvedPreset,
    label: Quality.getLabel(settings._resolvedPreset),
  })

  window.dbgOpenChestAt = (x) => Game.debugOpenChestAt(x)
  window.dbgGiveCard = (id, opts) => Game.giveCard(id, opts)
  window.dbgRemoveCard = (id, opts) => Game.removeCard(id, opts)
  window.dbgListCards = () => Game.listCardsDebug()
  window.dbgCanGive = (id) => {
    const r = Game.canGiveCardReason(id)
    console.log(r ? '⛔ ' + r : '✅ можно')
  }
  window.dbgGiveGems = (n = 10) => {
    G.gems += n
    Game.saveProgress()
    CardsModal.refresh()
    console.log(`+${n} 💎 → всего ${G.gems}`)
  }
  window.dbgMaxUpgrades = () => Game.giveMaxUpgrades()
}

/* ================================================================
   init
================================================================ */
export function init() {
  _on = new URLSearchParams(location.search).has('debug') || window.__dbgOn === true
  if (_on) _initOverlay()
  _registerGlobalHelpers()
}
