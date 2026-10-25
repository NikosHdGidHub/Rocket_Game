/* ================================================================
   physics.js — физика ракеты, визуал ракеты, трекер сундука, гемы.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import { G, rocketState, input, runtime } from '../state.js'
import * as Abilities from '../abilities.js'
import {
  rocket, flame, flameInner, flameMat, exhaustLight,
  chests, gems, markGemCollected,
} from '../views/entities/index.js'
import * as Angles from '../lib/angles.js'
import * as UI from '../ui/index.js'
import * as CardsModal from '../ui/cardsModal.js'
import { saveProgress } from '../services/save.js'
import { recordGhostSample } from './ghostRecorder.js'
import {
  GRAVITY, REST_Y, ANG_ACC, ANG_DAMP, ANG_MAX,
  thrustAcc, hasFlag, cardMul, dragCoefAtAngle, airDensity, gravityMul,
} from './formulas.js'
import { terrainHeight } from '../world/world.js'

const _baseFlameColor = new THREE.Color(CFG.ROCKET.flame.outer)
const _forsageFlameColor = new THREE.Color(CFG.ROCKET.flame.forsage)
const _exhaustColorNormal = new THREE.Color(CFG.ROCKET.exhaustLight)
const _exhaustColorForsage = new THREE.Color(CFG.ROCKET.exhaustLightForsage)
const _lowAltFlameColor = new THREE.Color(CFG.ROCKET.flame.backMove)
const _workingFlame = new THREE.Color()

/* ---------- Land callback (устанавливается из game.js) ---------- */
let _onLand = null
export function setLandCallback(fn) {
  _onLand = fn
}

/* ================================================================
   updateRocketPhysics
================================================================ */
export function updateRocketPhysics(dt) {
  const p = rocketState

  p.prevPos.copy(p.pos)
  p.prevVel.copy(p.vel)
  p.prevRotZ = p.rotZ

  const restY = terrainHeight(p.pos.x, p.pos.z) + REST_Y
  const forsageActive = Abilities.isActive('forsage')

  if (G.phase === 'fly') {
    const ang = p.rotZ
    const yaw = CFG.GAME.flightYaw || 0

    const engineEff = Math.max(0, 1 - Math.max(0, p.pos.y) / CFG.GAME.airEngineHeight)
    const alwaysOn = hasFlag('engineAlwaysOn')
    runtime.boosting = (alwaysOn || input.boost) && G.fuel > 0 && !forsageActive

    let appliedThrust = 0
    if (runtime.boosting) {
      appliedThrust += thrustAcc() * engineEff
      G.fuel = Math.max(0, G.fuel - dt)
    }
    if (forsageActive) {
      appliedThrust +=
        thrustAcc() * Abilities.thrustMultiplier('forsage') * cardMul('forsageThrust') * engineEff
    }

    if (appliedThrust > 0) {
      const c = Math.cos(ang)
      p.vel.x += c * Math.cos(yaw) * appliedThrust * dt
      p.vel.y += Math.sin(ang) * appliedThrust * dt
      p.vel.z += c * Math.sin(yaw) * appliedThrust * dt
    }

    p.vel.y -= GRAVITY * gravityMul() * dt

    const speed = p.vel.length()
    if (speed > 0.01) {
      const noseX = Math.cos(ang) * Math.cos(yaw)
      const noseY = Math.sin(ang)
      const noseZ = Math.cos(ang) * Math.sin(yaw)
      const dot = (noseX * p.vel.x + noseY * p.vel.y + noseZ * p.vel.z) / speed
      const alpha = Math.acos(Math.max(-1, Math.min(1, dot)))
      const k = dragCoefAtAngle(alpha) * airDensity(p.pos.y)
      const aDrag = k * speed
      p.vel.x -= p.vel.x * aDrag * dt
      p.vel.y -= p.vel.y * aDrag * dt
      p.vel.z -= p.vel.z * aDrag * dt
    }

    p.pos.addScaledVector(p.vel, dt)

    if (p.pos.y <= restY && p.vel.y < 0) {
      p.pos.y = restY
      if (_onLand) _onLand()
    }
    recordGhostSample()

    const rotInput =
      (input.keys.W || input.touch.W ? 1 : 0) - (input.keys.S || input.touch.S ? 1 : 0)
    p.angVel += rotInput * ANG_ACC * dt
    p.angVel -= p.angVel * ANG_DAMP * dt
    p.angVel = Math.max(-ANG_MAX, Math.min(ANG_MAX, p.angVel))
    p.rotZ += p.angVel * dt

    const ALIGN_RATE = CFG.GAME.aeroAlign
    const MIN_SPEED = CFG.GAME.aeroAlignMinSpeed
    const spd = p.vel.length()
    if (ALIGN_RATE > 0 && spd > MIN_SPEED) {
      const desired = Math.atan2(p.vel.y, Math.hypot(p.vel.x, p.vel.z))
      let diff = desired - p.rotZ
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const maxStep = ALIGN_RATE * dt
      const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep)
      p.rotZ += step
    }
  }
}

