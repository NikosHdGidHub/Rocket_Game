// patch6.mjs — в виде сверху камера смещается назад по X на dive.backShiftX.
// Запуск: node patch6.mjs
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
// 1) config.js — добавляем backShiftX в блок dive
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `    /** Скорость сглаживания перехода (1/с). 4 ≈ 0.25 с на 63% пути. */
    blendSpeed: 0.8,`

  const NEW = `    /** Скорость сглаживания перехода (1/с). 4 ≈ 0.25 с на 63% пути. */
    blendSpeed: 0.8,

    /**
     * Дополнительный сдвиг камеры НАЗАД по мировому X (в метрах)
     * в момент вида сверху. Значение умножается на cam.dive (0..1),
     * поэтому плавность сдвига совпадает со скоростью наклона
     * (CFG.CAMERA.dive.blendSpeed).
     *
     * Эффект: в топ-вью камера отъезжает на backShiftX назад,
     * ракета и обзор «впереди» смещаются вверх кадра.
     * 0 = сдвига нет.
     */
    backShiftX: 10,
  },`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / dive.backShiftX')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) camera.js — применяем сдвиг к camX
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/camera.js')
  let s = text

  const OLD = `  const camX = px - hDist * cam.blend
  const camY = py + vDist
  const camZ = pz + hDist * (1 - cam.blend)`

  const NEW = `  // В виде сверху (cam.dive → 1) камера дополнительно смещается
  // назад по X. Плавность сдвига совпадает со скоростью наклона,
  // т.к. cam.dive сглаживается через blendSpeed.
  const diveBackX = CFG.CAMERA.dive.backShiftX * cam.dive

  const camX = px - hDist * cam.blend - diveBackX
  const camY = py + vDist
  const camZ = pz + hDist * (1 - cam.blend)`

  s = replaceOrSkip(s, OLD, NEW, 'camera.js / dive backShiftX')
  write('scripts/core/camera.js', s, isCRLF)
}

console.log('\n🎉 Готово.')
console.log('   • В виде сверху камера плавно смещается на -10 по X')
console.log('   • Плавность = cam.dive, т.е. тот же blendSpeed')
console.log('   • Настройка: CFG.CAMERA.dive.backShiftX (м)')
