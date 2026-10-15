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
flame.rotation.z = Math.PI / 2
flame.position.x = -2.1
rocket.add(flame)

export const flameInner = new THREE.Mesh(
  new THREE.ConeGeometry(0.2, 0.9, 10),
  new THREE.MeshBasicMaterial({ color: CFG.ROCKET.flame.inner })
)
flameInner.rotation.z = Math.PI / 2
flameInner.position.x = -1.85
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

/* ---------- Общие материалы (создаются ОДИН раз) ---------- */
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
const chestBeamMat = new THREE.MeshBasicMaterial({
  color: CFG.CHESTS.beamColor,
  transparent: true,
  opacity: CFG.CHESTS.beamOpacity,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false,
  side: THREE.DoubleSide,
})
const chestGlowMat = new THREE.MeshBasicMaterial({
  color: CFG.CHESTS.glowColor,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  fog: false,
})

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

function buildChestMesh(x, z) {
  const g = new THREE.Group()

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

  const beam = new THREE.Mesh(beamGeo, chestBeamMat)
  beam.position.y = CFG.CHESTS.beamHeight / 2
  beam.renderOrder = 5
  // frustumCulled оставляем по умолчанию = true
  g.add(beam)

  const glow = new THREE.Mesh(glowGeo, chestGlowMat)
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
  for (const x of CFG.CHESTS.xPositions) {
    const z = chestZ(x)
    const opened = G.openedChests.has(x)
    const { group, beam, glow } = buildChestMesh(x, z)
    group.visible = !opened
    chestGroup.add(group)
    chests.push({ x, z, group, beam, glow, opened })
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

  // Глобальная пульсация столба — один материал на всех
  chestBeamMat.opacity = CFG.CHESTS.beamOpacity * (0.75 + Math.sin(t * 2) * 0.25)

  // Ищем ближайший неоткрытый сундук
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

    // Пульсация размера свечения — пропорционально близости
    const dist = Math.sqrt(d2)
    const near = Math.max(0, 1 - dist / CFG.CHESTS.nearRadius)
    c.glow.scale.setScalar(1 + near * 0.6)
  }

  // Один источник света — на ближайший сундук в радиусе 500 м
  const R = 500
  if (nearest && nearestD2 < R * R) {
    const gy = terrainHeight(nearest.x, nearest.z)
    chestLight.position.set(nearest.x, gy + 2.0, nearest.z)
    chestLight.intensity = CFG.CHESTS.glowIntensity * 2
    chestLight.visible = true
  } else {
    chestLight.visible = false
  }
}

/* ================================================================
   init — создать все меши (вызывается один раз из main).
================================================================ */
export function init() {
  initChests()
}