/* ================================================================
   updateRocketVisuals
================================================================ */
export function updateRocketVisuals(dt, irotZ, ipos, ivel) {
  const p = rocketState

  rocket.position.copy(ipos)
  rocket.rotation.z = irotZ

  if (G.phase === 'landed') {
    p.rotZ += (0 - p.rotZ) * Math.min(1, dt * 6)
    rocket.rotation.z = p.rotZ
  }

  const forsageActive = Abilities.isActive('forsage')
  let intensityMul = 1
  let targetFlame = _baseFlameColor
  let engineEff = 1

  if (G.phase === 'fly') {
    let diff = rocket.rotation.z - Math.atan2(ivel.y, ivel.x)
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    const deg = (Math.abs(diff) * 180) / Math.PI
    const angState = Angles.update(deg)
    UI.setAlignText(deg, angState)
    intensityMul = angState.flameIntensity

    engineEff = Math.max(0, 1 - Math.max(0, p.pos.y) / CFG.GAME.airEngineHeight)

    if (forsageActive) targetFlame = _forsageFlameColor
    else if (runtime.boosting) targetFlame = angState.flameColor
    else targetFlame = _baseFlameColor
  }

  const baseAmp = runtime.boosting || forsageActive ? 1 : G.phase === 'fly' ? 0.35 : 0
  const boostAmt = baseAmp * intensityMul * engineEff
  const flick = 0.85 + Math.random() * 0.3
  const flameScale = forsageActive ? CFG.ROCKET.forsageScale : 1.0

  flame.scale.setScalar(boostAmt * flick * flameScale)
  flameInner.scale.set(
    boostAmt * flick * 1.1 * flameScale,
    boostAmt * flick * flameScale,
    boostAmt * flick * flameScale
  )
  flame.visible = boostAmt > 0.05
  flameInner.visible = flame.visible

  _workingFlame.copy(targetFlame).lerp(_lowAltFlameColor, 1 - engineEff)
  flameMat.color.copy(_workingFlame)
  flameMat.opacity = runtime.boosting || forsageActive ? 0.95 : 0.5
  if (forsageActive) {
    exhaustLight.color.copy(_exhaustColorForsage)
    exhaustLight.intensity = boostAmt * CFG.ROCKET.exhaustLightIntensityForsage
    exhaustLight.distance = CFG.ROCKET.exhaustLightRangeForsage
  } else {
    exhaustLight.color.copy(_exhaustColorNormal)
    exhaustLight.intensity =
      boostAmt *
      (runtime.boosting
        ? CFG.ROCKET.exhaustLightIntensityBoost
        : CFG.ROCKET.exhaustLightIntensityIdle)
    exhaustLight.distance = CFG.ROCKET.exhaustLightRange
  }
}

/* ================================================================
   updateChestTracker — прогрессбар «до следующего сундука».
================================================================ */
export function updateChestTracker(rx, rz) {
  let nearest = null
  let nearestD2 = Infinity
  for (const c of chests) {
    if (c.opened) continue
    const dx = c.x - rx
    const dz = c.z - rz
    const d2 = dx * dx + dz * dz
    if (d2 < nearestD2) {
      nearestD2 = d2
      nearest = c
    }
  }

  if (!nearest) {
    UI.updateChestProgress(null, 0, false, false)
    return
  }

  if (nearest.x >= rx) {
    const dist = nearest.x - rx
    const progress = Math.max(0, Math.min(1, rx / Math.max(1, nearest.x)))
    UI.updateChestProgress(dist, progress, dist < CFG.CHESTS.nearRadius, false)
    return
  }

  const dist = nearest.x - rx
  if (Math.abs(dist) <= CFG.CHESTS.overRadius) {
    UI.updateChestProgress(dist, 1, false, true)
    return
  }

  let nextX = null
  for (const c of chests) {
    if (c.opened) continue
    if (c.x >= rx) {
      nextX = c.x
      break
    }
  }
  if (nextX === null) {
    UI.updateChestProgress(null, 0, false, false)
  } else {
    const d = nextX - rx
    const progress = Math.max(0, Math.min(1, rx / Math.max(1, nextX)))
    UI.updateChestProgress(d, progress, d < CFG.CHESTS.nearRadius, false)
  }
}

/* ================================================================
   Гемы
================================================================ */
export function checkGemPickup() {
  const p = rocketState.pos
  const R2 = CFG.GEMS.takeRange * CFG.GEMS.takeRange
  const toCollect = []

  for (const gem of gems) {
    if (gem.collected) continue
    const dx = p.x - gem.x
    const dy = p.y - gem.baseY
    const dz = p.z - gem.z
    if (dx * dx + dy * dy + dz * dz <= R2) {
      toCollect.push(gem)
    }
  }
  if (toCollect.length > 0) collectGems(toCollect)
}

function collectGems(gemList) {
  for (const gem of gemList) {
    gem.collected = true
    G.collectedGems.add(gem.id)
    gem.group.visible = false
    markGemCollected(gem)
    G.gems += 1
  }
  const n = gemList.length
  UI.showToast(n === 1 ? '+1 💎' : `+${n} 💎`, '#7ed4ff')
  saveProgress()
  CardsModal.refresh()
}
