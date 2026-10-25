/* ================================================================
   state.js — состояние и константы модуля LOD.
   Общие Maps/Sets и ссылки для far-tile, overlay и fade.
================================================================ */
import * as CFG from '../../config.js'

export const FAR_TILE_SIZE = CFG.FAR_TILES.size
export const OVERLAY_SIZE = CFG.OVERLAY.size
export const OVERLAY_SEG = CFG.OVERLAY.segments
export const OVERLAY_CANVAS = CFG.OVERLAY.canvasSize
export const OVERLAY_LOAD_R = CFG.OVERLAY.loadRadius
export const OVERLAY_UNLOAD_R = CFG.OVERLAY.unloadRadius

export const state = {
  /* ---------- Общие ссылки ---------- */
  lodWorker: null,
  farGroundMat: null,

  /* ---------- Far tiles ---------- */
  farTileSeg: CFG.FAR_TILES.segments,
  farHighMode: false,
  farTiles: new Map(),
  pendingFarTiles: new Set(),

  /* ---------- Overlay ---------- */
  overlayChunks: new Map(),
  pendingOverlays: new Set(),

  /* ---------- Кэши для fade.js ---------- */
  lastOverlayOpacity: -1,
  lastFarOpacity: -1,
  lastShowFineChunks: null,
}
