// patch.mjs — линейная зависимость тяги от топлива + карточка jettisonable_tanks.
// Запуск: node patch.mjs
// Идемпотентен: повторный запуск безопасен.
import fs from 'node:fs'

const read = (p) => {
  const raw = fs.readFileSync(p, 'utf-8')
  return { text: raw.replace(/\r\n/g, '\n'), crlf: raw.includes('\r\n') }
}
const write = (p, { text, crlf }) =>
  fs.writeFileSync(p, crlf ? text.replace(/\n/g, '\r\n') : text, 'utf-8')

function replaceOrSkip(obj, oldStr, newStr, label) {
  if (obj.text.includes(newStr)) {
    console.log(`[skip] ${label} — уже применено`)
    return
  }
  if (!obj.text.includes(oldStr)) {
    console.error(`\n[FAIL] Не найден блок: ${label}`)
    console.error('Искали:')
    console.error(oldStr.slice(0, 400))
    process.exit(1)
  }
  obj.text = obj.text.replace(oldStr, newStr)
  console.log(`[ok]   ${label}`)
}

// ============================================================
// 1) _config_game.ts — карточка: stat jettisonable_tanks → fullTankPower
// ============================================================
{
  const f = read('scripts/_config_game.ts')

  replaceOrSkip(
    f,
    `    id: 'jettisonable_tanks',
    family: 'jettisonable',
    icon: '🔰',
    name: 'Отделители',
    variant: 'Отделяемые баки',
    desc_buff: 'Тяга при старте ×1.3 ',
    effects: [{ stat: 'jettisonable_tanks', mult: 1.3, isBuff: true }],`,
    `    id: 'jettisonable_tanks',
    family: 'jettisonable',
    icon: '🔰',
    name: 'Отделители',
    variant: 'Отделяемые баки',
    desc_buff: 'Мощность при полном баке ×1.3',
    effects: [{ stat: 'fullTankPower', mult: 1.3, isBuff: true }],`,
    '_config_game.ts / card jettisonable_tanks'
  )

  write('scripts/_config_game.ts', f)
}

// ============================================================
// 2) formulas.js — хелпер fuelPowerMul
// ============================================================
{
  const f = read('scripts/core/formulas.js')

  replaceOrSkip(
    f,
    `export const maxFuel = () => CFG.RULES.maxFuel(G.upgrades) * cardMul('maxFuel')`,
    `export const maxFuel = () => CFG.RULES.maxFuel(G.upgrades) * cardMul('maxFuel')

export const fullTankPower = () => CFG.GAME.fullTankPower * cardMul('fullTankPower')
export const emptyTankPower = () => CFG.GAME.emptyTankPower

/** Множитель тяги от остатка топлива: линейно от emptyTankPower (t=0) до fullTankPower (t=1). */
export const fuelPowerMul = (fuel, maxFuelVal) => {
  const t = maxFuelVal > 0 ? Math.max(0, Math.min(1, fuel / maxFuelVal)) : 0
  const full = fullTankPower()
  const empty = emptyTankPower()
  return empty + (full - empty) * t
}`,
    'formulas.js / fuelPowerMul'
  )

  write('scripts/core/formulas.js', f)
}

// ============================================================
// 3) physics.js — применить fuelPowerMul к тяге
// ============================================================
{
  const f = read('scripts/core/physics.js')

  replaceOrSkip(
    f,
    `import {
  GRAVITY, REST_Y, ANG_ACC, ANG_DAMP, ANG_MAX,
  thrustAcc, hasFlag, cardMul, dragCoefAtAngle, airDensity, gravityMul,
} from './formulas.js'`,
    `import {
  GRAVITY, REST_Y, ANG_ACC, ANG_DAMP, ANG_MAX,
  thrustAcc, maxFuel, fuelPowerMul, hasFlag, cardMul, dragCoefAtAngle, airDensity, gravityMul,
} from './formulas.js'`,
    'physics.js / imports'
  )

  replaceOrSkip(
    f,
    `    let appliedThrust = 0
    if (runtime.boosting) {
      appliedThrust += thrustAcc() * engineEff
      G.fuel = Math.max(0, G.fuel - dt)
    }
    if (forsageActive) {
      appliedThrust +=
        thrustAcc() * Abilities.thrustMultiplier('forsage') * cardMul('forsageThrust') * engineEff
    }`,
    `    const fuelMul = fuelPowerMul(G.fuel, maxFuel())
    let appliedThrust = 0
    if (runtime.boosting) {
      appliedThrust += thrustAcc() * engineEff * fuelMul
      G.fuel = Math.max(0, G.fuel - dt)
    }
    if (forsageActive) {
      appliedThrust +=
        thrustAcc() * Abilities.thrustMultiplier('forsage') * cardMul('forsageThrust') * engineEff * fuelMul
    }`,
    'physics.js / thrust with fuelPowerMul'
  )

  write('scripts/core/physics.js', f)
}

