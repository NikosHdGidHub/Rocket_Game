/* ================================================================
   simulation.js — физика полёта + поиск оптимального управления.

   Ключевые изменения:
   • Прерывистый boost — паттерны 1/1, 2/1, 4/1, 1/2, 1/4 (плюс always/never).
   • Forsage работает по циклу: старт → duration → cooldown → повтор.
   • findOptimumAsync перебирает углы × все стратегии (двухфазный поиск).
================================================================ */
import * as CFG from '../scripts/config.js'
import { terrainHeight } from '../scripts/world/world.js'

/* ---------- Boost-стратегии ---------- */

/**
 * Паттерны PUSH. `on` и `off` — секунды.
 * always и never — крайние случаи (не периодические).
 */
export const BOOST_PATTERNS = {
  always: { on: Infinity, off: 0 },
  '1/1': { on: 5, off: 5 },
  '2/1': { on: 10, off: 5 },
  '4/1': { on: 20, off: 5 },
  '1/2': { on: 5, off: 10 },
  '1/4': { on: 5, off: 20 },
  '1/8': { on: 5, off: 40 },
  never: { on: 0, off: Infinity },
}

export const BOOST_STRATEGIES = Object.keys(BOOST_PATTERNS)

export const BOOST_LABELS = {
  always: 'Всегда',
  '1/1': '1/1 — 5с вкл / 5с выкл',
  '2/1': '2/1 — 10с вкл / 5с выкл',
  '4/1': '4/1 — 20с вкл / 5с выкл',
  '1/2': '1/2 — 5с вкл / 10с выкл',
  '1/4': '1/4 — 5с вкл / 20с выкл',
  '1/8': '1/8 — 5с вкл / 40с выкл',
  never: 'Никогда (только форсаж)',
}

