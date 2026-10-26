// patch4.mjs — эллипс тумана: фиксированное направление +X, без вращения.
// Запуск: node patch4.mjs
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
// 1) config.js — убираем dirMinSpeed / dirSmoothing
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `  /** Множитель дальности В СТОРОНЫ (перпендикулярно полёту).*/
  ellipseSide: 0.6,

  /** Множитель дальности НАЗАД.*/
  ellipseBack: 0.3,

  /**
   * Минимальная горизонтальная скорость ракеты (м/с) для обновления
   * направления эллипса. Ниже — направление «замораживается»,
   * чтобы эллипс не крутился на месте.
   * [типично] 1–4.
   */
  dirMinSpeed: 2.0,

  /**
   * Скорость сглаживания поворота эллипса (1/с).
   * 0 = мгновенно, больше = плавнее. Не даёт «щёлкнуть» при резком
   * развороте ракеты.
   * [типично] 3–8.
   */
  dirSmoothing: 4.0,`

  const NEW = `  /**
   * Множитель дальности В СТОРОНЫ (перпендикулярно оси эллипса).
   * Ось эллипса ФИКСИРОВАНА вдоль +X — вращение отключено.
   */
  ellipseSide: 0.6,

  /**
   * Множитель дальности НАЗАД (в −X).
   * Ось эллипса ФИКСИРОВАНА вдоль +X — вращение отключено.
   */
  ellipseBack: 0.3,`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / remove dirMinSpeed & dirSmoothing')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) fade.js — updateFogEllipse больше не трогает направление
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/fade.js')
  let s = text

  const OLD = `export function updateFogEllipse(dt) {
  fogU.center.value.set(rocketState.pos.x, rocketState.pos.z)
  const v = rocketState.vel
  const speed = Math.hypot(v.x, v.z)

  if (speed >= CFG.FOG.dirMinSpeed) {
    const tx = v.x / speed
    const tz = v.z / speed
    const k = 1 - Math.exp(-CFG.FOG.dirSmoothing * dt)
    fogU.dir.value.x += (tx - fogU.dir.value.x) * k
    fogU.dir.value.y += (tz - fogU.dir.value.y) * k
    const l = Math.hypot(fogU.dir.value.x, fogU.dir.value.y) || 1
    fogU.dir.value.x /= l
    fogU.dir.value.y /= l
  }
}`

  const NEW = `/**
 * Обновляет ЦЕНТР эллиптического тумана под ракетой.
 *
 * Направление эллипса ФИКСИРОВАНО вдоль +X (fogU.dir = (1, 0) в scene.js).
 * Вращение отключено: не зависим от скорости и направления полёта.
 */
export function updateFogEllipse() {
  fogU.center.value.set(rocketState.pos.x, rocketState.pos.z)
}`

  s = replaceOrSkip(s, OLD, NEW, 'fade.js / updateFogEllipse center-only')
  write('scripts/views/lod/fade.js', s, isCRLF)
}

// ============================================================
// 3) lod/index.js — вызов без dt
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/index.js')
  let s = text

  s = replaceOrSkip(
    s,
    `  updateFogEllipse(dt)`,
    `  updateFogEllipse()`,
    'lod/index.js / call without dt'
  )
  write('scripts/views/lod/index.js', s, isCRLF)
}

// ============================================================
// 4) scene.js — фиксируем комментарий у dir
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/scene.js')
  let s = text

  const OLD = `export const fogU = {
  center: { value: new THREE.Vector2(0, 0) },
  dir: { value: new THREE.Vector2(1, 0) },
  shapeSide: { value: CFG.FOG.ellipseSide },
  shapeBack: { value: CFG.FOG.ellipseBack },
}`

  const NEW = `export const fogU = {
  center: { value: new THREE.Vector2(0, 0) },
  // Направление эллипса ФИКСИРОВАНО вдоль +X.
  // Вращение отключено — значение не мутируется в рантайме.
  dir: { value: new THREE.Vector2(1, 0) },
  shapeSide: { value: CFG.FOG.ellipseSide },
  shapeBack: { value: CFG.FOG.ellipseBack },
}`

  s = replaceOrSkip(s, OLD, NEW, 'scene.js / fogU.dir comment')
  write('scripts/views/scene.js', s, isCRLF)
}

console.log('\n🎉 Готово.')
console.log('   • Эллипс тумана всегда вытянут вдоль +X')
console.log('   • Вращение отключено (fogU.dir не мутируется)')
console.log('   • Удалены CFG.FOG.dirMinSpeed и CFG.FOG.dirSmoothing')
console.log('   • updateFogEllipse() теперь только ставит центр под ракетой')
