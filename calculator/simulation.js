/* ================================================================
   simulation.js — физика полёта: симуляция, адаптивные тайминги,
   поиск оптимального угла.
   Не зависит от DOM. Чистая математика + CFG.
================================================================ */
import * as CFG from '../scripts/config.js'
import { terrainHeight } from '../scripts/world/world.js'

export function simulate(upgrades, cards, opts = {}) {
  const {
    boostThrottle = 'always',
    forsageLevel = 0,
    noseLiftEnabled = false,
    noseLiftAngle = 45,
    dt = 1 / 60,
    maxTime = 3600,
  } = opts

  const cardEffects = (stat) => {
    let mult = 1
    for (const [id, count] of Object.entries(cards)) {
      if (!count) continue
      const card = CFG.CARDS.find((c) => c.id === id)
      if (!card || !card.effects) continue
      for (const eff of card.effects) {
        if (eff.stat === stat) mult *= Math.pow(eff.mult, count)
      }
    }
    return mult
  }

  const hasFlag = (flag) => {
    for (const [id, count] of Object.entries(cards)) {
      if (!count) continue
      const card = CFG.CARDS.find((c) => c.id === id)
      if (card && card.flags && card.flags.includes(flag)) return true
    }
    return false
  }

  const launchSpeed = CFG.RULES.launchSpeed(upgrades) * cardEffects('launchSpeed')
  const maxFuelVal = CFG.RULES.maxFuel(upgrades) * cardEffects('maxFuel')
  const thrustAccBase = CFG.RULES.thrustAcc(upgrades) * cardEffects('thrustAcc')
  const forsageThrustMul = cardEffects('forsageThrust')
  const gravityEff = CFG.GAME.gravity * cardEffects('gravity')
  const dragMul = cardEffects('drag')
  const dragCoefAtAngle = (alpha) => CFG.RULES.dragCoefAtAngle(upgrades, alpha) * dragMul
  const alwaysOn = hasFlag('engineAlwaysOn')

  let forsageMult = 1
  let forsageDurationLeft = 0
  if (forsageLevel > 0) {
    const idx = Math.min(forsageLevel, CFG.ABILITIES.forsage.levels.length) - 1
    const lv = CFG.ABILITIES.forsage.levels[idx]
    forsageMult = lv.multiplier
    forsageDurationLeft = lv.duration
  }

  const ANG_ACC = CFG.GAME.angAcc
  const ANG_DAMP = CFG.GAME.angDamp
  const ANG_MAX = CFG.GAME.angMax
  const ALIGN = CFG.GAME.aeroAlign
  const MIN_SPEED = CFG.GAME.aeroAlignMinSpeed
  const LAUNCH_ANGLE = CFG.GAME.launchAngle
  const yaw = CFG.GAME.flightYaw || 0
  const REST_Y = CFG.GAME.restY

  const PD_KP = 6.0
  const PD_KD = 2.5
  const PD_VEL_MAX = 5.0
  const noseTargetRad = noseLiftEnabled ? (noseLiftAngle * Math.PI) / 180 : null

  const horiz = Math.cos(LAUNCH_ANGLE) * launchSpeed
  let vx = Math.cos(yaw) * horiz
  let vy = Math.sin(LAUNCH_ANGLE) * launchSpeed
  let vz = Math.sin(yaw) * horiz
  let x = 0, y = REST_Y, z = 0
  let angZ = LAUNCH_ANGLE
  let angVel = 0
  let fuel = maxFuelVal
  let t = 0
  let maxAlt = 0
  let maxSpeed = launchSpeed
  let boostEndAngle = null
  let maxTimeReached = false

  const trajectory = [[0, REST_Y]]
  let nextSampleT = 0.1
  const SAMPLE_INTERVAL = 0.1

  const maxSteps = Math.ceil(maxTime / dt)

  for (let step = 0; step < maxSteps; step++) {
    const terrainY = terrainHeight(x, z)
    const restY = terrainY + REST_Y
    const forsageActive = forsageDurationLeft > 0

    const engineEff = Math.max(0, 1 - Math.max(0, y) / CFG.GAME.airEngineHeight)
    const boosting = (alwaysOn || boostThrottle === 'always') && !forsageActive && fuel > 0
    const thrustActive = boosting || forsageActive

    if (boostEndAngle === null && !thrustActive && t > 0.01) {
      boostEndAngle = (angZ * 180) / Math.PI
    }

    let appliedThrust = 0
    if (boosting) {
      appliedThrust += thrustAccBase * engineEff
      fuel = Math.max(0, fuel - dt)
    }
    if (forsageActive) {
      appliedThrust += thrustAccBase * forsageMult * forsageThrustMul * engineEff
      forsageDurationLeft -= dt
    }

    if (appliedThrust > 0) {
      const c = Math.cos(angZ)
      vx += c * Math.cos(yaw) * appliedThrust * dt
      vy += Math.sin(angZ) * appliedThrust * dt
      vz += c * Math.sin(yaw) * appliedThrust * dt
    }

    vy -= gravityEff * dt

    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
    if (speed > 0.01) {
      const noseX = Math.cos(angZ) * Math.cos(yaw)
      const noseY = Math.sin(angZ)
      const noseZ = Math.cos(angZ) * Math.sin(yaw)
      const dot = (noseX * vx + noseY * vy + noseZ * vz) / speed
      const alpha = Math.acos(Math.max(-1, Math.min(1, dot)))
      const k = dragCoefAtAngle(alpha) * CFG.RULES.airDensity(y)
      const aDrag = k * speed
      vx -= vx * aDrag * dt
      vy -= vy * aDrag * dt
      vz -= vz * aDrag * dt
    }

    x += vx * dt
    y += vy * dt
    z += vz * dt

    if (y <= restY && vy < 0) {
      y = restY
      t += dt
      trajectory.push([x, y])
      break
    }

    let rotInput = 0
    if (thrustActive && noseTargetRad !== null) {
      const error = noseTargetRad - angZ
      const desiredVel = Math.max(-PD_VEL_MAX, Math.min(PD_VEL_MAX, error * PD_KP))
      const rawInput = ((desiredVel - angVel) * PD_KD) / ANG_ACC
      rotInput = Math.max(-1, Math.min(1, rawInput))
    }

    angVel += rotInput * ANG_ACC * dt
    angVel -= angVel * ANG_DAMP * dt
    angVel = Math.max(-ANG_MAX, Math.min(ANG_MAX, angVel))
    angZ += angVel * dt

    const spd = Math.sqrt(vx * vx + vy * vy + vz * vz)
    if (ALIGN > 0 && spd > MIN_SPEED) {
      const desired = Math.atan2(vy, Math.hypot(vx, vz))
      let diff = desired - angZ
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const maxStep = ALIGN * dt
      const applied = Math.sign(diff) * Math.min(Math.abs(diff), maxStep)
      angZ += applied
    }

    t += dt
    const altNow = y - terrainY
    if (altNow > maxAlt) maxAlt = altNow
    if (spd > maxSpeed) maxSpeed = spd

    if (t >= nextSampleT) {
      trajectory.push([x, y])
      nextSampleT += SAMPLE_INTERVAL
    }

    if (step === maxSteps - 1) maxTimeReached = true
  }

  return {
    distance: Math.max(0, x),
    maxAltitude: maxAlt,
    time: t,
    maxSpeed,
    fuelUsed: maxFuelVal - fuel,
    landingTerrain: terrainHeight(x, z),
    boostEndAngle,
    trajectory: downsampleTrajectory(trajectory, 2000),
    maxTimeReached,
  }
}

