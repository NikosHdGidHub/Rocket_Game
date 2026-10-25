/* ================================================================
   sign.js — 3D-надпись "NIKOS GAME" в небе (стиль Universal-logo).

   — TextGeometry с bevel-ом → настоящий объём.
   — Запечённые тени: цвет вершин считается из нормали и
     фиксированного «направления света». Надпись выглядит
     одинаково в любое время суток и не зависит от сцены.
   — Всё настраивается в CFG.SIGN (config.js).
   — Статична, висит в воздухе лицом против движения ракеты.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import { scene } from './scene.js'
import { FontLoader } from 'three/addons/loaders/FontLoader.js'
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js'

const S = CFG.SIGN
let signGroup = null
let initialized = false

export async function init() {
  if (!S.enabled || initialized) return
  initialized = true

  let font
  try {
    font = await loadFont(S.fontUrl)
  } catch (e) {
    console.warn('[sign] не удалось загрузить шрифт:', e)
    return
  }

  try {
    buildSign(font)
    console.log('[sign] надпись построена')
  } catch (e) {
    console.error('[sign] ошибка построения:', e)
  }
}

function loadFont(url) {
  return new Promise((resolve, reject) => {
    new FontLoader().load(url, resolve, undefined, reject)
  })
}

function buildSign(font) {
  const totalHeight = S.position.topY - S.position.bottomY // = 400

  // Строим в «условных» единицах, потом масштабируем под target.
  const buildSize = 100
  const depth = buildSize * S.depthRatio

  const opts = {
    font,
    size: buildSize,
    height: depth,
    curveSegments: S.curveSegments,
    bevelEnabled: S.bevel.enabled,
    bevelThickness: buildSize * S.bevel.thicknessRatio,
    bevelSize: buildSize * S.bevel.sizeRatio,
    bevelSegments: S.bevel.segments,
  }

  const geo1 = new TextGeometry(S.text.line1, opts)
  const geo2 = new TextGeometry(S.text.line2, opts)
  geo1.computeBoundingBox()
  geo2.computeBoundingBox()

  const bb1 = geo1.boundingBox
  const bb2 = geo2.boundingBox
  const h1 = bb1.max.y - bb1.min.y
  const h2 = bb2.max.y - bb2.min.y

  // Зазор между строками (от высоты большей строки)
  const gap = Math.max(h1, h2) * S.lineGapRatio
  const naturalTotal = h2 + gap + h1
  const scale = totalHeight / naturalTotal

  // ── Позиционируем в локальных координатах ──
  // Низ второй строки — в начале координат.
  geo2.translate(
    -(bb2.max.x + bb2.min.x) / 2,
    -bb2.min.y,
    -(bb2.max.z + bb2.min.z) / 2
  )
  // Первая строка — над второй, через gap.
  geo1.translate(
    -(bb1.max.x + bb1.min.x) / 2,
    h2 + gap - bb1.min.y,
    -(bb1.max.z + bb1.min.z) / 2
  )

  // Общий масштаб под целевую высоту (400 м)
  geo1.scale(scale, scale, scale)
  geo2.scale(scale, scale, scale)

  // Запекаем градиент «золото + тень» в цвета вершин.
  bakeGoldColors(geo1)
  bakeGoldColors(geo2)

  // Один материал на обе строки — экономит state-переключения.
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    toneMapped: false, // не глушим ACES-ом — золото остаётся ярким
    fog: S.fog,
    side: THREE.FrontSide,
  })

  signGroup = new THREE.Group()
  signGroup.add(new THREE.Mesh(geo1, mat))
  signGroup.add(new THREE.Mesh(geo2, mat))

  // Ставим в мир: low второй строки = bottomY, верх первой = topY.
  signGroup.position.set(S.position.x, S.position.bottomY, S.position.z ?? 0)

  // Лицом против движения ракеты: ракета летит +X, набегает с −X.
  // Локальный +Z текста → мировой −X.
  signGroup.rotation.y = -Math.PI / 2

  scene.add(signGroup)
}

/**
 * Запекает «золотой градиент с тенью» в vertex colors.
 * Свет фиксирован в локальных координатах текста:
 *   -X — слева, +Y — сверху, +Z — со стороны зрителя.
 */
function bakeGoldColors(geo) {
  if (!geo.attributes.normal) geo.computeVertexNormals()

  const pos = geo.attributes.position
  const nrm = geo.attributes.normal
  const n = pos.count
  const colors = new Float32Array(n * 3)

  const L = new THREE.Vector3(...S.bakedLightDir).normalize()
  const cShadow = new THREE.Color(S.colors.shadow)
  const cBase = new THREE.Color(S.colors.base)
  const cHigh = new THREE.Color(S.colors.highlight)
  const ambient = S.bakedAmbient
  const contrast = S.bakedContrast

  for (let i = 0; i < n; i++) {
    const nx = nrm.getX(i)
    const ny = nrm.getY(i)
    const nz = nrm.getZ(i)
    const d = nx * L.x + ny * L.y + nz * L.z

    // Diffuse 0..1 → ambient..1 → контраст
    let b = Math.max(0, d)
    b = ambient + b * (1 - ambient)
    b = Math.pow(b, contrast)

    let r, g, bl
    if (b < 0.5) {
      // тёмное → базовое золото
      const k = b / 0.5
      r = cShadow.r + (cBase.r - cShadow.r) * k
      g = cShadow.g + (cBase.g - cShadow.g) * k
      bl = cShadow.b + (cBase.b - cShadow.b) * k
    } else {
      // базовое → светлый блик
      const k = (b - 0.5) / 0.5
      r = cBase.r + (cHigh.r - cBase.r) * k
      g = cBase.g + (cHigh.g - cBase.g) * k
      bl = cBase.b + (cHigh.b - cBase.b) * k
    }

    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = bl
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}