#!/usr/bin/env bash
set -e

mkdir -p scripts/core

# ============================================================
# 1. state.js — добавить runtime
# ============================================================
cat >> scripts/state.js <<'EOF'

/** Runtime flags (not persisted). */
export const runtime = {
  /** Активна ли тяга прямо сейчас (для visuals + ghostRecorder). */
  boosting: false,
}
EOF

# ============================================================
# 2. core/formulas.js
# ============================================================
cat > scripts/core/formulas.js <<'EOF'
/* ================================================================
   formulas.js — формулы с учётом апгрейдов и карточек.
   Вынесено отдельно, чтобы physics.js и game.js не зависели друг
   от друга циклически.
================================================================ */
import * as CFG from '../config.js'
import { G } from '../state.js'

export const UPGRADES = CFG.UPGRADES
export const costOf = (u) => CFG.RULES.upgradeCost(u, G.upgrades[u.key])

export const cardMul = (stat) => {
  let mult = 1
  for (const [id, count] of Object.entries(G.cards)) {
    if (!count) continue
    const card = CFG.CARDS.find((c) => c.id === id)
    if (!card || !card.effects) continue
    for (const eff of card.effects) {
      if (eff.stat === stat) mult *= Math.pow(eff.mult, count)
    }
  }
  return mult
}

export const hasFlag = (flag) => {
  for (const [id, count] of Object.entries(G.cards)) {
    if (!count) continue
    const card = CFG.CARDS.find((c) => c.id === id)
    if (card && card.flags && card.flags.includes(flag)) return true
  }
  return false
}

export const launchSpeed = () => CFG.RULES.launchSpeed(G.upgrades) * cardMul('launchSpeed')
export const maxFuel = () => CFG.RULES.maxFuel(G.upgrades) * cardMul('maxFuel')
export const thrustAcc = () => CFG.RULES.thrustAcc(G.upgrades) * cardMul('thrustAcc')
export const dragCoefAtAngle = (a) => CFG.RULES.dragCoefAtAngle(G.upgrades, a) * cardMul('drag')
export const airDensity = (y) => CFG.RULES.airDensity(y)
export const gravityMul = () => cardMul('gravity')

/* ---------- Физические константы ---------- */
export const GRAVITY = CFG.GAME.gravity
export const REST_Y = CFG.GAME.restY
export const LAUNCH_ANGLE = CFG.GAME.launchAngle
export const ANG_ACC = CFG.GAME.angAcc
export const ANG_DAMP = CFG.GAME.angDamp
export const ANG_MAX = CFG.GAME.angMax
EOF

# ============================================================
# 3. core/ghostRecorder.js
# ============================================================
cat > scripts/core/ghostRecorder.js <<'EOF'
/* ================================================================
   ghostRecorder.js — запись текущего полёта для призрака.
================================================================ */
import * as CFG from '../config.js'
import { rocketState, time, ghostRecorder, runtime } from '../state.js'
import * as Abilities from '../abilities.js'

export function startGhostRecording() {
  ghostRecorder.samples.length = 0
  ghostRecorder.recording = true
  ghostRecorder.startTime = time.gameTime
  ghostRecorder.nextSampleTime = 0
}

export function recordGhostSample() {
  const rec = ghostRecorder
  if (!rec.recording) return

  const elapsed = time.gameTime - rec.startTime
  if (elapsed >= CFG.ROCKET.recordingTimeLimit) {
    rec.recording = false
    return
  }
  if (elapsed < rec.nextSampleTime) return

  rec.nextSampleTime += 1 / CFG.ROCKET.recordingFPS

  rec.samples.push(
    elapsed,
    rocketState.pos.x,
    rocketState.pos.y,
    rocketState.pos.z,
    rocketState.rotZ,
    runtime.boosting || Abilities.isActive('forsage') ? 1 : 0
  )
}
EOF

# ============================================================
# 4. core/physics.js
# ============================================================
cat > scripts/core/physics.js <<'EOF'
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
EOF