// ============================================================
// 4) calculator/simulation.js — то же для калькулятора
// ============================================================
{
  const f = read('calculator/simulation.js')

  replaceOrSkip(
    f,
    `  const thrustAccBase = CFG.RULES.thrustAcc(upgrades) * cardEffects('thrustAcc')
  const forsageThrustMul = cardEffects('forsageThrust')`,
    `  const thrustAccBase = CFG.RULES.thrustAcc(upgrades) * cardEffects('thrustAcc')
  const forsageThrustMul = cardEffects('forsageThrust')
  const fullTankPowerBase = CFG.GAME.fullTankPower * cardEffects('fullTankPower')
  const emptyTankPowerBase = CFG.GAME.emptyTankPower`,
    'simulation.js / fuelPowerMul bases'
  )

  replaceOrSkip(
    f,
    `    let appliedThrust = 0
    if (boosting) {
      appliedThrust += thrustAccBase * engineEff
      fuel = Math.max(0, fuel - dt)
      boostActiveSeconds += dt
    }
    if (forsageActive) {
      appliedThrust += thrustAccBase * forsageMult * forsageThrustMul * engineEff
      forsageActiveSeconds += dt
    }`,
    `    const fuelT = maxFuelVal > 0 ? Math.max(0, Math.min(1, fuel / maxFuelVal)) : 0
    const fuelMul = emptyTankPowerBase + (fullTankPowerBase - emptyTankPowerBase) * fuelT

    let appliedThrust = 0
    if (boosting) {
      appliedThrust += thrustAccBase * engineEff * fuelMul
      fuel = Math.max(0, fuel - dt)
      boostActiveSeconds += dt
    }
    if (forsageActive) {
      appliedThrust += thrustAccBase * forsageMult * forsageThrustMul * engineEff * fuelMul
      forsageActiveSeconds += dt
    }`,
    'simulation.js / thrust with fuelMul'
  )

  write('calculator/simulation.js', f)
}

// ============================================================
// 5) ui/cardsModal.js — подпись стата fullTankPower
// ============================================================
{
  const f = read('scripts/ui/cardsModal.js')

  replaceOrSkip(
    f,
    `const STAT_LABELS = {
  maxFuel: { icon: '⛽', name: 'Топливо' },
  thrustAcc: { icon: '🔥', name: 'Тяга' },
  drag: { icon: '💨', name: 'Сопротивление' },
  launchSpeed: { icon: '🦵', name: 'Сила пинка' },
  forsageThrust: { icon: '🚀', name: 'Тяга в форсаже' },
  gravity: { icon: '🌍', name: 'Гравитация' },
}`,
    `const STAT_LABELS = {
  maxFuel: { icon: '⛽', name: 'Топливо' },
  thrustAcc: { icon: '🔥', name: 'Тяга' },
  drag: { icon: '💨', name: 'Сопротивление' },
  launchSpeed: { icon: '🦵', name: 'Сила пинка' },
  forsageThrust: { icon: '🚀', name: 'Тяга в форсаже' },
  gravity: { icon: '🌍', name: 'Гравитация' },
  fullTankPower: { icon: '🔥', name: 'Мощность (полный бак)' },
}`,
    'cardsModal.js / STAT_LABELS + fullTankPower'
  )

  write('scripts/ui/cardsModal.js', f)
}

console.log('')
console.log('Готово. Проверь: npm run dev + localhost:5173/calculator/')
