/* ================================================================
   entities.js — визуальные меши: босс, ракета, сундуки.
   Экспортирует ссылки на меши (для game.js) + init().
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'
import { scene } from './scene.js'
import { G, rocketState } from './state.js'
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

export const exhaustLight = new THREE.PointLight(
  CFG.ROCKET.exhaustLight,
  0,
  CFG.ROCKET.exhaustLightRange,
  CFG.ROCKET.exhaustLightDecay
)
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

  // Glow-сферы: масштаб от близости
  for (const c of chests) {
    if (c.opened) continue
    const dx = rx - c.x
    const dz = rz - c.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const near = Math.max(0, 1 - dist / CFG.CHESTS.nearRadius)
    c.glow.scale.setScalar(1 + near * 0.6)
  }

  // Пул источников света — N ближайших неоткрытых сундуков
  updateChestLights(dt, rx, rz)
}

function updateChestLights(dt, rx, rz) {
  const L = CFG.CHESTS.lights

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
      // Свободный свет — плавно гасим
      light.intensity += (0 - light.intensity) * k
      continue
    }

    const c = cand.chest
    const override = CFG.CHESTS.types[c.type] || {}
    const glowColor = override.glowColor ?? CFG.CHESTS.glowColor
    if (light.color.getHex() !== glowColor) light.color.setHex(glowColor)

    const gy = terrainHeight(c.x, c.z)
    light.position.set(c.x, gy + L.height, c.z)
    light.intensity += (L.intensity - light.intensity) * k
  }
}

/* ================================================================
   GEMS — октаэдры с эмиссивным свечением + звездообразный glow.
   Свет — пул из N PointLight'ов, следующих за ближайшими гемами.
================================================================ */
export const gemGroup = new THREE.Group()
scene.add(gemGroup)

/** { id, index, x, z, baseY, group, mesh, collected } */
export const gems = []

/* ---------- Кристалл ---------- */
const _gemCoreGeo = new THREE.OctahedronGeometry(CFG.GEMS.size, 0)
const _gemCoreMat = new THREE.MeshStandardMaterial({
  color: CFG.GEMS.colors.core,
  emissive: CFG.GEMS.colors.emissive,
  emissiveIntensity: 1.5,
  roughness: 0.2,
  metalness: 0.6,
  flatShading: true,
})

/* ---------- Glow (Points, как у звёзд) ---------- */
let _glowPoints = null
let _glowMat = null

function buildGlowPoints() {
  const N = CFG.GEMS.xPositions.length
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(N * 3)
  const phase = new Float32Array(N)
  const collected = new Float32Array(N)
  for (let i = 0; i < N; i++) phase[i] = (i * 1.37) % 6.28

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
  geo.setAttribute('aCollected', new THREE.BufferAttribute(collected, 1))

  _glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(CFG.GEMS.glow.color) },
      uSize: { value: CFG.GEMS.glow.size },
      uOpacity: { value: CFG.GEMS.glow.opacity },
      uFalloff: { value: CFG.GEMS.glow.falloff },
      uPixelRatio: { value: Math.min(devicePixelRatio, CFG.RENDERER.pixelRatioCap) },
      uTime: { value: 0 },
      uBobHeight: { value: CFG.GEMS.bobHeight },
      uBobSpeed: { value: CFG.GEMS.bobSpeed },
      uPulseSpeed: { value: CFG.GEMS.pulseSpeed },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 0 },
      fogFar: { value: 1 },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aCollected;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uBobHeight;
      uniform float uBobSpeed;
      uniform float uPulseSpeed; 
      varying float vAlpha;
      varying float vFogDepth;
      varying float vPulse;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * uBobSpeed + aPhase) * uBobHeight;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aCollected > 0.5 ? 0.0
          : uSize * uPixelRatio * (300.0 / max(1.0, -mv.z));
        vFogDepth = -mv.z;
        vAlpha = aCollected > 0.5 ? 0.0 : 1.0;
        vPulse = 0.85 + sin(uTime * uPulseSpeed + aPhase) * 0.15;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFalloff;
      uniform float fogNear;
      uniform float fogFar;
      varying float vAlpha;
      varying float vFogDepth;
      varying float vPulse;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float falloff = 1.0 - smoothstep(0.0, 0.5, d);
        falloff = pow(falloff, uFalloff);
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        float a = uOpacity * falloff * vPulse * vAlpha * (1.0 - fogFactor);
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })

  _glowPoints = new THREE.Points(geo, _glowMat)
  _glowPoints.frustumCulled = false
  _glowPoints.renderOrder = 3
  scene.add(_glowPoints)
}

/* ---------- Пул PointLight'ов ---------- */
const _gemLightPool = []

function initGemLights() {
  const L = CFG.GEMS.lights
  for (let i = 0; i < L.count; i++) {
    const light = new THREE.PointLight(L.color, 0, L.range, 1) // ← decay = 1
    scene.add(light)
    _gemLightPool.push(light)
  }
}