# ============================================================
# 5. core/camera.js
# ============================================================
cat > scripts/core/camera.js <<'EOF'
/* ================================================================
   camera.js — следование камеры за ракетой.
================================================================ */
import * as CFG from '../config.js'
import { G, cam } from '../state.js'
import { camera } from '../views/scene.js'
import { terrainHeight } from '../world/world.js'

export function updateCamera(dt, ipos, ivel) {
  const gY = terrainHeight(ipos.x, 0)
  const speed = ivel.length()

  const wantBehind = G.phase === 'fly' ? 1 : 0
  const blendSpeed = wantBehind > cam.blend ? CFG.CAMERA.blendIn : CFG.CAMERA.blendOut
  cam.blend += (wantBehind - cam.blend) * Math.min(1, dt * blendSpeed)
  if (cam.blend < 0.001) cam.blend = 0
  if (cam.blend > 0.999) cam.blend = 1

  const alt = Math.max(0, ipos.y - gY)
  const altT = Math.min(1, alt / CFG.CAMERA.maxViewHeight)
  const range = CFG.CAMERA.maxAngle - CFG.CAMERA.baseAngle
  const elev = ((CFG.CAMERA.baseAngle + range * altT) * Math.PI) / 180

  const R =
    CFG.CAMERA.baseRadius + Math.min(CFG.CAMERA.maxSpeedRadius, speed * CFG.CAMERA.speedRadiusK)
  const hDist = R * Math.cos(elev)
  const vDist = R * Math.sin(elev)

  const lead = CFG.CAMERA.leadTime
  const px = ipos.x + ivel.x * lead
  const py = ipos.y + ivel.y * lead
  const pz = ipos.z + ivel.z * lead

  const camX = px - hDist * cam.blend
  const camY = py + vDist
  const camZ = pz + hDist * (1 - cam.blend)

  cam.target.set(camX, camY, camZ)

  const follow =
    CFG.CAMERA.followBase + Math.min(CFG.CAMERA.followMaxSpeed, speed * CFG.CAMERA.followSpeedK)
  const s = 1 - Math.exp(-follow * dt)

  camera.position.x += (camX - camera.position.x) * s
  camera.position.y += (camY - camera.position.y) * s
  camera.position.z += (camZ - camera.position.z) * s

  const lookAhead =
    (CFG.CAMERA.lookAheadBase + CFG.CAMERA.lookAheadBehind * cam.blend) *
    (1 - altT * CFG.CAMERA.lookAheadAltK)
  const lookX = px + lookAhead
  const lookY = py

  cam.look.x += (lookX - cam.look.x) * s
  cam.look.y += (lookY - cam.look.y) * s
  cam.look.z += (pz - cam.look.z) * s

  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * CFG.CAMERA.shakeDecayK)
    const a = cam.shake * cam.shake * CFG.CAMERA.shakeAmpK
    camera.position.x += (Math.random() - 0.5) * a
    camera.position.y += (Math.random() - 0.5) * a
  }

  camera.lookAt(cam.look)
}
EOF

# ============================================================
# 6. core/boss.js
# ============================================================
cat > scripts/core/boss.js <<'EOF'
/* ================================================================
   boss.js — анимация босса по фазе игры (только визуал).
   State-machine (updateBossPhase) живёт в game.js — она вызывает
   launch() и должна знать про flow.
================================================================ */
import { G } from '../state.js'
import { boss, torso, head, legKick, legBack } from '../views/entities/index.js'

