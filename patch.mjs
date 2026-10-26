// patch5.mjs — Dive camera: плавный вид сверху 70° при Δx < Δ(−y).
// Запуск: node patch5.mjs
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
    console.error('Искали (первые 400):')
    console.error(oldStr.slice(0, 400))
    process.exit(1)
  }
  console.log(`✅ ${label}`)
  return s.replace(oldStr, newStr)
}

// ============================================================
// 1) config.js — блок CAMERA.dive
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `  /** Максимальный угол наклона (градусы, вид сверху вниз). */
  maxAngle: 60,`

  const NEW = `  /** Максимальный угол наклона (градусы, вид сверху вниз). */
  maxAngle: 60,

  /**
   * Плавный переход в «вид сверху» при крутом пикировании.
   *
   * Условие срабатывания (только в фазе 'fly', только при спуске):
   *   Δx < Δ(−y)  ⇔  vx < |vy|  ⇔  vx / |vy| < 1
   * То есть ракета снижается круче 45°.
   *
   * Пока условие выполнено — камера плавно наклоняется к elevation (°).
   * Как только условие пропало — плавно возвращается к обычной формуле
   * (baseAngle + range·altT).
   */
  dive: {
    /** Целевой угол к горизонту при активном пикировании (°). */
    elevation: 70,

    /**
     * Порог входа: vx / |vy| ≤ enterRatio → dive = 1 (полный вид сверху).
     * 0.8 соответствует углу снижения ≈ 51° (чуть круче 45°).
     */
    enterRatio: 0.8,

    /**
     * Порог выхода: vx / |vy| ≥ exitRatio → dive = 0 (обычная формула).
     * 1.2 соответствует углу снижения ≈ 40° (уже положе 45°).
     * Зазор enter/exit даёт гистерезис — без дрожания на границе.
     */
    exitRatio: 1.2,

    /** Скорость сглаживания перехода (1/с). 4 ≈ 0.25 с на 63% пути. */
    blendSpeed: 4.0,
  },`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / CAMERA.dive block')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) state.js — поле cam.dive
// ============================================================
{
  const { text, isCRLF } = read('scripts/state.js')
  let s = text

  const OLD = `  pos: new THREE.Vector3(), // сглаженная позиция камеры (текущий physics-тик)
  prevPos: new THREE.Vector3(), // позиция на предыдущем physics-тике
  prevLook: new THREE.Vector3(0, 3, 0), // look на предыдущем physics-тике
  inited: false,`

  const NEW = `  pos: new THREE.Vector3(), // сглаженная позиция камеры (текущий physics-тик)
  prevPos: new THREE.Vector3(), // позиция на предыдущем physics-тике
  prevLook: new THREE.Vector3(0, 3, 0), // look на предыдущем physics-тике
  inited: false,

  // «Пикирование»: 0 = обычная формула угла, 1 = вид сверху (70°).
  // Плавно меняется в updateCameraPhysics при Δx < Δ(−y) в полёте.
  dive: 0,`

  s = replaceOrSkip(s, OLD, NEW, 'state.js / cam.dive field')
  write('scripts/state.js', s, isCRLF)
}

// ============================================================
// 3) camera.js — расчёт targetDive и подмешивание в elev
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/camera.js')
  let s = text

  const OLD = `  const alt = Math.max(0, pos.y - gY)
  const altT = Math.min(1, alt / CFG.CAMERA.maxViewHeight)
  const range = CFG.CAMERA.maxAngle - CFG.CAMERA.baseAngle
  const elev = ((CFG.CAMERA.baseAngle + range * altT) * Math.PI) / 180`

  const NEW = `  const alt = Math.max(0, pos.y - gY)
  const altT = Math.min(1, alt / CFG.CAMERA.maxViewHeight)
  const range = CFG.CAMERA.maxAngle - CFG.CAMERA.baseAngle
  const elevNormal = ((CFG.CAMERA.baseAngle + range * altT) * Math.PI) / 180

  // ─── DIVE → TOP-DOWN ───
  // Условие: в фазе полёта, снижаемся (vy < 0) и Δx < Δ(−y), т.е. vx < |vy|.
  // Гистерезис: ratio = vx/|vy|. Ниже enterRatio — dive=1, выше exitRatio — dive=0,
  // между — линейный бленд (без дёрганья на 45°).
  let targetDive = 0
  if (G.phase === 'fly' && vel.y < 0) {
    const ratio = vel.x / Math.max(0.001, -vel.y)
    const D = CFG.CAMERA.dive
    if (ratio <= D.enterRatio) {
      targetDive = 1
    } else if (ratio >= D.exitRatio) {
      targetDive = 0
    } else {
      targetDive = 1 - (ratio - D.enterRatio) / (D.exitRatio - D.enterRatio)
    }
  }

  const kDive = 1 - Math.exp(-CFG.CAMERA.dive.blendSpeed * dt)
  cam.dive += (targetDive - cam.dive) * kDive
  if (cam.dive < 0.001) cam.dive = 0
  if (cam.dive > 0.999) cam.dive = 1

  // Смешиваем: 0 → формула, 1 → 70° вид сверху.
  const diveElev = (CFG.CAMERA.dive.elevation * Math.PI) / 180
  const elev = elevNormal + (diveElev - elevNormal) * cam.dive`

  s = replaceOrSkip(s, OLD, NEW, 'camera.js / dive blend into elev')
  write('scripts/core/camera.js', s, isCRLF)
}

console.log('\n🎉 Готово.')
console.log('   • В полёте при Δx < Δ(−y) (круче 45° вниз) камера плавно')
console.log('     поднимается в вид сверху (70°).')
console.log('   • Как только ракета выровнялась — плавно возвращается к')
console.log('     обычной формуле (baseAngle + range·altT).')
console.log('   • Гистерезис 0.8..1.2 по vx/|vy| — нет дрожания на границе.')
console.log('   • Скорость перехода: CFG.CAMERA.dive.blendSpeed (1/с).')
