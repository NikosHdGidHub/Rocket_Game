// fix5.mjs — правит fix4: возвращает `loaded.seg < farTileSeg` (фича),
// handleFarMessage принимает детальные ответы, `farStale` считает только грубые.
// Запуск: node fix5.mjs
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
// 1) farTiles.js — вернуть `<` в refillFarTiles (это фича)
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/farTiles.js')
  let s = text

  const OLD = `      if (loaded && loaded.seg !== state.farTileSeg) {
        if (!pending) requests.push({ fx, fz })
        continue
      }`
  const NEW = `      // Фича: если уже загружен более детальный тайл (seg БОЛЬШЕ целевого),
      // не перерисовываем. Например, взлетаем на low-altitude (seg=190)
      // и переходим в high-altitude (farTileSeg=53) — детальный тайл
      // оставляем. При спуске farTileSeg=190 > loaded.seg=53 → перезапросим.
      if (loaded && loaded.seg < state.farTileSeg) {
        if (!pending) requests.push({ fx, fz })
        continue
      }`
  s = replaceOrSkip(s, OLD, NEW, 'farTiles.js / refillFarTiles < restored')
  write('scripts/views/lod/farTiles.js', s, isCRLF)
}

// ============================================================
// 2) farTiles.js — handleFarMessage: `seg <` вместо `seg !==`
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/farTiles.js')
  let s = text

  const OLD = `  if (seg !== state.farTileSeg) {
    // Ответ пришёл со «старым» seg (режим переключился, пока воркер считал).
    // Раньше здесь был просто \`return\` — тайл «терялся» и больше никогда
    // не перезагружался (если камера уже стоит). Отсюда мерцание и
    // накопление дыр со временем. Теперь сразу перезапрашиваем
    // с актуальным seg.
    state.pendingFarTiles.add(key)
    state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
    return
  }`

  const NEW = `  // Ответ грубее, чем нужно сейчас — перезапрашиваем.
  // Ответ детальнее (seg > farTileSeg) — принимаем как есть,
  // он лучше текущего целевого. Так совместимо с фичей "не портить
  // детальные тайлы при взлёте".
  if (seg < state.farTileSeg) {
    state.pendingFarTiles.add(key)
    state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
    return
  }`

  s = replaceOrSkip(s, OLD, NEW, 'farTiles.js / handleFarMessage seg <')
  write('scripts/views/lod/farTiles.js', s, isCRLF)
}

// ============================================================
// 3) lod/index.js — farStale считаем как `seg < farTileSeg`
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/index.js')
  let s = text

  const OLD = `  let stale = 0
  for (const [, c] of state.farTiles) {
    if (c.seg !== state.farTileSeg) stale++
  }`
  const NEW = `  let stale = 0
  for (const [, c] of state.farTiles) {
    // «Stale» — только те, что грубее текущего (нужна дорисовка).
    // Тайлы детальнее — это фича, не считаем их.
    if (c.seg < state.farTileSeg) stale++
  }`
  s = replaceOrSkip(s, OLD, NEW, 'lod/index.js / farStale <')
  write('scripts/views/lod/index.js', s, isCRLF)
}

console.log('\n🎉 Готово. Проверь взлёт/спуск ещё раз.')