export function updateBossAnim(dt) {
  const idle = performance.now() * 0.0022

  if (G.phase === 'ready' || G.phase === 'landed') {
    legKick.rotation.z += (0 - legKick.rotation.z) * Math.min(1, dt * 12)
    boss.position.y = Math.sin(idle) * 0.08
    torso.rotation.z = Math.sin(idle * 0.7) * 0.03
    head.rotation.z = Math.sin(idle * 0.7) * 0.05
    legBack.rotation.z = Math.sin(idle) * 0.03
  } else if (G.phase === 'windup') {
    const t = Math.min(1, G.timer / 0.3)
    const e = 1 - Math.pow(1 - t, 3)
    legKick.rotation.z = -0.85 * e
    torso.rotation.z = 0.12 * e
    boss.position.y = -0.12 * e
  } else if (G.phase === 'strike') {
    const t = Math.min(1, G.timer / 0.11)
    const e = t * t * (3 - 2 * t)
    legKick.rotation.z = -0.85 + (2.05 + 0.85) * e
    torso.rotation.z = 0.12 - 0.28 * e
    boss.position.y = -0.12 + 0.2 * e
  } else if (G.phase === 'fly') {
    legKick.rotation.z += (0 - legKick.rotation.z) * Math.min(1, dt * 6)
    torso.rotation.z += (0 - torso.rotation.z) * Math.min(1, dt * 6)
    boss.position.y += (0 - boss.position.y) * Math.min(1, dt * 6)
  }
}
EOF

# ============================================================
# 7. services/save.js
# ============================================================
cat > scripts/services/save.js <<'EOF'
/* ================================================================
   save.js — сохранение/загрузка прогресса и призрака.
================================================================ */
import * as CFG from '../config.js'
import { G, time, ghostRecorder, bestFlight } from '../state.js'
import * as Achievements from '../achievements.js'
import * as DayNight from '../views/daynight.js'
import * as UI from '../ui/index.js'

export function saveProgress() {
  if (!CFG.SAVE.autoSave) return
  try {
    const data = {
      v: CFG.SAVE.version,
      coins: G.coins,
      best: G.best,
      upgrades: { ...G.upgrades },
      cards: { ...G.cards },
      openedChests: [...G.openedChests],
      gems: G.gems,
      collectedGems: [...G.collectedGems],
      achievements: Achievements.serialize(),
      totalPlaytime: time.totalPlaytime + time.gameTime,
    }
    localStorage.setItem(CFG.SAVE.key, JSON.stringify(data))
  } catch (e) {
    console.warn('saveProgress failed:', e)
  }
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(CFG.SAVE.key)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return

    if (typeof data.coins === 'number' && isFinite(data.coins) && data.coins >= 0) {
      G.coins = Math.floor(data.coins)
    }
    if (typeof data.best === 'number' && isFinite(data.best) && data.best >= 0) {
      G.best = data.best
    }
    if (
      typeof data.totalPlaytime === 'number' &&
      isFinite(data.totalPlaytime) &&
      data.totalPlaytime >= 0
    ) {
      time.totalPlaytime = data.totalPlaytime
    }
    if (data.upgrades && typeof data.upgrades === 'object') {
      for (const key of Object.keys(CFG.GAME.initialUpgrades)) {
        const v = data.upgrades[key]
        if (typeof v === 'number' && isFinite(v) && v >= 1) {
          const uCfg = CFG.UPGRADES.find((u) => u.key === key)
          const max = uCfg?.maxLevel ?? Infinity
          G.upgrades[key] = Math.min(Math.floor(v), max)
        }
      }
    }
    if (data.cards && typeof data.cards === 'object') {
      for (const [id, count] of Object.entries(data.cards)) {
        if (typeof count !== 'number' || !isFinite(count) || count < 0) continue
        if (CFG.CARDS.some((c) => c.id === id)) {
          G.cards[id] = Math.floor(count)
        }
      }
    }
    if (Array.isArray(data.openedChests)) {
      for (const x of data.openedChests) {
        if (typeof x === 'number' && isFinite(x)) G.openedChests.add(x)
      }
    }
    if (typeof data.gems === 'number' && isFinite(data.gems) && data.gems >= 0) {
      G.gems = Math.floor(data.gems)
    }
    if (Array.isArray(data.collectedGems)) {
      for (const x of data.collectedGems) {
        if (typeof x === 'number' && isFinite(x)) G.collectedGems.add(x)
      }
    }
    Achievements.deserialize(data.achievements)
  } catch (e) {
    console.warn('loadProgress failed:', e)
  }
}

