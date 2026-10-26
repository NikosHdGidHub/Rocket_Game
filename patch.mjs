// patch7.mjs — backShiftY: компенсирует смещение по X, держит угол 70°.
// Запуск: node patch7.mjs
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
// 1) config.js — документируем backShiftY (само значение вычисляется)
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `    /**
     * Дополнительный сдвиг камеры НАЗАД по мировому X (в метрах)
     * в момент вида сверху. Значение умножается на cam.dive (0..1),
     * поэтому плавность сдвига совпадает со скоростью наклона
     * (CFG.CAMERA.dive.blendSpeed).
     *
     * Эффект: в топ-вью камера отъезжает на backShiftX назад,
     * ракета и обзор «впереди» смещаются вверх кадра.
     * 0 = сдвига нет.
     */`

  const NEW = `    /**
     * Дополнительный сдвиг камеры НАЗАД по мировому X (в метрах)
     * в момент вида сверху. Значение умножается на cam.dive (0..1),
     * поэтому плавность сдвига совпадает со скоростью наклона
     * (CFG.CAMERA.dive.blendSpeed).
     *
     * Смещение по Y рассчитывается АВТОМАТИЧЕСКИ:
     *     backShiftY = backShiftX · tan(elevation)
     * — так угол «камера → ракета» остаётся ровно elevation°,
     *   несмотря на отъезд назад. При elevation = 70° и X = 10
     *   камера поднимается примерно на 27.5 м.
     *
     * Эффект: в топ-вью ракета остаётся под углом 70° к горизонту,
     * но сдвинута назад по X — обзор «вперёд» расширяется.
     * 0 = сдвига нет.
     */`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / backShiftY docs')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) camera.js — diveBackY и прибавление к camY
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/camera.js')
  let s = text

  const OLD = `  // В виде сверху (cam.dive → 1) камера дополнительно смещается
  // назад по X. Плавность сдвига совпадает со скоростью наклона,
  // т.к. cam.dive сглаживается через blendSpeed.
  const diveBackX = CFG.CAMERA.dive.backShiftX * cam.dive

  const camX = px - hDist * cam.blend - diveBackX
  const camY = py + vDist
  const camZ = pz + hDist * (1 - cam.blend)`

  const NEW = `  // В виде сверху (cam.dive → 1) камера дополнительно смещается
  // назад по X. Плавность сдвига совпадает со скоростью наклона,
  // т.к. cam.dive сглаживается через blendSpeed.
  //
  // backShiftY компенсирует отъезд по X так, чтобы угол
  // «камера → ракета» оставался ровно dive.elevation°.
  // Математика: (vDist + Y) / (hDist + X) = tan(elev)
  //             при Y = X·tan(elev), т.к. vDist/hDist = tan(elev).
  const diveElevRad = (CFG.CAMERA.dive.elevation * Math.PI) / 180
  const diveBackX = CFG.CAMERA.dive.backShiftX * cam.dive
  const diveBackY =
    CFG.CAMERA.dive.backShiftX * Math.tan(diveElevRad) * cam.dive

  const camX = px - hDist * cam.blend - diveBackX
  const camY = py + vDist + diveBackY
  const camZ = pz + hDist * (1 - cam.blend)`

  s = replaceOrSkip(s, OLD, NEW, 'camera.js / dive backShiftY')
  write('scripts/core/camera.js', s, isCRLF)
}

console.log('\n🎉 Готово.')
console.log('   • backShiftY = backShiftX · tan(dive.elevation) · cam.dive')
console.log('   • Угол «камера → ракета» в топ-вью остаётся ровно 70°')
console.log('   • Плавность та же — cam.dive, тот же blendSpeed')
