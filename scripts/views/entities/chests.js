/* ================================================================
   chests.js — сундуки: меши, beam/glow по типам, пул PointLight,
   анимация и синхронизация с G.openedChests.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene } from '../scene.js'
import { G } from '../../state.js'
import { terrainHeight, hash2i } from '../../world/world.js'

export const chestGroup = new THREE.Group()
scene.add(chestGroup)

/** @type {{ x:number, z:number, group:THREE.Group, beam:any, glow:any, opened:boolean, type:string }[]} */
export const chests = []

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
const chestMats = {} // type → { beam, glow, beamOpacityBase, glowOpacityBase }

function getChestMats(type) {
  if (chestMats[type]) return chestMats[type]
  const override = CFG.CHESTS.types[type] || {}
  const beamColor = override.beamColor ?? CFG.CHESTS.beamColor
  const glowColor = override.glowColor ?? CFG.CHESTS.glowColor
  const beamOpacityBase = override.beamOpacity ?? CFG.CHESTS.beamOpacity
  const glowOpacityBase = override.glowOpacity ?? CFG.CHESTS.glowOpacity

  const beam = new THREE.MeshBasicMaterial({
    color: beamColor,
    transparent: true,
    opacity: beamOpacityBase,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  })
  const glow = new THREE.MeshBasicMaterial({
    color: glowColor,
    transparent: true,
    opacity: glowOpacityBase,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })

  chestMats[type] = { beam, glow, beamOpacityBase, glowOpacityBase }
  return chestMats[type]
}

/* ---------- Пул PointLight'ов: N всегда в сцене, гаснут через intensity ---------- */
const _chestLightPool = []
{
  const L = CFG.CHESTS.lights
  for (let i = 0; i < L.count; i++) {
    const light = new THREE.PointLight(CFG.CHESTS.glowColor, 0, L.range, L.decay)
    scene.add(light)
    _chestLightPool.push(light)
  }
}

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

export function resyncChests() {
  for (const c of chests) {
    c.opened = G.openedChests.has(c.x)
    c.group.visible = !c.opened
  }
}

export function updateChests(dt, rx, rz) {
  const t = performance.now() * 0.001

  const pulse = 0.75 + Math.sin(t * 2) * 0.25
  for (const mats of Object.values(chestMats)) {
    mats.beam.opacity = mats.beamOpacityBase * pulse
  }

  for (const c of chests) {
    if (c.opened) continue
    const dx = rx - c.x
    const dz = rz - c.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const near = Math.max(0, 1 - dist / CFG.CHESTS.nearRadius)
    c.glow.scale.setScalar(1 + near * 0.6)
  }

  updateChestLights(dt, rx, rz)
}

function updateChestLights(dt, rx, rz) {
  const L = CFG.CHESTS.lights

  let maxRange = L.range
  for (const t of Object.values(CFG.CHESTS.types)) {
    if (t.lightRange && t.lightRange > maxRange) maxRange = t.lightRange
  }

  const candidates = []
  for (const c of chests) {
    if (c.opened) continue
    const dx = rx - c.x
    const dz = rz - c.z
    const d2 = dx * dx + dz * dz
    candidates.push({ chest: c, d2 })
  }
  candidates.sort((a, b) => a.d2 - b.d2)

  const k = 1 - Math.exp(-L.fadeSpeed * dt)

  for (let i = 0; i < _chestLightPool.length; i++) {
    const light = _chestLightPool[i]
    const cand = candidates[i]

    if (!cand) {
      light.intensity += (0 - light.intensity) * k
      continue
    }

    const c = cand.chest
    const override = CFG.CHESTS.types[c.type] || {}
    const glowColor = override.glowColor ?? CFG.CHESTS.glowColor
    const intensity = override.lightIntensity ?? L.intensity
    const range = override.lightRange ?? L.range
    const height = override.lightHeight ?? L.height

    if (light.color.getHex() !== glowColor) light.color.setHex(glowColor)
    light.distance = range

    const gy = terrainHeight(c.x, c.z)
    light.position.set(c.x, gy + height, c.z)
    light.intensity += (intensity - light.intensity) * k
  }
}
