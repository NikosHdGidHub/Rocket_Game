/* ================================================================
   props.js — шаблоны деревьев/кустов/камней.
   Одна merged geometry на тип, цвет через vertex colors.
================================================================ */
import * as THREE from 'three'
import { mergeGeometries as mergeGeometriesRaw } from 'three/addons/utils/BufferGeometryUtils.js'
import * as CFG from '../config.js'

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

/* ================================================================
   mergeGeometries — безопасная обёртка.

   Родной mergeGeometries из three/addons падает (возвращает null),
   если смешать indexed и non-indexed геометрии в одном вызове.
   А у нас в шаблонах встречаются оба семейства:
     • Cylinder / Sphere / Cone / Box  → indexed
     • Icosahedron / Octahedron        → non-indexed
   Поэтому перед merge приводим всё к non-indexed. Для low-poly
   шаблонов vertex count растёт незначительно и в InstancedMesh
   не дублируется.
================================================================ */
function mergeGeometries(geos) {
  if (!geos || geos.length === 0) return null
  if (geos.length === 1) return geos[0]

  const normalized = geos.map((g) => {
    if (g.index === null) return g
    const n = g.toNonIndexed()
    g.dispose()
    return n
  })

  return mergeGeometriesRaw(normalized)
}

/* ================================================================
   ДЕРЕВЬЯ
================================================================ */

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

/** Берёза: тонкий белый ствол, разреженная крона (3 шара, ниже и легче дуба). */
export function buildBirchTemplate() {
  const C = CFG.PROPS.colors
  const geos = []
  const th = 3.2
  const trunk = new THREE.CylinderGeometry(0.14, 0.22, th, 6)
  trunk.translate(0, th / 2, 0)
  geos.push(setGeoColor(trunk, C.birchTrunk))
  const blobs = [
    [0.0, th + 0.7, 0.0, 0.85],
    [0.5, th + 1.1, -0.3, 0.65],
    [-0.4, th + 1.0, 0.4, 0.7],
  ]
  for (const [x, y, z, r] of blobs) {
    const s = new THREE.SphereGeometry(r, 7, 5)
    s.translate(x, y, z)
    geos.push(setGeoColor(s, C.birchLeaves))
  }
  return mergeGeometries(geos)
}

/** Сухое дерево: голый ствол + три обломка веток. */
export function buildDeadTreeTemplate() {
  const C = CFG.PROPS.colors
  const geos = []
  const th = 3.5
  const trunk = new THREE.CylinderGeometry(0.15, 0.3, th, 5)
  trunk.translate(0, th / 2, 0)
  geos.push(setGeoColor(trunk, C.deadTrunk))
  const branches = [
    { y: th * 0.55, angle: 0.7, len: 1.2 },
    { y: th * 0.72, angle: -0.9, len: 0.9 },
    { y: th * 0.86, angle: 0.3, len: 0.8 },
  ]
  for (const b of branches) {
    const g = new THREE.CylinderGeometry(0.06, 0.11, b.len, 4)
    g.translate(0, b.len / 2, 0)
    g.rotateZ(b.angle)
    g.translate(0, b.y, 0)
    geos.push(setGeoColor(g, C.deadBranch))
  }
  return mergeGeometries(geos)
}

/** Ель: один узкий конус — по силуэту отличается от 3-ярусной сосны. */
export function buildSpruceTemplate() {
  const C = CFG.PROPS.colors
  const geos = []
  const h = 4.5
  const trunk = new THREE.CylinderGeometry(0.16, 0.24, h, 6)
  trunk.translate(0, h / 2, 0)
  geos.push(setGeoColor(trunk, C.trunk))
  const cone = new THREE.ConeGeometry(1.1, h * 0.9, 8)
  cone.translate(0, h * 0.7, 0)
  geos.push(setGeoColor(cone, C.spruce))
  return mergeGeometries(geos)
}

/* ================================================================
   КУСТЫ
================================================================ */

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

/* ================================================================
   КАМНИ
================================================================ */

export function buildRockTemplate() {
  const g = new THREE.IcosahedronGeometry(1, 0)
  g.scale(1, 0.75, 1)
  return setGeoColor(g, CFG.PROPS.colors.rock)
}

export function buildSharpRockTemplate() {
  const C = CFG.PROPS.colors
  const base = new THREE.IcosahedronGeometry(1, 1)
  base.scale(1.0, 0.9, 1.0)
  setGeoColor(base, C.boulder)

  const moss = new THREE.SphereGeometry(0.75, 6, 4)
  moss.scale(1.0, 0.35, 1.0)
  moss.translate(0, 0.7, 0)
  setGeoColor(moss, C.oak) // любой зелёный

  return mergeGeometries([base, moss])
}

/** Плоская плита. */
export function buildFlatRockTemplate() {
  const g = new THREE.IcosahedronGeometry(1, 0)
  g.scale(1.4, 0.25, 1.0)
  return setGeoColor(g, CFG.PROPS.colors.flatRock)
}

/* ================================================================
   BUILDERS + TEMPLATES (единый источник правды о видах)
================================================================ */

/* ================================================================
   BUILDERS + TEMPLATES
================================================================ */
export const BUILDERS = {
  pine: buildPineTemplate,
  oak: buildOakTemplate,
  birch: buildBirchTemplate,
  deadTree: buildDeadTreeTemplate,
  spruce: buildSpruceTemplate,
  bush: buildBushTemplate,
  rock: buildRockTemplate,
  sharpRock: buildSharpRockTemplate,
  flatRock: buildFlatRockTemplate,
}

export const TEMPLATES = {}
for (const kind of Object.keys(CFG.PROPS.kinds)) {
  const builder = BUILDERS[kind]
  if (!builder) {
    console.warn(`[props] Нет builder для kind="${kind}" — пропускаю`)
    continue
  }
  try {
    const geo = builder()
    if (!geo) {
      console.error(`[props] "${kind}": builder вернул null — пропускаю`)
      continue
    }
    TEMPLATES[kind] = geo
  } catch (err) {
    console.error(`[props] "${kind}": исключение при сборке — пропускаю`, err)
  }
}

/* ================================================================
   Категории — производные от CFG.PROPS.kinds
================================================================ */
export const KIND_META = CFG.PROPS.kinds
export const KINDS = Object.keys(TEMPLATES)
export const ROCK_KINDS = KINDS.filter((k) => KIND_META[k].category === 'rock')
export const TREE_KINDS = KINDS.filter((k) => KIND_META[k].category === 'tree')
export const SHRUB_KINDS = KINDS.filter((k) => KIND_META[k].category === 'shrub')

/** Радиус запекаемой тени, 0 = не отбрасывает. */
export function shadowRadiusOf(kind) {
  return KIND_META[kind]?.shadowR || 0
}
