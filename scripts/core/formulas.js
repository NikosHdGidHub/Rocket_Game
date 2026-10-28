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

export const fullTankPower = () => CFG.GAME.fullTankPower * cardMul('fullTankPower')
export const emptyTankPower = () => CFG.GAME.emptyTankPower

/** Множитель тяги от остатка топлива: линейно от emptyTankPower (t=0) до fullTankPower (t=1). */
export const fuelPowerMul = (fuel, maxFuelVal) => {
  const t = maxFuelVal > 0 ? Math.max(0, Math.min(1, fuel / maxFuelVal)) : 0
  const full = fullTankPower()
  const empty = emptyTankPower()
  return empty + (full - empty) * t
}
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
