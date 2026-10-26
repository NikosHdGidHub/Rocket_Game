// fix7.mjs — physicsHz + swept collision + MAX_STEPS auto + calculator sync
// Запуск: node fix7.mjs
import fs from 'node:fs'

const read = (p) => {
  const raw = fs.readFileSync(p, 'utf-8')
  const isCRLF = raw.includes('\r\n')
  return { text: raw.replace(/\r\n/g, '\n'), isCRLF }
}
const write = (p, text, isCRLF) =>
  fs.writeFileSync(p, isCRLF ? text.replace(/\n/g, '\r\n') : text, 'utf-8')

function replaceOrSkip(s, oldStr, newStr, label) {
  if (s.includes(newStr)) {
    console.log(`⏭️  ${label} — уже применено`)
    return s
  }
  if (!s.includes(oldStr)) {
    console.error(`\n❌ Не найден блок: ${label}`)
    console.error('Искали (первые 300):')
    console.error(oldStr.slice(0, 300))
    process.exit(1)
  }
  console.log(`✅ ${label}`)
  return s.replace(oldStr, newStr)
}

// ============================================================
// 1) config.js — GAME: physicsHz, maxFrameDt, maxPhysicsSteps, collision
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `  /** Высота ракеты над землёй в состоянии покоя (м). */
  restY: 0.95,

  /** Пауза (с) между «камера вернулась к стартовой позиции»*/`

  const NEW = `  /** Высота ракеты над землёй в состоянии покоя (м). */
  restY: 0.95,

  /**
   * Частота шага физики (Гц).
   * 60 — быстро, но при 400+ м/с Euler-интеграция даёт заметную ошибку.
   * 120 — компромисс (рекомендуется).
   * 240 — максимальная точность, ×2 CPU к физике.
   * ВАЖНО: калькулятор (calculator/simulation.js) берёт dt отсюда же.
   */
  physicsHz: 120,

  /**
   * Максимальный dt кадра (сек). Верхний предел accumulator —
   * защита от «спирали смерти» при долгих фризах.
   * Реальный dt кадра всегда clamp'ится этим значением.
   */
  maxFrameDt: 0.1,

  /**
   * Потолок шагов физики за кадр. 0 = авто из maxFrameDt × physicsHz + 2.
   * При physicsHz = 120 и maxFrameDt = 0.1: 14 шагов.
   * При physicsHz = 240 и maxFrameDt = 0.1: 26 шагов.
   * Менять нужно только если хочешь свой жёсткий лимит.
   */
  maxPhysicsSteps: 0,

  /**
   * Swept-коллизия: сэмплируем отрезок prevPos → pos и ловим
   * «пролёт сквозь гору» на высокой горизонтальной скорости.
   * Также исправляет «прыжок» на склон при обычной посадке.
   */
  collision: {
    swept: true,
    /** Сколько подшагов на отрезок. 4 — баланс между точностью и CPU. */
    sweptSamples: 4,
  },

  /** Пауза (с) между «камера вернулась к стартовой позиции»*/`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / GAME physics + collision')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) main.js — FIXED_DT / MAX_FRAME_DT / MAX_STEPS из конфига
// ============================================================
{
  const { text, isCRLF } = read('scripts/main.js')
  let s = text

  const OLD = `const FIXED_DT = 1 / 60 // фиксированный шаг физики
const MAX_FRAME_DT = 0.1 // защита от «спирали смерти» при лагах
const MAX_STEPS = 10 // до 10 шагов за кадр (~166 мс)`

  const NEW = `const FIXED_DT = 1 / CFG.GAME.physicsHz // фиксированный шаг физики
const MAX_FRAME_DT = CFG.GAME.maxFrameDt // верхний предел dt кадра
// Потолок шагов физики за кадр. 0 в конфиге = авто (maxFrameDt × physicsHz + запас 2).
// Авто гарантирует, что при смене physicsHz лимит не отстанет от реальности.
const MAX_STEPS =
  CFG.GAME.maxPhysicsSteps > 0
    ? CFG.GAME.maxPhysicsSteps
    : Math.ceil(MAX_FRAME_DT / FIXED_DT) + 2`

  s = replaceOrSkip(s, OLD, NEW, 'main.js / fixed timestep from config')
  write('scripts/main.js', s, isCRLF)
}

// ============================================================
// 3) physics.js — swept collision + restY от новой позиции
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/physics.js')
  let s = text

  // 3a) убираем вычисление restY в старом месте
  const OLD1 = `  const restY = terrainHeight(p.pos.x, p.pos.z) + REST_Y
  const forsageActive = Abilities.isActive('forsage')`
  const NEW1 = `  const forsageActive = Abilities.isActive('forsage')`
  s = replaceOrSkip(s, OLD1, NEW1, 'physics.js / remove old restY')

  // 3b) заменяем блок посадки на swept + fallback
  const OLD2 = `    p.pos.addScaledVector(p.vel, dt)

    if (p.pos.y <= restY && p.vel.y < 0) {
      p.pos.y = restY
      if (_onLand) _onLand()
    }
    recordGhostSample()`

  const NEW2 = `    p.pos.addScaledVector(p.vel, dt)

    // --- Коллизия с рельефом ---
    // Проверяем только при снижении (vel.y < 0): восходящий пролёт
    // над горами — это нормальное поведение, не трогаем.
    if (p.vel.y < 0) {
      const CS = CFG.GAME.collision
      let landed = false

      // Swept: сэмплируем отрезок prevPos → pos. Ловит «туннель» сквозь
      // пик, когда между старой и новой позицией есть гора, а в новой
      // позиции уже низина. Без swept на 400+ м/с такие пролёты — реал.
      if (CS.swept) {
        const from = p.prevPos
        const to = p.pos
        const N = Math.max(2, CS.sweptSamples | 0)
        for (let i = 1; i <= N; i++) {
          const k = i / N
          const sx = from.x + (to.x - from.x) * k
          const sy = from.y + (to.y - from.y) * k
          const sz = from.z + (to.z - from.z) * k
          const sRestY = terrainHeight(sx, sz) + REST_Y
          if (sy <= sRestY) {
            p.pos.set(sx, sRestY, sz)
            if (_onLand) _onLand()
            landed = true
            break
          }
        }
      }

      // Fallback: обычная вертикальная посадка. Считаем restY от НОВОЙ
      // позиции — корректнее на склонах (старый код брал от старой).
      if (!landed) {
        const newRestY = terrainHeight(p.pos.x, p.pos.z) + REST_Y
        if (p.pos.y <= newRestY) {
          p.pos.y = newRestY
          if (_onLand) _onLand()
        }
      }
    }
    recordGhostSample()`

  s = replaceOrSkip(s, OLD2, NEW2, 'physics.js / swept + fallback collision')
  write('scripts/core/physics.js', s, isCRLF)
}

// ============================================================
// 4) calculator/simulation.js — dt из CFG
// ============================================================
{
  const { text, isCRLF } = read('calculator/simulation.js')
  let s = text

  const OLD = `    dt = 1 / 60,`
  const NEW = `    dt = 1 / CFG.GAME.physicsHz,`
  s = replaceOrSkip(s, OLD, NEW, 'calculator/simulation.js / dt sync')
  write('calculator/simulation.js', s, isCRLF)
}

console.log('\n🎉 Готово.')
console.log('   Проверь:')
console.log('   1. Полёт на высокой скорости в сторону гор — не пролетает сквозь.')
console.log('   2. Калькулятор даёт те же цифры, что игра (примерно).')
console.log('   3. При FPS=20 нет спирали смерти (не залипает).')