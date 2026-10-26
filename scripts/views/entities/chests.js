/* ================================================================
   chests.js — сундуки: меши, пул лучей (cylinder/spiral), пул PointLight,
   анимация и синхронизация с G.openedChests.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene, applySkyFog } from '../scene.js'
import { G } from '../../state.js'
import { terrainHeight, hash2i } from '../../world/world.js'

export const chestGroup = new THREE.Group()
scene.add(chestGroup)

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

const _beamSlots = []
let _beamTimeSec = 0

function createSpiralMaterial(cfg) {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: false,
  })

  const uniforms = {
    uTime: { value: 0 },
    uTwist: { value: cfg.twist },
    uArms: { value: cfg.arms },
    uSharpness: { value: cfg.sharpness },
    uNoiseAmount: { value: cfg.noiseAmount },
    uNoiseScale: { value: cfg.noiseScale },
    uColorInner: { value: new THREE.Color(cfg.colorInner) },
    uColorOuter: { value: new THREE.Color(cfg.colorOuter) },
    uOpacity: { value: 1.0 },
    uPulseSpeed: { value: cfg.pulseSpeed },
    uPulseAmount: { value: cfg.pulseAmount },
  }

  mat.userData.spiralUniforms = uniforms

  applySkyFog(mat, (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `varying vec2 vSpiralUv;
void main() {
  vSpiralUv = uv;`
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform float uTime;
uniform float uTwist;
uniform float uArms;
uniform float uSharpness;
uniform float uNoiseAmount;
uniform float uNoiseScale;
uniform vec3  uColorInner;
uniform vec3  uColorOuter;
uniform float uOpacity;
uniform float uPulseSpeed;
uniform float uPulseAmount;
varying vec2 vSpiralUv;`
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `
      float su = vSpiralUv.x;
      float sv = vSpiralUv.y;
      float sAngle = su * 6.28318 * uArms;
      float sTwist = sv * uTwist + uTime;
      float sSin = sin(sAngle + sTwist);
      float spiral = pow(max(0.0, 0.5 + 0.5 * sSin), uSharpness);

      if (uNoiseAmount > 0.001) {
        vec2 np = vSpiralUv * uNoiseScale;
        float n1 = sin(np.x * 3.1 + uTime * 1.5);
        float n2 = cos(np.y * 2.7 + uTime * 0.9);
        float noise = n1 * n2 * 0.5 + 0.5;
        spiral *= mix(1.0 - uNoiseAmount, 1.0, noise);
      }

      float vfade = smoothstep(0.0, 0.08, sv) * (1.0 - smoothstep(0.6, 1.0, sv));
      float pulse = 1.0 + uPulseAmount * sin(uTime * uPulseSpeed);

      float alpha = spiral * vfade * uOpacity * pulse;
      vec3 col = mix(uColorOuter, uColorInner, spiral);

      gl_FragColor = vec4(col, alpha);
      #include <fog_fragment>
      `
    )
  })

  return mat
}

function createBeamSlot() {
  const B = CFG.CHESTS.beam
  const height = CFG.CHESTS.beamHeight

  let geo
  let mat
  let isSpiral = false
  let uniforms = null
  let animate = false
  let rotationSpeed = 1

  if (B.style === 'cylinder') {
    const c = B.cylinder
    geo = new THREE.CylinderGeometry(
      CFG.CHESTS.beamRadius,
      CFG.CHESTS.beamRadius * c.radiusTopRatio,
      height,
      c.radialSegments,
      1,
      true
    )
    geo.translate(0, height / 2, 0)
    mat = new THREE.MeshBasicMaterial({
      color: CFG.CHESTS.beamColor,
      transparent: true,
      opacity: CFG.CHESTS.beamOpacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    applySkyFog(mat)
  } else {
    const sp = B.spiral
    const simple = B.quality === 'simple'
    const cfg = simple ? { ...sp, ...sp.simple } : sp

    geo = new THREE.CylinderGeometry(
      cfg.radiusTop,
      cfg.radiusBottom,
      height,
      cfg.radialSegments,
      cfg.heightSegments,
      true
    )
    geo.translate(0, height / 2, 0)
    mat = createSpiralMaterial(cfg)
    isSpiral = true
    uniforms = mat.userData.spiralUniforms
    animate = !!cfg.animate
    rotationSpeed = cfg.rotationSpeed
  }

  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 5
  mesh.visible = false
  mesh.frustumCulled = false
  scene.add(mesh)

  return { mesh, mat, isSpiral, uniforms, animate, rotationSpeed }
}

function initBeamPool() {
  for (let i = 0; i < CFG.CHESTS.beam.poolSize; i++) {
    _beamSlots.push(createBeamSlot())
  }
}

function buildChestMesh(x, z, type) {
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

  g.position.set(x, terrainHeight(x, z), z)
  return { group: g }
}

/** Z-координата сундука — детерминированная (стабильна между сессиями). */
function chestZ(x) {
  const yaw = CFG.GAME.flightYaw || 0
  const h = hash2i(x | 0, 0x7f1a)
  const r = (h & 0xffff) / 0xffff
  return x * Math.tan(yaw) + r * 2.0 * CFG.CHESTS.zOffset - CFG.CHESTS.zOffset
}