/* ---------- Основная симуляция ---------- */
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

  // ─── Forsage: параметры одного уровня ───
  let forsageMult = 1
  let forsageDuration = 0
  let forsageCooldown = 0
  if (forsageLevel > 0) {
    const idx = Math.min(forsageLevel, CFG.ABILITIES.forsage.levels.length) - 1
    const lv = CFG.ABILITIES.forsage.levels[idx]
    forsageMult = lv.multiplier
    forsageDuration = lv.duration
    forsageCooldown = lv.cooldown
  }
  const forsageCycleLen = forsageDuration + forsageCooldown
  const hasForsage =
    forsageLevel > 0 && forsageDuration > 0 && isFinite(forsageCycleLen) && forsageCycleLen > 0

  // ─── Boost: параметры паттерна ───
  const pat = BOOST_PATTERNS[boostThrottle] || BOOST_PATTERNS.always
  const boostPeriod = pat.on + pat.off
  const isPeriodicBoost =
    boostThrottle !== 'always' &&
    boostThrottle !== 'never' &&
    isFinite(boostPeriod) &&
    pat.on > 0 &&
    pat.off > 0

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
  let x = 0
  let y = REST_Y
  let z = 0
  let angZ = LAUNCH_ANGLE
  let angVel = 0
  let fuel = maxFuelVal
  let t = 0
  let maxAlt = 0
  let maxSpeed = launchSpeed
  let boostEndAngle = null
  let maxTimeReached = false

  // ─── Циклы: текущая фаза ───
  let forsageCycleTime = 0
  let boostCycleTime = 0
  let lastThrustActive = false
  let thrustUsed = false
  let forsageActiveSeconds = 0
  let boostActiveSeconds = 0

  const trajectory = [[0, REST_Y]]
  let nextSampleT = 0.1
  const SAMPLE_INTERVAL = 0.1

  const maxSteps = Math.ceil(maxTime / dt)

  for (let step = 0; step < maxSteps; step++) {
    const terrainY = terrainHeight(x, z)
    const restY = terrainY + REST_Y

    // ─── Forsage: фаза цикла ───
    let forsageActive = false
    if (hasForsage) {
      forsageCycleTime += dt
      if (forsageCycleTime >= forsageCycleLen) {
        forsageCycleTime -= forsageCycleLen * Math.floor(forsageCycleTime / forsageCycleLen)
      }
      forsageActive = forsageCycleTime < forsageDuration
    }

    // ─── Boost: фаза паттерна ───
    let boostActive = false
    if (boostThrottle === 'always') {
      boostActive = true
    } else if (boostThrottle === 'never') {
      boostActive = false
    } else if (isPeriodicBoost) {
      boostCycleTime += dt
      if (boostCycleTime >= boostPeriod) {
        boostCycleTime -= boostPeriod * Math.floor(boostCycleTime / boostPeriod)
      }
      boostActive = boostCycleTime < pat.on
    }

    const engineEff = Math.max(0, 1 - Math.max(0, y) / CFG.GAME.airEngineHeight)
    // alwaysOn — override: двигатель всегда включён независимо от паттерна.
    const boosting = (boostActive || alwaysOn) && !forsageActive && fuel > 0
    const thrustActive = boosting || forsageActive

    // boostEndAngle — угол в момент последнего отключения тяги
    if (thrustActive) {
      thrustUsed = true
      lastThrustActive = true
    } else if (lastThrustActive && t > 0.01) {
      boostEndAngle = (angZ * 180) / Math.PI
      lastThrustActive = false
    }

    let appliedThrust = 0
    if (boosting) {
      appliedThrust += thrustAccBase * engineEff
      fuel = Math.max(0, fuel - dt)
      boostActiveSeconds += dt
    }
    if (forsageActive) {
      appliedThrust += thrustAccBase * forsageMult * forsageThrustMul * engineEff
      forsageActiveSeconds += dt
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
    // Если тяга ни разу не отключалась (thrustUsed && boostEndAngle === null),
    // возвращаем текущий угол как «финальный».
    boostEndAngle: thrustUsed
      ? boostEndAngle !== null
        ? boostEndAngle
        : (angZ * 180) / Math.PI
      : null,
    thrustUsed,
    forsageActiveSeconds,
    boostActiveSeconds,
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

/* ================================================================
   ПОИСК ОПТИМУМА — двухфазный
   1. Грубо: 7 углов × N стратегий (все стратегии участвуют).
   2. Точно: вокруг лучшего угла ±15° с шагом 1° для победившей стратегии.
   3. Бонус: noLift для сравнения.
================================================================ */

const COARSE_ANGLES = [0, 15, 30, 45, 60, 75, 90]

function pickBetter(a, b) {
  if (!b) return a
  if (!a) return b
  // Не обрезанный полёт всегда лучше обрезанного.
  if (!a.result.maxTimeReached && b.result.maxTimeReached) return a
  if (a.result.maxTimeReached && !b.result.maxTimeReached) return b
  return a.distance >= b.distance ? a : b
}

export async function findOptimumAsync(upgrades, cards, baseOpts, onProgress) {
  const strategies = BOOST_STRATEGIES
  const totalCoarse = COARSE_ANGLES.length * strategies.length

  // Кэш — чтобы не считать один и тот же угол дважды на этапах coarse/fine.
  const cache = new Map()
  const simCached = (strategy, angle, noseLift) => {
    const key = `${strategy}|${angle}|${noseLift}`
    if (cache.has(key)) return cache.get(key)
    const r = simulateAdaptive(upgrades, cards, {
      ...baseOpts,
      boostThrottle: strategy,
      noseLiftEnabled: noseLift,
      noseLiftAngle: angle,
    })
    cache.set(key, r)
    return r
  }

  // ─── Фаза 1: грубый перебор по всем стратегиям ───
  const coarseResults = []
  let best = null
  let done = 0

  for (const strategy of strategies) {
    for (const angle of COARSE_ANGLES) {
      const r = simCached(strategy, angle, true)
      const item = {
        strategy,
        angle,
        distance: r.distance,
        truncated: r.maxTimeReached,
        result: r,
      }
      coarseResults.push(item)
      best = pickBetter(best, item)
      done++
      if (done % 5 === 0 || done === totalCoarse) {
        onProgress?.(done, totalCoarse, `Стратегия ${BOOST_LABELS[strategy]} · угол ${angle}°`)
        await new Promise((r) => setTimeout(r, 0))
      }
    }
  }

  // ─── Фаза 2: уточнение вокруг лучшего угла ───
  const fineCenter = best.angle
  const fineAngles = []
  for (let a = Math.max(0, fineCenter - 15); a <= Math.min(90, fineCenter + 15); a++) {
    fineAngles.push(a)
  }
  const winnerStrategy = best.strategy
  const totalFine = fineAngles.length + 1 // +1 — финальный noLift

  const fineResults = []
  for (const angle of fineAngles) {
    const r = simCached(winnerStrategy, angle, true)
    const item = {
      strategy: winnerStrategy,
      angle,
      distance: r.distance,
      truncated: r.maxTimeReached,
      result: r,
    }
    fineResults.push(item)
    const candidate = { ...item, result: r }
    // pickBetter ожидает {result, distance}; пересобираем аккуратно:
    const asCandidate = {
      angle,
      strategy: winnerStrategy,
      distance: r.distance,
      result: r,
    }
    best = pickBetter(best, asCandidate)
    done++
    onProgress?.(
      done,
      totalCoarse + totalFine,
      `Уточнение · ${BOOST_LABELS[winnerStrategy]} · угол ${angle}°`
    )
    await new Promise((r) => setTimeout(r, 0))
  }

  // ─── Финальный noLift (без авто-подъёма носа, для сравнения) ───
  const noLift = simCached(winnerStrategy, 45, false) // угол не используется, когда lift=off
  onProgress?.(done + 1, totalCoarse + totalFine, 'Сравнение без подъёма носа…')

  return {
    best, // { strategy, angle, distance, result }
    coarseResults, // [{ strategy, angle, distance, truncated }]
    fineResults, // [{ strategy, angle, distance, truncated }]
    noLift,
    strategies,
  }
}

/* ================================================================
   ПОЛНЫЙ ПЕРЕБОР — «Долгий расчёт».
   0..90 × все стратегии = 637 симуляций + 1 noLift.
   Точный глобальный оптимум, но 30-90 секунд.

   Возвращает ту же структуру, что и findOptimumAsync — renderOptimum
   работает без изменений. Все результаты лежат в coarseResults,
   fineResults = [] (уточняющая фаза не нужна — перебрано всё).
================================================================ */
export async function findOptimumExactAsync(upgrades, cards, baseOpts, onProgress) {
  const strategies = BOOST_STRATEGIES
  const totalAngles = 91 // 0..90
  const total = strategies.length * totalAngles + 1 // +1 = noLift

  const allResults = []
  let best = null
  let done = 0
  let lastYield = performance.now()

  for (const strategy of strategies) {
    for (let angle = 0; angle <= 90; angle++) {
      const r = simulateAdaptive(upgrades, cards, {
        ...baseOpts,
        boostThrottle: strategy,
        noseLiftEnabled: true,
        noseLiftAngle: angle,
      })
      const item = {
        strategy,
        angle,
        distance: r.distance,
        truncated: r.maxTimeReached,
        result: r,
      }
      allResults.push(item)
      best = pickBetter(best, item)
      done++

      // Yield по времени: если симуляция медленная — отдадим кадр после неё;
      // если быстрая — копим до ~50 мс и отдаём разом.
      if (performance.now() - lastYield > 50 || done === total - 1) {
        onProgress?.(done, total, `${BOOST_LABELS[strategy] || strategy} · ${angle}°`)
        await new Promise((r) => setTimeout(r, 0))
        lastYield = performance.now()
      }
    }
  }

  // noLift — тот же билд, но без авто-подъёма носа (для сравнения)
  const noLift = simulateAdaptive(upgrades, cards, {
    ...baseOpts,
    boostThrottle: best.strategy,
    noseLiftEnabled: false,
  })
  onProgress?.(total, total, 'Готово')

  return {
    best,
    coarseResults: allResults, // все 637 точек — рендер сам найдёт лучших
    fineResults: [], // уточнение не требуется
    noLift,
    strategies,
  }
}