export function resetProgress() {
  const ok = confirm(
    'Сбросить весь прогресс? Монеты, рекорд и апгрейды будут потеряны.\nИгра перезапустится.'
  )
  if (!ok) return

  try {
    localStorage.removeItem(CFG.SAVE.key)
    localStorage.removeItem(CFG.ROCKET.ghost.storageKey)
  } catch (e) {
    console.warn('resetProgress: не удалось очистить localStorage:', e)
  }
  DayNight.reset()

  UI.showToast('Прогресс сброшен 🗑️', '#ff7a7a')

  setTimeout(() => location.reload(), 500)
}

/* ================================================================
   GHOST PERSISTENCE — base64 для Float32Array
================================================================ */
function u8ToBase64(u8) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToU8(b64) {
  const binary = atob(b64)
  const u8 = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i)
  return u8
}

export function saveGhostFlight() {
  if (ghostRecorder.samples.length < CFG.ROCKET.minSamplesLimit) return
  try {
    const float32 = new Float32Array(ghostRecorder.samples)
    bestFlight.samples = float32
    bestFlight.best = G.best

    const bytes = new Uint8Array(float32.buffer)
    const b64 = u8ToBase64(bytes)
    localStorage.setItem(
      CFG.ROCKET.ghost.storageKey,
      JSON.stringify({ v: 1, best: G.best, samples: b64 })
    )
  } catch (e) {
    console.warn('saveGhostFlight failed:', e)
  }
}

export function loadGhostFlight() {
  try {
    const raw = localStorage.getItem(CFG.ROCKET.ghost.storageKey)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data.samples !== 'string') return

    const bytes = base64ToU8(data.samples)
    if (bytes.length % 4 !== 0) return
    const float32 = new Float32Array(bytes.buffer)
    if (float32.length < 12) return

    bestFlight.samples = float32
    bestFlight.best = typeof data.best === 'number' ? data.best : 0
  } catch (e) {
    console.warn('loadGhostFlight failed:', e)
  }
}
EOF

# ============================================================
# 8. core/game.js — оркестратор
# ============================================================
cat > scripts/core/game.js <<'EOF'
/* ================================================================
   game.js — игровая логика: init, старт/посадка, апгрейды, карточки,
   оркестрация updatePhysics/updateVisuals.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import * as Achievements from '../achievements.js'
import * as CardsModal from '../ui/cardsModal.js'
import { G, rocketState, cam, input, time, ghostRecorder, bestFlight } from '../state.js'
import * as Abilities from '../abilities.js'
import {
  rocket, chests,
  updateChests as updateChestsFX,
  updateGems as updateGemsFX,
  updateGhostRocket,
} from '../views/entities/index.js'
import * as UI from '../ui/index.js'
import { camera } from '../views/scene.js'
import { terrainHeight } from '../world/world.js'

import { UPGRADES, costOf, launchSpeed, maxFuel } from './formulas.js'
import {
  updateRocketPhysics, updateRocketVisuals,
  updateChestTracker, checkGemPickup, setLandCallback,
} from './physics.js'
import { updateCamera } from './camera.js'
import { updateBossAnim } from './boss.js'
import { startGhostRecording } from './ghostRecorder.js'
import {
  saveProgress, loadProgress, resetProgress,
  saveGhostFlight, loadGhostFlight,
} from '../services/save.js'

const LAUNCH_ANGLE = CFG.GAME.launchAngle
const REST_Y = CFG.GAME.restY

const _ipos = new THREE.Vector3()
const _ivel = new THREE.Vector3()
let _irotZ = 0

/* ---------- Re-exports для main.js ---------- */
export { UPGRADES, costOf, saveProgress, loadProgress, resetProgress, loadGhostFlight }

