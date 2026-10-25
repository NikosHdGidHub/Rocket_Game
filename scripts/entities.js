/* ================================================================
   entities.js — визуальные меши: босс, ракета, сундуки.
   Экспортирует ссылки на меши (для game.js) + init().
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'
import { scene } from './scene.js'
import { G } from './state.js'
import { terrainHeight, hash2i } from './world/world.js'

/* ================================================================
   BOSS
================================================================ */
export const boss = new THREE.Group()
boss.position.set(...CFG.BOSS.position)

const skinMat = new THREE.MeshStandardMaterial({ color: CFG.BOSS.colors.skin, roughness: 0.55 })
const darkMat = new THREE.MeshStandardMaterial({ color: CFG.BOSS.colors.dark, roughness: 0.8 })
const accentMat = new THREE.MeshStandardMaterial({
  color: CFG.BOSS.colors.accent,
  roughness: 0.4,
  metalness: 0.3,
})

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

export const torso = box(2.0, 2.4, 1.4, skinMat)
torso.position.y = 3.8
boss.add(torso)

const chest = box(1.1, 0.9, 0.15, accentMat)
chest.position.set(0, 4.0, 0.75)
boss.add(chest)

export const head = box(1.25, 1.2, 1.2, skinMat)
head.position.y = 5.7
boss.add(head)

for (const zz of [0.62, -0.62]) {
  const eye = box(0.3, 0.22, 0.1, darkMat)
  eye.position.set(0.3, 5.85, zz)
  boss.add(eye)
}
const brow = box(0.36, 0.1, 0.12, darkMat)
brow.position.set(0.32, 6.05, 0.62)
brow.rotation.z = -0.35
boss.add(brow)
const brow2 = brow.clone()
brow2.position.z = -0.62
brow2.rotation.z = 0.35
boss.add(brow2)

const armL = box(0.55, 2.1, 0.55, skinMat)
armL.geometry.translate(0, -1.05, 0)
armL.position.set(0, 4.7, 1.05)
boss.add(armL)

const armR = box(0.55, 2.1, 0.55, skinMat)
armR.geometry.translate(0, -1.05, 0)
armR.position.set(0, 4.7, -1.05)
boss.add(armR)

function makeLeg() {
  const pivot = new THREE.Group()
  const upper = box(0.72, 1.4, 0.72, darkMat)
  upper.position.y = -0.7
  pivot.add(upper)
  const lower = box(0.62, 1.3, 0.62, darkMat)
  lower.position.y = -2.0
  pivot.add(lower)
  const foot = box(0.85, 0.4, 0.95, accentMat)
  foot.position.set(0.18, -2.75, 0)
  pivot.add(foot)
  return pivot
}

export const legBack = makeLeg()
legBack.position.set(0, 2.6, -0.5)
boss.add(legBack)

export const legKick = makeLeg()
legKick.position.set(0, 2.6, 0.5)
boss.add(legKick)

scene.add(boss)

/* ================================================================
   ROCKET
================================================================ */
export const rocket = new THREE.Group()

const bodyMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.body,
  metalness: 0.55,
  roughness: 0.3,
})
const redMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.red,
  metalness: 0.3,
  roughness: 0.45,
})
const glassMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.glass,
  metalness: 0.9,
  roughness: 0.15,
})
const rocketDarkMat = new THREE.MeshStandardMaterial({
  color: CFG.BOSS.colors.dark,
  roughness: 0.8,
})

const rBody = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 2.2, 16), bodyMat)
rBody.rotation.z = Math.PI / 2
rBody.castShadow = true
rocket.add(rBody)

const rNose = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.0, 16), redMat)
rNose.rotation.z = -Math.PI / 2
rNose.position.x = 1.6
rNose.castShadow = true
rocket.add(rNose)

const port = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12), glassMat)
port.rotation.x = Math.PI / 2
port.position.set(0.5, 0.3, 0.33)
rocket.add(port)

