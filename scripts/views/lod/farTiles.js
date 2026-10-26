/* ================================================================
   farTiles.js — управление дальними тайлами земли.
   Запросы, финализация (добавление в сцену), выгрузка,
   переключение low/high режима.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene } from '../scene.js'
import { lod } from '../../state.js'
import { state, FAR_TILE_SIZE } from './state.js'

function getFarLoadBounds() {
  if (state.farHighMode) {
    return {
      fwd: CFG.FAR_TILES.loadFwdHigh,
      back: CFG.FAR_TILES.loadBackHigh,
      side: CFG.FAR_TILES.loadSideHigh,
    }
  }
  return {
    fwd: CFG.FAR_TILES.loadFwd,
    back: CFG.FAR_TILES.loadBack,
    side: CFG.FAR_TILES.loadSide,
  }
}

function getFarUnloadBounds() {
  const m = CFG.FAR_TILES.unloadMargin
  const L = getFarLoadBounds()
  return { fwd: L.fwd + m, back: L.back + m, side: L.side + m }
}

export function updateFarMode(altSmooth) {
  const F = CFG.FAR_TILES
  let next = state.farHighMode
  if (!state.farHighMode && altSmooth > F.altitudeHigh) next = true
  else if (state.farHighMode && altSmooth < F.altitudeLow) next = false

  if (next === state.farHighMode) return false
  state.farHighMode = next
  state.farTileSeg = state.farHighMode ? F.segmentsHigh : F.segments
  return true
}

function finalizeFarTile(key, fx, fz, geo, seg) {
  const old = state.farTiles.get(key)
  if (old) {
    scene.remove(old.mesh)
    old.geo.dispose()
  }
  const mesh = new THREE.Mesh(geo, state.farGroundMat)
  mesh.position.set(
    fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2,
    0,
    fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  )
  mesh.receiveShadow = false
  mesh.visible = lod.fade > 0.005
  scene.add(mesh)
  state.farTiles.set(key, { mesh, geo, seg })
}

function unloadFarTile(key) {
  state.pendingFarTiles.delete(key)
  const c = state.farTiles.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  state.farTiles.delete(key)
}

export function refillFarTiles(camX, camZ) {
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

      // Фича: если уже загружен более детальный тайл (seg БОЛЬШЕ целевого),
      // не перерисовываем. Например, взлетаем на low-altitude (seg=190)
      // и переходим в high-altitude (farTileSeg=53) — детальный тайл
      // оставляем. При спуске farTileSeg=190 > loaded.seg=53 → перезапросим.
      if (loaded && loaded.seg < state.farTileSeg) {
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
}

export function handleFarMessage(data) {
  const { fx, fz, seg, posArr, uvArr, nrmArr, colArr } = data
  const key = fx + ',' + fz

  if (!state.pendingFarTiles.has(key)) return
  state.pendingFarTiles.delete(key)

  // Ответ грубее, чем нужно сейчас — перезапрашиваем.
  // Ответ детальнее (seg > farTileSeg) — принимаем как есть,
  // он лучше текущего целевого. Так совместимо с фичей "не портить
  // детальные тайлы при взлёте".
  if (seg < state.farTileSeg) {
    state.pendingFarTiles.add(key)
    state.lodWorker.postMessage({ type: 'far', fx, fz, seg: state.farTileSeg })
    return
  }

  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, seg, seg)
  geo.rotateX(-Math.PI / 2)
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2))
  geo.setAttribute('normal', new THREE.BufferAttribute(nrmArr, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

  finalizeFarTile(key, fx, fz, geo, seg)
}