/* ================================================================
   Апгрейды
================================================================ */
export function buy(u) {
  const lvl = G.upgrades[u.key]
  const max = u.maxLevel ?? Infinity
  if (lvl >= max) return
  const cost = costOf(u)
  if (G.coins < cost) return
  G.coins -= cost
  G.upgrades[u.key]++
  UI.updateHUD()
  UI.renderShop()
  UI.showToast(`${u.icon} Lv.${G.upgrades[u.key]}`, CFG.UI.toastColors.upgrade)
  saveProgress()
  Achievements.onBuy()
}

/* ================================================================
   Старт / посадка
================================================================ */
export function startKick() {
  if (G.phase !== 'ready' && G.phase !== 'landed') return
  resetRocket()
  G.phase = 'prekick'
  G.timer = 0
  cam.blend = 0
}

function resetRocket() {
  const gY = terrainHeight(0, 0)
  rocketState.pos.set(0, gY + REST_Y, 0)
  rocketState.prevPos.copy(rocketState.pos)
  rocketState.rotZ = 0
  rocketState.prevRotZ = 0
  rocketState.vel.set(0, 0, 0)
  rocketState.prevVel.set(0, 0, 0)
  rocketState.angVel = 0
  rocket.position.copy(rocketState.pos)
  rocket.rotation.z = 0
  rocket.rotation.y = 0
  G.fuel = maxFuel()
  input.boost = false
  Abilities.reset()
  UI.setHUDDist(0)
}

function launch() {
  const speed = launchSpeed()
  const yaw = CFG.GAME.flightYaw || 0
  const horiz = Math.cos(LAUNCH_ANGLE) * speed
  rocketState.vel.set(Math.cos(yaw) * horiz, Math.sin(LAUNCH_ANGLE) * speed, Math.sin(yaw) * horiz)
  rocketState.prevVel.set(rocketState.vel.x, rocketState.vel.y, rocketState.vel.z)
  rocketState.rotZ = LAUNCH_ANGLE
  rocketState.prevRotZ = LAUNCH_ANGLE
  rocketState.prevPos.copy(rocketState.pos)
  rocket.rotation.z = LAUNCH_ANGLE
  rocket.rotation.y = -yaw
  rocketState.angVel = 0
  G.phase = 'fly'
  G.timer = 0
  startGhostRecording()
  UI.showToast('ПОЛЕТЕЛИ! 🚀', CFG.UI.toastColors.upgrade)
  Achievements.onLaunch()
  saveProgress()
}

function land() {
  G.phase = 'landed'

  const speedAtTouchdown = rocketState.vel.length()
  const landedX = rocketState.pos.x
  const landedZ = rocketState.pos.z
  const groundY = terrainHeight(landedX, landedZ)

  let nearestChestDist = Infinity
  for (const c of chests) {
    if (c.opened) continue
    const dx = landedX - c.x
    const dz = landedZ - c.z
    const d2 = dx * dx + dz * dz
    const d = Math.sqrt(d2)
    if (d < nearestChestDist) nearestChestDist = d
    if (!c.opened && d2 <= CFG.CHESTS.pickupRadius * CFG.CHESTS.pickupRadius) {
      openChest(c)
    }
  }
  if (!isFinite(nearestChestDist)) nearestChestDist = null

  G.timer = 0
  rocketState.angVel = 0
  rocketState.pos.y = groundY + REST_Y
  rocketState.vel.set(0, 0, 0)

  const dist = Math.max(0, rocketState.pos.x)
  const earned = Math.max(1, Math.floor(dist))
  G.lastDist = dist
  G.coins += earned
  const isRecord = dist > G.best
  if (isRecord) G.best = dist

  if (isRecord && ghostRecorder.samples.length >= CFG.ROCKET.minSamplesLimit) {
    saveGhostFlight()
  }
  ghostRecorder.recording = false

  UI.setHUDDist(dist)
  UI.updateHUD()
  UI.renderShop()
  saveProgress()

  UI.showLandToast(dist, isRecord)
  cam.shake = CFG.CAMERA.shakeOnLand

  Achievements.onLand({
    dist,
    altitude: groundY,
    speed: speedAtTouchdown,
    nearestChestDist,
  })
  Abilities.reset()
}

