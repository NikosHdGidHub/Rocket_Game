/* ================================================================
   fpsMonitor.js — мониторинг среднего FPS за скользящее окно.
   Все пороги/тайминги — в config.js (CFG.FPS).
================================================================ */
import * as CFG from '../config.js'

const F = CFG.FPS

let _samples = []
let _startedAt = 0
let _lastCheckAt = 0
let _active = false
let _lastLevel = null
let _onAverage = null
let _onLow = null
let _listenerAttached = false

export function init({ onAverage, onLow } = {}) {
  _onAverage = onAverage || null
  _onLow = onLow || null
  _samples = []
  _startedAt = performance.now()
  _lastCheckAt = _startedAt
  _lastLevel = null
  _active = true

  if (!_listenerAttached) {
    _listenerAttached = true
    document.addEventListener('visibilitychange', onVisibilityChange)
  }
}

/** Вызывать каждый кадр с реальным dt в МИЛЛИСЕКУНДАХ. */
export function frame(realDtMs) {
  if (!_active) return
  if (document.hidden) {
    _samples.length = 0
    return
  }
  if (realDtMs <= 0 || realDtMs > 1000) return

  const now = performance.now()
  _samples.push({ t: now, dtMs: realDtMs })

  const cutoff = now - F.windowMs
  while (_samples.length > 0 && _samples[0].t < cutoff) _samples.shift()

  if (now - _lastCheckAt >= F.checkIntervalMs) {
    _lastCheckAt = now
    check()
  }
}

function check() {
  if (performance.now() - _startedAt < F.warmupMs) return
  if (_samples.length < F.minSamples) return

  let sum = 0
  for (let i = 0; i < _samples.length; i++) sum += _samples[i].dtMs
  const avgDt = sum / _samples.length
  if (avgDt <= 0) return
  const avgFps = 1000 / avgDt

  if (_onAverage) _onAverage(avgFps)

  let level = null
  if (avgFps < F.criticalThreshold) level = 'critical'
  else if (avgFps < F.warnThreshold) level = 'warn'

  if (level && level !== _lastLevel) {
    _lastLevel = level
    if (_onLow) _onLow(avgFps, level)
  } else if (!level && _lastLevel) {
    _lastLevel = null
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    _samples.length = 0
  } else {
    _lastCheckAt = performance.now() + 1000
  }
}

export function getAverageFps() {
  if (_samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < _samples.length; i++) sum += _samples[i].dtMs
  return 1000 / (sum / _samples.length)
}

export function reset() {
  _samples = []
  _startedAt = performance.now()
  _lastCheckAt = _startedAt
  _lastLevel = null
}