export function initChests() {
  initBeamPool()
  for (const x of CFG.CHESTS.allPositions) {
    const z = chestZ(x)
    const type = CFG.CHESTS.specialChests[x] || 'random'
    const opened = G.openedChests.has(x)
    const { group } = buildChestMesh(x, z, type)
    group.visible = !opened
    chestGroup.add(group)
    chests.push({ x, z, group, opened, type })
  }
}

export function resyncChests() {
  for (const c of chests) {
    c.opened = G.openedChests.has(c.x)
    c.group.visible = !c.opened
  }
}

export function updateChests(dt, rx, rz) {
  _beamTimeSec += dt
  updateBeams(rx, rz)
  updateChestLights(dt, rx, rz)
}

function updateBeams(rx, rz) {
  const B = CFG.CHESTS.beam

  const candidates = []
  for (const c of chests) {
    if (c.opened) continue
    const dx = rx - c.x
    const dz = rz - c.z
    const d2 = dx * dx + dz * dz
    candidates.push({ chest: c, dist: Math.sqrt(d2) })
  }
  candidates.sort((a, b) => a.dist - b.dist)

  for (let i = 0; i < _beamSlots.length; i++) {
    const slot = _beamSlots[i]
    const cand = candidates[i]

    if (!cand || cand.dist > B.maxDistance) {
      slot.mesh.visible = false
      continue
    }

    const c = cand.chest
    const gy = terrainHeight(c.x, c.z)
    slot.mesh.position.set(c.x, gy, c.z)
    slot.mesh.visible = true

    let fade = 1
    if (cand.dist > B.fadeStart) {
      const span = Math.max(1, B.fadeEnd - B.fadeStart)
      fade = Math.max(0, 1 - (cand.dist - B.fadeStart) / span)
    }

    const override = CFG.CHESTS.types[c.type] || {}
    const baseOpacity = override.beamOpacity ?? CFG.CHESTS.beamOpacity
    const finalOpacity = baseOpacity * fade

    if (slot.isSpiral) {
      const sp = B.spiral
      const isForsage = c.type === 'forsage' && sp.forsage
      const colorInner = isForsage ? sp.forsage.colorInner : sp.colorInner
      const colorOuter = isForsage ? sp.forsage.colorOuter : sp.colorOuter

      slot.uniforms.uColorInner.value.setHex(colorInner)
      slot.uniforms.uColorOuter.value.setHex(colorOuter)
      slot.uniforms.uOpacity.value = finalOpacity

      if (slot.animate) {
        slot.uniforms.uTime.value = _beamTimeSec * slot.rotationSpeed
      } else {
        slot.uniforms.uTime.value = 0
      }
    } else {
      const color = override.beamColor ?? CFG.CHESTS.beamColor
      slot.mat.color.setHex(color)
      const pulse = 0.75 + Math.sin(_beamTimeSec * 2.0) * 0.25
      slot.mat.opacity = finalOpacity * pulse
    }
  }
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
