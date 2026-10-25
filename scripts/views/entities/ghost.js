/* ================================================================
   ghost.js — призрак лучшего полёта (клон ракеты без света и теней).
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene } from '../scene.js'
import { rocket } from './rocket.js'

let _ghostFlameOuter = null
let _ghostFlameInner = null

function buildGhostRocket() {
  const G = CFG.ROCKET.ghost
  const ghost = rocket.clone(true)

  for (let i = ghost.children.length - 1; i >= 0; i--) {
    if (ghost.children[i].isLight) ghost.remove(ghost.children[i])
  }

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

  _ghostFlameOuter = ghost.getObjectByName('rocketFlame')
  _ghostFlameInner = ghost.getObjectByName('rocketFlameInner')

  ghost.traverse((c) => {
    if (!c.isMesh) return
    c.castShadow = false
    c.receiveShadow = false
    if (c === _ghostFlameOuter) c.material = flameMat
    else if (c === _ghostFlameInner) c.material = flameInnerMat
    else c.material = bodyMat
  })

  ghost.renderOrder = 3
  ghost.visible = false
  ghost.rotation.y = -CFG.GAME.flightYaw
  return ghost
}

export const ghostRocket = buildGhostRocket()
scene.add(ghostRocket)

const _STRIDE = 6 // [t, x, y, z, rotZ, boost]

/**
 * Воспроизведение призрака.
 * @param {Float32Array|null} samples
 * @param {number} t
 */
export function updateGhostRocket(samples, t) {
  if (!samples || samples.length < _STRIDE * 2) {
    ghostRocket.visible = false
    return
  }

  const n = samples.length / _STRIDE

  if (t < samples[0]) {
    ghostRocket.visible = false
    return
  }

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

  const boostA = samples[i0 + 5]
  const boostB = samples[i1 + 5]
  const boosting = boostA + (boostB - boostA) * a > 0.5
  if (_ghostFlameOuter) _ghostFlameOuter.visible = boosting
  if (_ghostFlameInner) _ghostFlameInner.visible = boosting
}
