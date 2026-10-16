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

/* ---------- SAVE / LOAD ---------- */
function loadSaved() {
  try {
    const raw = localStorage.getItem(DN.saveKey)
    if (!raw) return Date.now()
    const data = JSON.parse(raw)
    if (data && typeof data.cycleStartMs === 'number' && isFinite(data.cycleStartMs)) {
      return data.cycleStartMs
    }
  } catch (e) {
    console.warn('daynight.load failed:', e)
  }
  return Date.now()
}

function saveState() {
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
  try {
    localStorage.removeItem(DN.saveKey)
  } catch (e) {}
  _cycleStartMs = Date.now()
}

/* ---------- update ---------- */
export function update(_dt) {
  if (!DN.enabled) return
  applyAt(currentT())
}

/** Длина цикла = at последнего keyframe. Так нельзя случайно
    забыть обновить cycleSeconds при правке расписания. */
function cycleLength() {
  const KFs = DN.keyframes
  return KFs[KFs.length - 1].at
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
  // Находим обрамляющие keyframes
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
  const span = k1.at - k0.at
  const a = span > 0 ? (t - k0.at) / span : 0

  const P0 = DN.presets[k0.preset]
  const P1 = DN.presets[k1.preset]

  // Интерполяция (по hex, потом в THREE.Color — сохраняет sRGB→linear)
  _zen.setHex(lerpHex(P0.zenith, P1.zenith, a))
  _hor.setHex(lerpHex(P0.horizon, P1.horizon, a))
  _sunCol.setHex(lerpHex(P0.sunColor, P1.sunColor, a))
  _hemiSky.setHex(lerpHex(P0.hemiSky, P1.hemiSky, a))
  _hemiGround.setHex(lerpHex(P0.hemiGround, P1.hemiGround, a))

  const sunI = lerp(P0.sunIntensity, P1.sunIntensity, a)
  const hemiI = lerp(P0.hemiIntensity, P1.hemiIntensity, a)
  const sunEl = lerp(P0.sunElevation, P1.sunElevation, a)
  const sunAz = lerp(P0.sunAzimuth ?? 0, P1.sunAzimuth ?? 0, a)

  // nightness больше не из пресета — считаем из высоты солнца.
  // Пока солнце над горизонтом — минимум темноты, ниже — догоняем до 1.
  const nightness = nightnessFromElevation(sunEl)

  // Ночные множители
  const skyB = nightCurve(nightness, DN.brightnessNightSky)
  const terrainB = nightCurve(nightness, DN.brightnessNightTerrain)
  const propsB = nightCurve(nightness, DN.brightnessNightProps)

  _zen.multiplyScalar(skyB)
  _hor.multiplyScalar(skyB)

  // Общие объекты неба (тянут и купол, и fog-материалы)
  SKY_ZENITH.copy(_zen)
  SKY_HORIZON.copy(_hor)
  SUN_COLOR.copy(_sunCol)

  // Свет
  sun.color.copy(_sunCol)
  sun.intensity = sunI
  if (hemiLight) {
    hemiLight.color.copy(_hemiSky)
    hemiLight.groundColor.copy(_hemiGround)
    hemiLight.intensity = hemiI
  }

  // Туман (обычный цвет = горизонт)
  scene.fog.color.copy(_hor)

  // Материалы земли/пропсов — тонируем множителем (норм — 1.0)
  if (groundMat) groundMat.color.setRGB(terrainB, terrainB, terrainB)
  if (propMat) propMat.color.setRGB(propsB, propsB, propsB)

  // Направление солнца (шейдер неба + fog-материалы)
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
  console.log(
    `[DayNight] t=${t.toFixed(1)}s / ${DN.cycleSeconds}s, ` +
      `start=${new Date(_cycleStartMs).toLocaleTimeString()}`
  )
  return { t, cycleStartMs: _cycleStartMs }
}
/** Перепрыгнуть к нужной точке цикла (для отладки).
    window.dbgSetDayTime(360) → пик заката. */
export function debugSetTime(t) {
  _cycleStartMs = Date.now() - t * 1000
  applyAt(currentT())
  saveState()
}