/* ---------- Детерминированные позиции от seed ---------- */
function gemX(x) {
  const r = (hash2i(x, 0x9c1f) & 0xffff) / 0xffff
  return x + (r * 2 - 1) * CFG.GEMS.xPosDif
}
function gemZ(x) {
  const yaw = CFG.GAME.flightYaw || 0
  const r = (hash2i(x, 0x4e2d) & 0xffff) / 0xffff
  return x * Math.tan(yaw) + r * 2.0 * CFG.GEMS.zOffset - CFG.GEMS.zOffset
}
function gemYOffset(x) {
  const r = (hash2i(x, 0x2b8e) & 0xffff) / 0xffff
  return (r * 2 - 1) * CFG.GEMS.yPosDif
}

/* ---------- Меш гема ---------- */
function buildGemMesh(x, y, z) {
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(_gemCoreGeo, _gemCoreMat)
  g.add(mesh)
  g.position.set(x, y, z)
  return { group: g, mesh }
}

export function initGems() {
  buildGlowPoints()
  initGemLights()

  const posAttr = _glowPoints.geometry.getAttribute('position')
  const colAttr = _glowPoints.geometry.getAttribute('aCollected')
  const posArr = posAttr.array
  const colArr = colAttr.array

  let i = 0
  for (const x of CFG.GEMS.xPositions) {
    const gx = gemX(x)
    const gz = gemZ(x)
    const gy = terrainHeight(gx, gz) + CFG.GEMS.yOffset + gemYOffset(x)
    const collected = G.collectedGems.has(x)

    const { group, mesh } = buildGemMesh(gx, gy, gz)
    group.visible = !collected
    gemGroup.add(group)

    gems.push({ id: x, index: i, x: gx, z: gz, baseY: gy, group, mesh, collected })

    posArr[i * 3] = gx
    posArr[i * 3 + 1] = gy
    posArr[i * 3 + 2] = gz
    colArr[i] = collected ? 1 : 0
    i++
  }

  posAttr.needsUpdate = true
  colAttr.needsUpdate = true
}

export function resyncGems() {
  if (!_glowPoints) return
  const colAttr = _glowPoints.geometry.getAttribute('aCollected')
  const colArr = colAttr.array
  for (const gem of gems) {
    gem.collected = G.collectedGems.has(gem.id)
    gem.group.visible = !gem.collected
    colArr[gem.index] = gem.collected ? 1 : 0
  }
  colAttr.needsUpdate = true
}

/** Пометить собранным в Points (game.js вызывает при подборе). */
export function markGemCollected(gem) {
  if (!_glowPoints) return
  const colAttr = _glowPoints.geometry.getAttribute('aCollected')
  colAttr.array[gem.index] = 1
  colAttr.needsUpdate = true
}

/* ---------- Per-frame ---------- */
export function updateGems(dt) {
  const t = performance.now() * 0.001
  const G_CFG = CFG.GEMS

  // 1. Кристаллы: вращение + парение
  for (const gem of gems) {
    if (gem.collected) continue
    gem.mesh.rotation.y = t * G_CFG.rotateSpeed
    gem.mesh.rotation.x = t * G_CFG.rotateSpeed * 0.3
    const bob = Math.sin(t * G_CFG.bobSpeed + gem.id * 0.7) * G_CFG.bobHeight
    gem.group.position.y = gem.baseY + bob
  }

  // 2. Glow: time + fog uniforms (сцена меняет туман по LOD)
  if (_glowMat) {
    _glowMat.uniforms.uTime.value = t
    _glowMat.uniforms.fogColor.value.copy(scene.fog.color)
    _glowMat.uniforms.fogNear.value = scene.fog.near
    _glowMat.uniforms.fogFar.value = scene.fog.far
  }

  // 3. Пул PointLight'ов
  if (_gemLightPool.length > 0) updateGemLights(dt)
}

function updateGemLights(dt) {
  const L = CFG.GEMS.lights
  const rx = rocketState.pos.x
  const ry = rocketState.pos.y
  const rz = rocketState.pos.z

  const candidates = []
  for (const gem of gems) {
    if (gem.collected) continue
    const dx = rx - gem.x
    const dy = ry - gem.baseY
    const dz = rz - gem.z
    candidates.push({ gem, d2: dx * dx + dy * dy + dz * dz })
  }
  candidates.sort((a, b) => a.d2 - b.d2)

  const k = 1 - Math.exp(-L.fadeSpeed * dt)

  for (let i = 0; i < _gemLightPool.length; i++) {
    const light = _gemLightPool[i]
    const cand = candidates[i]

    if (!cand) {
      // Свободный свет — гасим
      light.intensity += (0 - light.intensity) * k
      continue
    }

    const gem = cand.gem
    light.position.set(gem.x, gem.baseY, gem.z)
    light.intensity += (L.intensity - light.intensity) * k
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
  initGems()
}
