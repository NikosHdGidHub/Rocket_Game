// fix4.mjs — починка far-tiles: throttling + перезапрос при seg-mismatch + periodic check
// Запуск: node fix4.mjs
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
// 1) farTiles.js — refillFarTiles: throttling + !== + порядок unload
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/farTiles.js')
  let s = text

  const OLD = `export function refillFarTiles(camX, camZ) {
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)
  const L = getFarLoadBounds()
  const U = getFarUnloadBounds()

  for (let dx = -L.back; dx <= L.fwd; dx++) {
    for (let dz = -L.side; dz <= L.side; dz++) {
      const fx = fxi + dx
      const fz = fzi + dz
      const key = fx + ',' + fz
      const loaded = state.farTiles.get(key)
      const pending = state.pendingFarTiles.has(key)

      if (loaded && loaded.seg < state.farTileSeg) {
        if (!pending) {
          state.pendingFarTiles.add(key)
          state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
        }
        continue
      }

      if (!loaded && !pending) {
        state.pendingFarTiles.add(key)
        state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
      }
    }
  }

  for (const key of state.pendingFarTiles) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      state.pendingFarTiles.delete(key)
    }
  }

  const toUnload = []
  for (const key of state.farTiles.keys()) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadFarTile(k)
}`

  const NEW = `export function refillFarTiles(camX, camZ) {
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)
  const L = getFarLoadBounds()
  const U = getFarUnloadBounds()

  // 1) Unload — сначала освобождаем место
  const toUnload = []
  for (const key of state.farTiles.keys()) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadFarTile(k)

  // 2) Чистим pending за unload-границей
  for (const key of state.pendingFarTiles) {
    const [fxs, fzs] = key.split(',')
    const fx = +fxs
    const fz = +fzs
    if (fx - fxi > U.fwd || fxi - fx > U.back || Math.abs(fz - fzi) > U.side) {
      state.pendingFarTiles.delete(key)
    }
  }

  // 3) Собираем запросы: отсутствующие и «устаревшие по seg» (в обе стороны!)
  const requests = []
  for (let dx = -L.back; dx <= L.fwd; dx++) {
    for (let dz = -L.side; dz <= L.side; dz++) {
      const fx = fxi + dx
      const fz = fzi + dz
      const key = fx + ',' + fz
      const loaded = state.farTiles.get(key)
      const pending = state.pendingFarTiles.has(key)

      if (loaded && loaded.seg !== state.farTileSeg) {
        if (!pending) requests.push({ fx, fz })
        continue
      }
      if (!loaded && !pending) requests.push({ fx, fz })
    }
  }

  // 4) Throttling: не больше MAX_PER_CALL за вызов. Иначе mode-change
  //    отправляет лавину в один воркер, ответы «стареют», pending
  //    не закрывается успешно — мерцание и накопление дыр.
  const MAX_PER_CALL = 6
  const n = Math.min(requests.length, MAX_PER_CALL)
  for (let i = 0; i < n; i++) {
    const { fx, fz } = requests[i]
    const key = fx + ',' + fz
    state.pendingFarTiles.add(key)
    state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
  }
}`

  s = replaceOrSkip(s, OLD, NEW, 'farTiles.js / refillFarTiles')
  write('scripts/views/lod/farTiles.js', s, isCRLF)
}

// ============================================================
// 2) farTiles.js — handleFarMessage: перезапрос при seg-mismatch
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/farTiles.js')
  let s = text

  const OLD = `  if (!state.pendingFarTiles.has(key)) return
  state.pendingFarTiles.delete(key)

  if (seg !== state.farTileSeg) return

  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, seg, seg)`

  const NEW = `  if (!state.pendingFarTiles.has(key)) return
  state.pendingFarTiles.delete(key)

  if (seg !== state.farTileSeg) {
    // Ответ пришёл со «старым» seg (режим переключился, пока воркер считал).
    // Раньше здесь был просто \`return\` — тайл «терялся» и больше никогда
    // не перезагружался (если камера уже стоит). Отсюда мерцание и
    // накопление дыр со временем. Теперь сразу перезапрашиваем
    // с актуальным seg.
    state.pendingFarTiles.add(key)
    state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
    return
  }

  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, seg, seg)`

  s = replaceOrSkip(s, OLD, NEW, 'farTiles.js / handleFarMessage')
  write('scripts/views/lod/farTiles.js', s, isCRLF)
}

// ============================================================
// 3) lod/index.js — periodic check + getStats: диагностика
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/lod/index.js')
  let s = text

  // 3a) Периодический refill
  const OLD1 = `let _lastFar = { x: NaN, z: NaN }
let _lastOverlay = { x: NaN, z: NaN }

export function update(dt) {`
  const NEW1 = `let _lastFar = { x: NaN, z: NaN }
let _lastOverlay = { x: NaN, z: NaN }
let _farCheckTimer = 0
const FAR_PERIODIC_CHECK = 0.4 // сек

export function update(dt) {`
  s = replaceOrSkip(s, OLD1, NEW1, 'lod/index.js / timer vars')

  const OLD2 = `  const modeChanged = updateFarMode(lod.altSmooth)
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)

  if (modeChanged || fxi !== _lastFar.x || fzi !== _lastFar.z) {
    refillFarTiles(camX, camZ)
    _lastFar.x = fxi
    _lastFar.z = fzi
  }`
  const NEW2 = `  const modeChanged = updateFarMode(lod.altSmooth)
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)

  // Периодическая «зачистка дыр»: даже когда камера стоит и режим стабилен,
  // раз в FAR_PERIODIC_CHECK секунд дозапрашиваем недостающие / устаревшие
  // тайлы. Нужно из-за throttling в refillFarTiles: за один вызов
  // отправляется только MAX_PER_CALL запросов, остальные должны
  // «дозаполняться» в следующих вызовах, а не ждать движения камеры.
  _farCheckTimer += dt
  const periodicCheck = _farCheckTimer >= FAR_PERIODIC_CHECK
  if (periodicCheck) _farCheckTimer = 0

  if (modeChanged || fxi !== _lastFar.x || fzi !== _lastFar.z || periodicCheck) {
    refillFarTiles(camX, camZ)
    _lastFar.x = fxi
    _lastFar.z = fzi
  }`
  s = replaceOrSkip(s, OLD2, NEW2, 'lod/index.js / periodic check')

  // 3b) getStats — диагностика
  const OLD3 = `export function getStats() {
  return {
    farTiles: state.farTiles.size,
    overlayChunks: state.overlayChunks.size,
    pendingFar: state.pendingFarTiles.size,
    pendingOverlays: state.pendingOverlays.size,
  }
}`
  const NEW3 = `export function getStats() {
  let stale = 0
  for (const [, c] of state.farTiles) {
    if (c.seg !== state.farTileSeg) stale++
  }
  return {
    farTiles: state.farTiles.size,
    overlayChunks: state.overlayChunks.size,
    pendingFar: state.pendingFarTiles.size,
    pendingOverlays: state.pendingOverlays.size,
    farSeg: state.farTileSeg,
    farHighMode: state.farHighMode,
    farStale: stale, // сколько загруженных тайлов с устаревшим seg
  }
}`
  s = replaceOrSkip(s, OLD3, NEW3, 'lod/index.js / getStats')
  write('scripts/views/lod/index.js', s, isCRLF)
}

console.log('\n🎉 Готово. Перезапусти dev-сервер и проверь взлёт.')
