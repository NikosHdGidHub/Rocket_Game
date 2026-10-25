/* ================================================================
   props.js — материал пропсов + кэш prop-items на чанк.
   Здесь же — сбор items с halo для запекания теней.
================================================================ */
import '../../lib/settings.js' // side effect: quality preset → CFG.*
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { computeChunkProps } from '../../world/chunkProps.js'

/* ---------- Материал пропсов — один на всех, с vertex colors.
   applySkyFog вызывается из init() в index.js. ---------- */
export const propMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: CFG.PROPS.material.roughness,
  metalness: CFG.PROPS.material.metalness,
  flatShading: false,
})

/* ---------- Кэш prop-items на чанк ---------- */
export const propsCache = new Map()

export function getProps(cx, cz) {
  const key = cx + ',' + cz
  let items = propsCache.get(key)
  if (!items) {
    items = computeChunkProps(cx, cz)
    propsCache.set(key, items)
  }
  return items
}

/**
 * Собираем items с halo для запекания теней.
 * Свет с +X/+Z → тень уходит в −X/−Z.
 */
export function collectShadowItems(cx, cz) {
  return [
    ...getProps(cx - 1, cz - 1),
    ...getProps(cx - 1, cz),
    ...getProps(cx - 1, cz + 1),
    ...getProps(cx, cz - 1),
    ...getProps(cx, cz),
    ...getProps(cx, cz + 1),
    ...getProps(cx + 1, cz - 1),
    ...getProps(cx + 1, cz),
    ...getProps(cx + 1, cz + 1),
  ]
}
