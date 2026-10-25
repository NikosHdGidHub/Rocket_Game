/* ================================================================
   fpsMonitor.js — мониторинг среднего FPS за скользящее окно.

   — Окно 5 сек, усреднение по всем кадрам в нём.
   — Warmup 4 сек после init() (компиляция шейдеров, первый чанк).
   — Пропуск, пока document.hidden (вкладка неактивна → rAF стоит).
   — Колбэк onLow срабатывает только при СМЕНЕ уровня
     (null → warn/critical, warn ↔ critical), не каждый кадр.
   — Два порога: < 53 (warn), < 40 (critical).
================================================================ */
const WINDOW_MS = 5000
const WARMUP_MS = 4000
const CHECK_INTERVAL_MS = 1000
const WARN_THRESHOLD = 53
const CRITICAL_THRESHOLD = 40
const MIN_SAMPLES = 10

let _samples = []
let _startedAt = 0
let _lastCheckAt = 0
let _active = false
let _lastLevel = null // 'warn' | 'critical' | null
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
  if (realDtMs <= 0 || realDtMs > 1000) return // отсекаем «залипшие» кадры

  const now = performance.now()
  _samples.push({ t: now, dtMs: realDtMs })

  const cutoff = now - WINDOW_MS
  while (_samples.length > 0 && _samples[0].t < cutoff) _samples.shift()

  if (now - _lastCheckAt >= CHECK_INTERVAL_MS) {
    _lastCheckAt = now
    check()
  }
}

function check() {
  if (performance.now() - _startedAt < WARMUP_MS) return
  if (_samples.length < MIN_SAMPLES) return

  let sum = 0
  for (let i = 0; i < _samples.length; i++) sum += _samples[i].dtMs
  const avgDt = sum / _samples.length
  if (avgDt <= 0) return
  const avgFps = 1000 / avgDt

  if (_onAverage) _onAverage(avgFps)

  let level = null
  if (avgFps < CRITICAL_THRESHOLD) level = 'critical'
  else if (avgFps < WARN_THRESHOLD) level = 'warn'

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
    // после возврата вкладки — небольшая пауза, чтобы не ловить выбросы
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
