/* ================================================================
   debug.js — overlay с метриками производительности.
   Включается через ?debug в URL или window.__dbgOn = true
================================================================ */
import { renderer } from './views/scene.js'

let _on = false
let _root = null

// секции кадра (обновляются снаружи через mark*)
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

// rolling window
const _frameTimes = []
const _fpsWindow = 60

let _lastUpdate = 0

export function init() {
  _on = new URLSearchParams(location.search).has('debug') || window.__dbgOn === true
  if (!_on) return

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
  _timers[name] = (_timers[name] || 0) * 0.85 + ms * 0.15 // сглаживание
}

export function frame(realDtMs) {
  if (!_on) return
  _frameTimes.push(realDtMs)
  if (_frameTimes.length > _fpsWindow) _frameTimes.shift()

  const now = performance.now()
  if (now - _lastUpdate < 250) return // обновляем раз в 250 мс
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

  const total = _timers.total
  const pct = (v) => total > 0 ? Math.round((v / total) * 100) + '%' : '—'

  let text =
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
    `triangles:  ${(tris / 1000).toFixed(0)}k`

  // метрики чанков/пула — если доступны
  try {
    const stats = window.__dbgChunks?.()
    if (stats) {
      text +=
        `\nchunks: ${stats.chunks}/${stats.persistentLoaded}\n` +
        `pool:   ${stats.poolBusy}/${stats.poolSize} busy\n` +
        `pending: ${stats.pending}`
    }
  } catch (_) {}

  _root.textContent = text
}