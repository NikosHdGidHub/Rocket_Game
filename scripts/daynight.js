/* ================================================================
   daynight.js — смена дня и ночи: плавная интерполяция неба, света,
   тумана и направления солнца по расписанию из config.js.

   Все настройки (цвета, тайминги, азимут) — в CFG.DAYNIGHT.
   Состояние цикла сохраняется в localStorage (отдельный ключ).
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'
import {
  scene,
  sun,
  hemiLight,
  groundMat,
  SUN_DIR,
  SKY_ZENITH,
  SKY_HORIZON,
  SUN_COLOR,
} from './scene.js'
import { propMat } from './chunks.js'

const DN = CFG.DAYNIGHT

/* ---------- Состояние ---------- */
let _cycleStartMs = Date.now()
let _suppressSave = false // true — pagehide не пишет ключ обратно (reset в процессе)

/* ---------- SAVE / LOAD ---------- */

/** Стартовый момент цикла: Date.now() сдвинутый так, чтобы
    currentT() немедленно вернул нужное t (секунды внутри цикла). */
function initialStartMs() {
  const t0 = DN.initialTime ?? 0
  return Date.now() - t0 * 1000
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(DN.saveKey)
    if (!raw) return initialStartMs()
    const data = JSON.parse(raw)
    if (data && typeof data.cycleStartMs === 'number' && isFinite(data.cycleStartMs)) {
      return data.cycleStartMs
    }
  } catch (e) {
    console.warn('daynight.load failed:', e)
  }
  return initialStartMs()
}

function saveState() {
  if (_suppressSave) return
  try {
    localStorage.setItem(DN.saveKey, JSON.stringify({ cycleStartMs: _cycleStartMs }))
  } catch (e) {
    console.warn('daynight.save failed:', e)
  }
}

/* ---------- init / reset ---------- */
export function init() {
  if (!DN.enabled) return
  _cycleStartMs = loadSaved()
  // Сразу применяем — чтобы загрузочный экран был уже «в нужное время суток».
  applyAt(currentT())
  window.addEventListener('pagehide', saveState)
}

export function reset() {
  _suppressSave = true

  try {
    localStorage.removeItem(DN.saveKey)
  } catch (e) {}
  _cycleStartMs = initialStartMs()
}

/* ---------- update ---------- */
let _lastLogSec = -1

export function update(_dt) {
  if (!DN.enabled) return
  const t = currentT()
  applyAt(t)

  if (DN.debugLog) {
    const sec = Math.floor(t)
    if (sec !== _lastLogSec) {
      _lastLogSec = sec
      const total = cycleLength()
      const θ = sunAngleAt(t)
      const sinθ = Math.sin(θ)
      const A = DN.sunArc
      const elev = sinθ >= 0 ? sinθ * A.maxElevation : sinθ * Math.abs(A.minElevation)
      const pct = ((t / total) * 100).toFixed(0)
      console.log(`[DayNight] t=${sec}s / ${total}s (${pct}%) el=${elev.toFixed(0)}°`)
    }
  }
}

/** Длина цикла = at последнего keyframe. Так нельзя случайно
    забыть обновить cycleSeconds при правке расписания. */
function cycleLength() {
  const KFs = DN.keyframes
  return KFs[KFs.length - 1].at
}

/** Полярный угол θ для момента t.
    День: θ растёт 0 → π за dayDuration секунд.
    Ночь: θ растёт π → 2π за (total − dayDuration) секунд.
    θ=0 — восход, θ=π/2 — полдень, θ=π — закат, θ=3π/2 — полночь. */
function sunAngleAt(t) {
  const total = cycleLength()
  const dayDur = DN.sunArc.dayDuration
  const nightDur = Math.max(1, total - dayDur)
  if (t < dayDur) {
    return Math.PI * (t / dayDur)
  }
  return Math.PI + Math.PI * ((t - dayDur) / nightDur)
}

function currentT() {
  const elapsed = (Date.now() - _cycleStartMs) / 1000
  const total = cycleLength()
  return ((elapsed % total) + total) % total
}

/* ---------- Рабочие цвета (создаются один раз) ---------- */
const _zen = new THREE.Color()
const _hor = new THREE.Color()
const _sunCol = new THREE.Color()
const _hemiSky = new THREE.Color()
const _hemiGround = new THREE.Color()