/* ================================================================
   updateBossPhase — state machine (launch() должен жить здесь)
================================================================ */
function updateBossPhase(dt) {
  if (G.phase === 'prekick') {
    const dist = camera.position.distanceTo(cam.target)
    if (dist <= CFG.GAME.prekickCamTolerance) {
      G.timer += dt
      if (G.timer >= CFG.GAME.prekickDelay) {
        G.phase = 'windup'
        G.timer = 0
      }
    } else {
      G.timer = 0
    }
  } else if (G.phase === 'windup') {
    G.timer += dt
    if (G.timer >= 0.3) {
      G.phase = 'strike'
      G.timer = 0
    }
  } else if (G.phase === 'strike') {
    G.timer += dt
    if (G.timer >= 0.11 && G.phase === 'strike') launch()
  }
}

/* ================================================================
   Карточки: выбор из двух
================================================================ */
function isConditionMet(cond) {
  if (cond === 'forsage') return (G.cards.forsage || 0) >= 1
  return true
}

function getFamilyCount(family) {
  let total = 0
  for (const card of CFG.CARDS) {
    if (card.family === family) total += G.cards[card.id] || 0
  }
  return total
}

function isAvailable(card) {
  if (card.special) return false
  if (card.once && (G.cards[card.id] || 0) >= 1) return false
  if (card.condition && !isConditionMet(card.condition)) return false
  if (getFamilyCount(card.family) >= CFG.CHESTS.cardTypeLimit) return false
  return true
}

function pickTwoCards() {
  const available = CFG.CARDS.filter(isAvailable)
  if (available.length === 0) return []

  const card1 = available[Math.floor(Math.random() * available.length)]
  const rest = available.filter((c) => c.id !== card1.id)
  if (rest.length === 0) return [card1]

  const card2 = rest[Math.floor(Math.random() * rest.length)]
  return [card1, card2]
}

function openChest(chest) {
  chest.opened = true
  G.openedChests.add(chest.x)
  chest.group.visible = false
  Achievements.onChestOpen(G.openedChests.size)

  if (chest.type === 'forsage') {
    const maxLv = CFG.ABILITIES.forsage.levels.length
    const curLv = G.cards.forsage || 0

    if (curLv < maxLv) {
      const card = CFG.CARDS.find((c) => c.family === 'forsage')
      if (card) {
        const isUpgrade = curLv >= 1
        G.cards.forsage = curLv + 1
        UI.showCardChoices([card], () => {}, { isUpgradeOverride: isUpgrade })
        Abilities.onCardObtained('forsage')
        saveProgress()
        CardsModal.refresh()
        return
      }
    }
  }

  const options = pickTwoCards()
  if (options.length === 0) {
    UI.showToast('Все карточки собраны! 🎉', CFG.UI.toastColors.upgrade)
    saveProgress()
    return
  }

  UI.showCardChoices(options, (picked) => {
    G.cards[picked.id] = (G.cards[picked.id] || 0) + 1
    saveProgress()
    CardsModal.refresh()
  })
  saveProgress()
}

/* ================================================================
   Карточки: покупка / продажа
================================================================ */
export function canBuyCard(cardId) {
  const card = CFG.CARDS.find((c) => c.id === cardId)
  if (!card) return 'Карточка не найдена'
  if (card.buyFlag === false) return 'Покупка недоступна'
  if (!card.buyPrice || card.buyPrice <= 0) return 'Цена не указана'

  const reason = canGiveCardReason(cardId)
  if (reason) return reason

  if (G.gems < card.buyPrice) return `Нужно ${card.buyPrice} 💎 (у вас ${G.gems})`
  return null
}