const finShape = new THREE.Shape()
finShape.moveTo(0, 0)
finShape.lineTo(-1.0, 0)
finShape.lineTo(-1.0, 0.55)
finShape.closePath()
const finGeo = new THREE.ExtrudeGeometry(finShape, { depth: 0.07, bevelEnabled: false })
finGeo.translate(0, 0, -0.035)

for (const sgn of [1, -1]) {
  const fin = new THREE.Mesh(finGeo, redMat)
  fin.position.set(-0.35, 0.34 * sgn, 0)
  fin.scale.y = sgn
  fin.castShadow = true
  rocket.add(fin)
}

const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 0.5, 14), rocketDarkMat)
nozzle.rotation.z = Math.PI / 2
nozzle.position.x = -1.25
rocket.add(nozzle)

export const flameMat = new THREE.MeshBasicMaterial({
  color: CFG.ROCKET.flame.outer,
  transparent: true,
  opacity: 0.95,
})
export const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.4, 12), flameMat)
flame.name = 'rocketFlame'
flame.rotation.z = Math.PI / 2
flame.position.x = -2.1
flame.castShadow = false
rocket.add(flame)

export const flameInner = new THREE.Mesh(
  new THREE.ConeGeometry(0.2, 0.9, 10),
  new THREE.MeshBasicMaterial({ color: CFG.ROCKET.flame.inner })
)
flameInner.name = 'rocketFlameInner'
flameInner.rotation.z = Math.PI / 2
flameInner.position.x = -1.85
flameInner.castShadow = false
rocket.add(flameInner)

export const exhaustLight = new THREE.PointLight(CFG.ROCKET.exhaustLight, 0, 14)
exhaustLight.position.set(-2.0, 0, 0)
rocket.add(exhaustLight)

scene.add(rocket)

/* ================================================================
   CHESTS
================================================================ */
export const chestGroup = new THREE.Group()
scene.add(chestGroup)

export const chests = [] // { x, z, group, beam, glow, opened }

/* ---------- Общие материалы корпуса и окантовки (один раз на всех) ---------- */
const chestBodyMat = new THREE.MeshStandardMaterial({
  color: 0x6b3a14,
  roughness: 0.7,
  metalness: 0.1,
})
const chestTrimMat = new THREE.MeshStandardMaterial({
  color: 0xffd75e,
  roughness: 0.35,
  metalness: 0.8,
  emissive: 0xffb300,
  emissiveIntensity: 0.6,
})

/* ---------- Материалы beam/glow по типам (лениво) ---------- */
const chestMats = {} // type → { beam, glow }

function getChestMats(type) {
  if (chestMats[type]) return chestMats[type]
  const override = CFG.CHESTS.types[type] || {}
  const beamColor = override.beamColor ?? CFG.CHESTS.beamColor
  const glowColor = override.glowColor ?? CFG.CHESTS.glowColor

  const beam = new THREE.MeshBasicMaterial({
    color: beamColor,
    transparent: true,
    opacity: CFG.CHESTS.beamOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  })
  const glow = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })

  chestMats[type] = { beam, glow }
  return chestMats[type]
}

/* ---------- Один общий источник света, «переезжает» к ближайшему сундуку ---------- */
const chestLight = new THREE.PointLight(CFG.CHESTS.glowColor, 0, 40)
scene.add(chestLight)
chestLight.visible = false

/* ---------- Геометрии — общие для всех сундуков ---------- */
const bodyGeo = new THREE.BoxGeometry(2.4, 1.4, 1.6)
const trimGeo = new THREE.BoxGeometry(2.5, 1.5, 0.12)
const lidGeo = new THREE.BoxGeometry(2.5, 0.5, 1.7)
const lockGeo = new THREE.BoxGeometry(0.4, 0.5, 0.15)
const beamGeo = new THREE.CylinderGeometry(
  CFG.CHESTS.beamRadius,
  CFG.CHESTS.beamRadius * 1.8,
  CFG.CHESTS.beamHeight,
  12,
  1,
  true
)
const glowGeo = new THREE.SphereGeometry(2.2, 12, 10)