function applyAt(t) {
  const θ = sunAngleAt(t)
  const sinθ = Math.sin(θ)
  const cosθ = Math.cos(θ)

  // Положение солнца — из дуги, не из пресетов
  const A = DN.sunArc
  const sunEl = sinθ >= 0 ? sinθ * A.maxElevation : sinθ * Math.abs(A.minElevation)
  const sunAz = A.azimuthBase + A.azimuthSwing * cosθ

  // Цвета — интерполируем по keyframes (как раньше)
  const KFs = DN.keyframes
  let k0 = KFs[0]
  let k1 = KFs[KFs.length - 1]
  for (let i = 0; i < KFs.length - 1; i++) {
    if (t >= KFs[i].at && t < KFs[i + 1].at) {
      k0 = KFs[i]
      k1 = KFs[i + 1]
      break
    }
  }

  // Смешивание k0 → k1. Если заданы blendFrom/blendTo — используем их,
  // иначе ведём линейную интерполяцию от k0.at до k1.at (прежнее поведение).
  const blendFrom = k1.blendFrom ?? k0.at
  const blendTo = k1.blendTo ?? k1.at
  const blendSpan = blendTo - blendFrom
  let a = 0
  if (t >= blendTo) a = 1
  else if (t >= blendFrom) a = blendSpan > 0 ? (t - blendFrom) / blendSpan : 1
  // иначе (t < blendFrom) — a остаётся 0 (держим предыдущий пресет)

  const P0 = DN.presets[k0.preset]
  const P1 = DN.presets[k1.preset]

  _zen.setHex(lerpHex(P0.zenith, P1.zenith, a))
  _hor.setHex(lerpHex(P0.horizon, P1.horizon, a))
  _sunCol.setHex(lerpHex(P0.sunColor, P1.sunColor, a))
  _hemiSky.setHex(lerpHex(P0.hemiSky, P1.hemiSky, a))
  _hemiGround.setHex(lerpHex(P0.hemiGround, P1.hemiGround, a))

  const sunI = lerp(P0.sunIntensity, P1.sunIntensity, a)
  const hemiI = lerp(P0.hemiIntensity, P1.hemiIntensity, a)

  // nightness — из высоты солнца
  const nightness = nightnessFromElevation(sunEl)

  const skyB = nightCurve(nightness, DN.brightnessNightSky)
  const terrainB = nightCurve(nightness, DN.brightnessNightTerrain)
  const propsB = nightCurve(nightness, DN.brightnessNightProps)

  _zen.multiplyScalar(skyB)
  _hor.multiplyScalar(skyB)

  SKY_ZENITH.copy(_zen)
  SKY_HORIZON.copy(_hor)

  // Визуальный солнечный диск (шейдер неба + шейдеры тумана) гаснет,
  // когда солнце уходит под горизонт. Иначе на фоне ночного неба
  // и в тумане остаётся яркое пятно.
  const fadeDeg = DN.sunArc.sunFadeDegrees ?? 10
  const sunVis = sunEl >= 0 ? 1 : Math.max(0, 1 + sunEl / Math.max(0.1, fadeDeg))
  SUN_COLOR.copy(_sunCol).multiplyScalar(sunVis)

  // Направленный свет (DirectionalLight) остаётся своего цвета —
  // его яркость гаснет отдельно через sunIntensity из пресета.
  // Это даёт мягкий «лунный» ambient ночью.
  sun.color.copy(_sunCol)
  sun.intensity = sunI

  if (hemiLight) {
    hemiLight.color.copy(_hemiSky)
    hemiLight.groundColor.copy(_hemiGround)
    hemiLight.intensity = hemiI
  }

  scene.fog.color.copy(_hor)

  if (groundMat) groundMat.color.setRGB(terrainB, terrainB, terrainB)
  if (propMat) propMat.color.setRGB(propsB, propsB, propsB)

  // Направление солнца
  const el = (sunEl * Math.PI) / 180
  const az = (sunAz * Math.PI) / 180
  const cosEl = Math.cos(el)
  SUN_DIR.set(cosEl * Math.cos(az), Math.sin(el), cosEl * Math.sin(az))
}

/** nightness из высоты солнца:
      el ≥ 0° → темнеет максимум на above (по умолчанию 0.15)
      el < 0° → за ramp° градусов догоняет до 1.0 */
function nightnessFromElevation(el) {
  const above = DN.darknessAboveHorizon ?? 0.15
  const ramp = DN.darknessRampDegrees ?? 20
  if (el >= 0) {
    const t = Math.min(1, el / 60)
    return above * (1 - t)
  }
  const t = Math.min(1, -el / ramp)
  return above + (1 - above) * t
}

/* ---------- Хелперы ---------- */
function lerp(a, b, t) {
  return a + (b - a) * t
}

function lerpHex(ha, hb, t) {
  const ar = (ha >> 16) & 0xff
  const ag = (ha >> 8) & 0xff
  const ab = ha & 0xff
  const br = (hb >> 16) & 0xff
  const bg = (hb >> 8) & 0xff
  const bb = hb & 0xff
  const r = Math.round(ar + (br - ar) * t)
  const g = Math.round(ag + (bg - ag) * t)
  const b = Math.round(ab + (bb - ab) * t)
  return (r << 16) | (g << 8) | b
}

function nightCurve(n, target) {
  return 1 - n + n * target
}

/* ---------- Debug ---------- */
export function debug() {
  const t = currentT()
  const total = cycleLength()
  const θ = sunAngleAt(t)
  const sinθ = Math.sin(θ)
  const A = DN.sunArc
  const el = sinθ >= 0 ? sinθ * A.maxElevation : sinθ * Math.abs(A.minElevation)
  console.log(
    `[DayNight] t=${t.toFixed(1)}s / ${total}s  el=${el.toFixed(0)}°  ` +
      `start=${new Date(_cycleStartMs).toLocaleTimeString()}`
  )
  return { t, total, elevation: el, cycleStartMs: _cycleStartMs }
}
/** Перепрыгнуть к нужной точке цикла (для отладки).
    window.dbgSetDayTime(360) → пик заката. */
export function debugSetTime(t) {
  _cycleStartMs = Date.now() - t * 1000
  applyAt(currentT())
  saveState()
}