export function canSellCard(cardId) {
  const card = CFG.CARDS.find((c) => c.id === cardId)
  if (!card) return 'Карточка не найдена'
  if (card.sellFlag === false) return 'Продажа недоступна'
  if (!card.sellPrice || card.sellPrice <= 0) return 'Цена не указана'
  const cur = G.cards[cardId] || 0
  if (cur <= 0) return 'Нет карточек для продажи'
  return null
}

export function buyCard(cardId) {
  const reason = canBuyCard(cardId)
  if (reason) return { ok: false, reason }

  const card = CFG.CARDS.find((c) => c.id === cardId)
  G.gems -= card.buyPrice
  G.cards[card.id] = (G.cards[card.id] || 0) + 1

  if (card.family === 'forsage') Abilities.onCardObtained('forsage')

  saveProgress()
  CardsModal.refresh()
  return { ok: true }
}

export function sellCard(cardId) {
  const reason = canSellCard(cardId)
  if (reason) return { ok: false, reason }

  const card = CFG.CARDS.find((c) => c.id === cardId)
  G.gems += card.sellPrice
  const cur = G.cards[cardId] || 0
  G.cards[cardId] = cur - 1
  if (G.cards[cardId] === 0) delete G.cards[cardId]

  if (card.family === 'forsage') {
    Abilities.syncFromCards()
    const a = G.abilities.forsage
    if (a) {
      a.active = false
      a.activeEnd = 0
      a.cooldownEnd = 0
    }
  }

  saveProgress()
  CardsModal.refresh()
  return { ok: true }
}

export function getCardTradePreview(cardId, delta) {
  const card = CFG.CARDS.find((c) => c.id === cardId)
  if (!card) return null

  const curCount = G.cards[cardId] || 0
  const newCount = Math.max(0, curCount + delta)

  const effects = []
  if (card.effects) {
    for (const eff of card.effects) {
      const before = Math.pow(eff.mult, curCount)
      const after = Math.pow(eff.mult, newCount)
      if (Math.abs(before - after) < 0.001) continue
      effects.push({ stat: eff.stat, before, after })
    }
  }
  return { curCount, newCount, effects }
}

/* ================================================================
   DEBUG: карточки
================================================================ */
export function canGiveCardReason(id) {
  const card = CFG.CARDS.find((c) => c.id === id)
  if (!card) return `Карточка "${id}" не найдена`
  if (card.special) return `"${id}" — special, выдаётся только через фиолетовый сундук`
  if (card.once && (G.cards[card.id] || 0) >= 1) return `"${id}" — once, уже получена`
  if (card.condition && !isConditionMet(card.condition))
    return `"${id}" — не выполнено условие "${card.condition}"`
  if (getFamilyCount(card.family) >= CFG.CHESTS.cardTypeLimit)
    return `Семейство "${card.family}" уже на лимите ${CFG.CHESTS.cardTypeLimit}`
  return null
}

export function giveCard(id, { silent = false } = {}) {
  const reason = canGiveCardReason(id)
  if (reason) {
    console.warn('[dbgGiveCard] ⛔', reason)
    return false
  }
  const card = CFG.CARDS.find((c) => c.id === id)
  const isUpgrade = (G.cards[card.id] || 0) >= 1
  G.cards[card.id] = (G.cards[card.id] || 0) + 1

  if (!silent) {
    UI.showCardChoices([card], () => {}, { isUpgradeOverride: isUpgrade })
  }
  CardsModal.refresh()
  saveProgress()
  console.log(`[dbgGiveCard] ✅ "${id}" выдан (теперь ×${G.cards[card.id]})`)
  return true
}

export function listCardsDebug() {
  console.table(
    CFG.CARDS.map((card) => {
      const count = G.cards[card.id] || 0
      const reason = canGiveCardReason(card.id)
      return {
        id: card.id,
        family: card.family,
        variant: card.variant || '',
        получено: count,
        статус: reason ? `⛔ ${reason}` : '✅ можно',
      }
    })
  )
}

