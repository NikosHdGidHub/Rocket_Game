/* ================================================================
   constants.js — константы модуля чанков.
   Читаются из CFG на момент импорта (после quality preset).
================================================================ */
import * as CFG from '../../config.js'

export const CHUNK_SIZE = CFG.CHUNKS.size
export const CHUNK_SEG = CFG.CHUNKS.segments
export const LOAD_FWD_CHUNKS = CFG.CHUNKS.loadForward
export const LOAD_BACK_CHUNKS = CFG.CHUNKS.loadBack
export const LOAD_SIDE_CHUNKS = CFG.CHUNKS.loadSide
export const UNLOAD_MARGIN = CFG.CHUNKS.unloadMargin
export const PROPS_COUNT = CFG.PROPS.density