function buildChestMesh(x, z, type) {
  const g = new THREE.Group()
  const mats = getChestMats(type)

  const body = new THREE.Mesh(bodyGeo, chestBodyMat)
  body.position.y = 0.7
  body.castShadow = true
  g.add(body)

  for (const dz of [-0.55, 0.55]) {
    const b = new THREE.Mesh(trimGeo, chestTrimMat)
    b.position.set(0, 0.7, dz)
    g.add(b)
  }

  const lid = new THREE.Mesh(lidGeo, chestBodyMat)
  lid.position.set(0, 1.6, 0)
  lid.castShadow = true
  g.add(lid)

  const lock = new THREE.Mesh(lockGeo, chestTrimMat)
  lock.position.set(0, 0.85, 0.85)
  g.add(lock)

  const beam = new THREE.Mesh(beamGeo, mats.beam)
  beam.position.y = CFG.CHESTS.beamHeight / 2
  beam.renderOrder = 5
  g.add(beam)

  const glow = new THREE.Mesh(glowGeo, mats.glow)
  glow.position.y = 1.2
  glow.renderOrder = 4
  g.add(glow)

  g.position.set(x, terrainHeight(x, z), z)
  return { group: g, beam, glow }
}

/** Z-координата сундука — детерминированная (стабильна между сессиями). */
function chestZ(x) {
  const yaw = CFG.GAME.flightYaw || 0
  const h = hash2i(x | 0, 0x7f1a)
  const r = (h & 0xffff) / 0xffff
  return x * Math.tan(yaw) + r * 2.0 * CFG.CHESTS.zOffset - CFG.CHESTS.zOffset
}

export function initChests() {
  for (const x of CFG.CHESTS.allPositions) {
    const z = chestZ(x)
    const type = CFG.CHESTS.specialChests[x] || 'random'
    const opened = G.openedChests.has(x)
    const { group, beam, glow } = buildChestMesh(x, z, type)
    group.visible = !opened
    chestGroup.add(group)
    chests.push({ x, z, group, beam, glow, opened, type })
  }
}

/**
 * Синхронизирует флаги открытых сундуков с G.openedChests.
 * Нужно потому, что initChests() выполняется ДО loadProgress() —
 * на момент создания chests[] массив G.openedChests ещё пуст.
 */
export function resyncChests() {
  for (const c of chests) {
    c.opened = G.openedChests.has(c.x)
    c.group.visible = !c.opened
  }
}

/* ================================================================
   Обновление анимации сундуков (вызывается из game.update).
   Возвращает свет, который нужно переставить. Экономно: не чаще
   8 итераций в кадр, все вычисления — простые mul/add.
================================================================ */
export function updateChests(dt, rx, rz) {
  const t = performance.now() * 0.001

  // Глобальная пульсация всех beam-материалов
  const pulse = CFG.CHESTS.beamOpacity * (0.75 + Math.sin(t * 2) * 0.25)
  for (const mats of Object.values(chestMats)) {
    mats.beam.opacity = pulse
  }

  let nearest = null
  let nearestD2 = Infinity

  for (const c of chests) {
    if (c.opened) continue
    const dx = rx - c.x
    const dz = rz - c.z
    const d2 = dx * dx + dz * dz
    if (d2 < nearestD2) {
      nearestD2 = d2
      nearest = c
    }
    const dist = Math.sqrt(d2)
    const near = Math.max(0, 1 - dist / CFG.CHESTS.nearRadius)
    c.glow.scale.setScalar(1 + near * 0.6)
  }

  const R = 500
  if (nearest && nearestD2 < R * R) {
    const override = CFG.CHESTS.types[nearest.type] || {}
    const glowColor = override.glowColor ?? CFG.CHESTS.glowColor
    chestLight.color.setHex(glowColor)
    const gy = terrainHeight(nearest.x, nearest.z)
    chestLight.position.set(nearest.x, gy + 2.0, nearest.z)
    chestLight.intensity = CFG.CHESTS.glowIntensity * 2
    chestLight.visible = true
  } else {
    chestLight.visible = false
  }
}