export function removeCard(id, { silent = false } = {}) {
  const card = CFG.CARDS.find((c) => c.id === id)
  if (!card) {
    console.warn(`[dbgRemoveCard] ⛔ Карточка "${id}" не найдена`)
    return false
  }
  const cur = G.cards[card.id] || 0
  if (cur <= 0) {
    console.warn(`[dbgRemoveCard] ⛔ "${id}" уже 0 — нечего убирать`)
    return false
  }
  G.cards[card.id] = cur - 1
  if (G.cards[card.id] === 0) delete G.cards[card.id]

  if (card.family === 'forsage') {
    Abilities.syncFromCards()
    const a = G.abilities.forsage
    if (a) {
      a.active = false
      a.activeEnd = 0
      a.cooldownEnd = 0
    }
  }

  CardsModal.refresh()
  saveProgress()

  if (!silent) {
    const label = card.variant ? `${card.name} · ${card.variant}` : card.name
    UI.showToast(`🗑️ -1 ${card.icon} ${label}`, '#ff7a7a')
  }

  console.log(`[dbgRemoveCard] ✅ "${id}" убран (осталось ×${G.cards[card.id] || 0})`)
  return true
}

/* ================================================================
   DEBUG: сундук по X
================================================================ */
export function debugOpenChestAt(x) {
  const chest = chests.find((c) => c.x === x)
  if (!chest) {
    console.warn(`[DEBUG] Сундук на X=${x} не найден`)
    return
  }
  chest.opened = false
  chest.group.visible = true
  G.openedChests.delete(x)
  openChest(chest)
  console.log(`[DEBUG] Открыт сундук X=${x}, type=${chest.type}`)
}

/* ================================================================
   Точки входа update
================================================================ */
export function updatePhysics(dt) {
  Abilities.update(dt)
  updateBossPhase(dt)
  updateRocketPhysics(dt)
  checkGemPickup()
}

export function updateVisuals(dt, alpha, visualTime = time.gameTime) {
  _ipos.lerpVectors(rocketState.prevPos, rocketState.pos, alpha)
  _ivel.lerpVectors(rocketState.prevVel, rocketState.vel, alpha)
  _irotZ = rocketState.prevRotZ + (rocketState.rotZ - rocketState.prevRotZ) * alpha

  updateBossAnim(dt)
  updateRocketVisuals(dt, _irotZ, _ipos, _ivel)
  updateCamera(dt, _ipos, _ivel)
  updateChestsFX(dt, _ipos.x, _ipos.z)
  updateGemsFX(dt)

  if (G.phase === 'fly' && bestFlight.samples) {
    const t = Math.max(0, visualTime - ghostRecorder.startTime)
    updateGhostRocket(bestFlight.samples, t)
  } else {
    updateGhostRocket(null, 0)
  }

  updateChestTracker(_ipos.x, _ipos.z)
  if (G.phase === 'fly') {
    UI.updateHUD()
    UI.setHUDDist(_ipos.x)
    UI.updateFuelBar(G.fuel, maxFuel())
  }
}

/* ================================================================
   init
================================================================ */
export function init() {
  setLandCallback(land)
  loadProgress()
  loadGhostFlight()
  resetRocket()
  rocket.position.copy(rocketState.pos)
  G.fuel = maxFuel()
  UI.updateHUD()
  UI.renderShop()
}
EOF

# ============================================================
# 9. Удаляем старый game.js, обновляем main.js
# ============================================================
rm scripts/game.js
sed -i "s|from './game.js'|from './core/game.js'|g" scripts/main.js

# ============================================================
# 10. Проверка
# ============================================================
echo ""
echo "=== core/ ==="
ls -la scripts/core/
echo ""
echo "=== services/ ==="
ls -la scripts/services/
echo ""
echo "=== Старые импорты game.js? ==="
if grep -rn "from './game.js'\|from '../game.js'" scripts/ 2>/dev/null; then
  echo "❌ НАЙДЕНЫ"
else
  echo "✅ Нет"
fi