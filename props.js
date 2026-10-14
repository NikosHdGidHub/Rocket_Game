/* ================================================================
   props.js — шаблоны деревьев/кустов/камней.
   Одна merged geometry на тип, цвет через vertex colors.
================================================================ */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import * as CFG from './config.js'

export function setGeoColor(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

export function buildPineTemplate() {
  const C = CFG.PROPS.colors
  const geos = []
  const h = 3.6
  const trunk = new THREE.CylinderGeometry(0.18, 0.28, h, 6)
  trunk.translate(0, h / 2, 0)
  geos.push(setGeoColor(trunk, C.trunk))

  for (let i = 0; i < 3; i++) {
    const r = 1.55 - i * 0.32
    const lh = 1.8 - i * 0.15
    const cone = new THREE.ConeGeometry(r, lh, 7)
    cone.translate(0, h + i * (lh * 0.5) + lh * 0.3, 0)
    geos.push(setGeoColor(cone, C.pine))
  }
  return mergeGeometries(geos)
}

export function buildOakTemplate() {
  const C = CFG.PROPS.colors
  const geos = []
  const th = 2.2
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, th, 6)
  trunk.translate(0, th / 2, 0)
  geos.push(setGeoColor(trunk, C.trunk))

  const blobs = [
    [0.0, th + 0.9, 0.0, 1.15],
    [0.6, th + 1.3, -0.4, 0.95],
    [-0.5, th + 1.4, 0.5, 0.9],
    [0.2, th + 1.9, -0.1, 0.85],
  ]
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.SphereGeometry(r, 8, 6)
    s.translate(x, y, z)
    geos.push(setGeoColor(s, C.oak))
  }
  return mergeGeometries(geos)
}

export function buildBushTemplate() {
  const C = CFG.PROPS.colors
  const geos = []
  const blobs = [
    [0.0, 0.55, 0.0, 0.65],
    [0.4, 0.45, -0.3, 0.55],
    [-0.35, 0.5, 0.35, 0.55],
  ]
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.SphereGeometry(r, 7, 5)
    s.translate(x, y, z)
    geos.push(setGeoColor(s, C.bush))
  }
  return mergeGeometries(geos)
}

export function buildRockTemplate() {
  const g = new THREE.IcosahedronGeometry(1, 0)
  g.scale(1, 0.75, 1)
  return setGeoColor(g, CFG.PROPS.colors.rock)
}

export const TEMPLATES = {
  pine: buildPineTemplate(),
  oak: buildOakTemplate(),
  bush: buildBushTemplate(),
  rock: buildRockTemplate(),
}