/* ================================================================
   GHOST ROCKET — призрак лучшего полёта.
   Клон настоящей ракеты, но с MeshBasicMaterial:
     • не участвует в освещении (ни sun, ни hemi, ни fog),
     • не отбрасывает/принимает тени,
     • не имеет PointLight (никаких Light в сцене дополнительно).
================================================================ */
let _ghostFlameOuter = null
let _ghostFlameInner = null

function buildGhostRocket() {
  const G = CFG.ROCKET.ghost
  const ghost = rocket.clone(true)

  // Удаляем клонированный exhaustLight — нам не нужен ещё один Light в сцене.
  for (let i = ghost.children.length - 1; i >= 0; i--) {
    if (ghost.children[i].isLight) ghost.remove(ghost.children[i])
  }

  // Материалы-«призраки» (создаются один раз).
  const bodyMat = new THREE.MeshBasicMaterial({
    color: G.color,
    transparent: true,
    opacity: G.opacity,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  })

  const flameMat = new THREE.MeshBasicMaterial({
    color: G.flameColor,
    transparent: true,
    opacity: G.flameOpacity,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })

  const flameInnerMat = new THREE.MeshBasicMaterial({
    color: G.flameInnerColor,
    transparent: true,
    opacity: G.flameInnerOpacity,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  })

  // Клонированные ссылки на пламя (по именам, заданным на оригинале).
  _ghostFlameOuter = ghost.getObjectByName('rocketFlame')
  _ghostFlameInner = ghost.getObjectByName('rocketFlameInner')

  // Заменяем материалы и отключаем тени у всех мешей.
  ghost.traverse((c) => {
    if (!c.isMesh) return
    c.castShadow = false
    c.receiveShadow = false
    if (c === _ghostFlameOuter) c.material = flameMat
    else if (c === _ghostFlameInner) c.material = flameInnerMat
    else c.material = bodyMat
  })

  ghost.renderOrder = 3 // после обычной геометрии, до сундуков (4, 5)
  ghost.visible = false
  ghost.rotation.y = -CFG.GAME.flightYaw // константа полёта
  return ghost
}

export const ghostRocket = buildGhostRocket()
scene.add(ghostRocket)

const _STRIDE = 6 // [t, x, y, z, rotZ, boost]

/**
 * Воспроизведение призрака.
 * @param {Float32Array|null} samples  данные лучшего полёта (null = скрыть)
 * @param {number} t                   секунды от начала текущего полёта
 */
export function updateGhostRocket(samples, t) {
  if (!samples || samples.length < _STRIDE * 2) {
    ghostRocket.visible = false
    return
  }

  const n = samples.length / _STRIDE

  // Дошли до конца траектории — прячем
  if (t < samples[0]) {
    ghostRocket.visible = false
    return
  }

  // Бинарный поиск: последний sample с s[i*STRIDE] <= t
  let lo = 0,
    hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (samples[mid * _STRIDE] <= t) lo = mid
    else hi = mid - 1
  }
  if (lo >= n - 1) {
    ghostRocket.visible = false
    return
  }

  const i0 = lo * _STRIDE
  const i1 = (lo + 1) * _STRIDE
  const tA = samples[i0]
  const tB = samples[i1]
  const a = tB > tA ? (t - tA) / (tB - tA) : 0
  const lerp = (p, q, k) => p + (q - p) * k

  ghostRocket.visible = true
  ghostRocket.position.set(
    lerp(samples[i0 + 1], samples[i1 + 1], a),
    lerp(samples[i0 + 2], samples[i1 + 2], a),
    lerp(samples[i0 + 3], samples[i1 + 3], a)
  )
  ghostRocket.rotation.z = lerp(samples[i0 + 4], samples[i1 + 4], a)
  // rotation.y — константа, задана при build.

  const boostA = samples[i0 + 5]
  const boostB = samples[i1 + 5]
  const boosting = boostA + (boostB - boostA) * a > 0.5
  if (_ghostFlameOuter) _ghostFlameOuter.visible = boosting
  if (_ghostFlameInner) _ghostFlameInner.visible = boosting
}

/* ================================================================
   init — создать все меши (вызывается один раз из main).
================================================================ */
export function init() {
  initChests()
}