export function downsampleTrajectory(traj, maxPts) {
  if (traj.length <= maxPts) return traj
  const out = [traj[0]]
  const step = (traj.length - 1) / (maxPts - 1)
  for (let i = 1; i < maxPts - 1; i++) out.push(traj[Math.round(i * step)])
  out.push(traj[traj.length - 1])
  return out
}

export function simulateAdaptive(upgrades, cards, opts) {
  const tiers = [300, 900, 3600, 18000]
  let r = null
  for (const maxTime of tiers) {
    r = simulate(upgrades, cards, { ...opts, maxTime })
    if (!r.maxTimeReached) break
  }
  return r
}

export async function findOptimumAsync(upgrades, cards, baseOpts, onProgress) {
  const results = []
  let best = null

  for (let angle = 0; angle <= 90; angle += 1) {
    const r = simulateAdaptive(upgrades, cards, {
      ...baseOpts,
      noseLiftEnabled: true,
      noseLiftAngle: angle,
    })
    results.push({ angle, distance: r.distance, truncated: r.maxTimeReached })
    const better =
      !best ||
      (!r.maxTimeReached && (best.result.maxTimeReached || r.distance > best.distance)) ||
      (r.maxTimeReached === best.result.maxTimeReached && r.distance > best.distance)
    if (better) best = { angle, distance: r.distance, result: r }
    if (angle % 10 === 9) {
      onProgress?.(angle + 1)
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  const noLift = simulateAdaptive(upgrades, cards, { ...baseOpts, noseLiftEnabled: false })
  return { results, best, noLift }
}