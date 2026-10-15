/* ================================================================
   main.js — точка входа игры.
   Здесь: рендер, сцена, камера, чанки, пропсы, босс, ракета,
   игровая логика, ввод, главный цикл.

   Настройки — в config.js.
   Математика мира — в world.js.
   Шаблоны пропсов — в props.js.
================================================================ */

import * as THREE from 'three'
import * as CFG from './config.js'
import {
  WORLD_SEED,
  hash2i,
  mulberry32,
  terrainBase,
  terrainHeight,
  heightToTerrainColor,
  terrainBrightnessNoise,
  makeGroundTexture,
  GROUND_TILE,
  collectForestSpheres,
  forestDensityFromSpheres,
} from './world.js'
import { TEMPLATES } from './props.js'

/* ================================================================
   0. RNG state
================================================================ */
let currentRng = Math.random
const rnd = () => currentRng()

/* ================================================================
   1. RENDERER / SCENE / CAMERA
================================================================ */
const renderer = new THREE.WebGLRenderer({
  antialias: CFG.RENDERER.antialias,
})
renderer.setPixelRatio(Math.min(devicePixelRatio, CFG.RENDERER.pixelRatioCap))
renderer.setSize(innerWidth, innerHeight)

renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = CFG.RENDERER.toneMappingExposure

renderer.shadowMap.enabled = CFG.LIGHTS.shadow.enabled
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.appendChild(renderer.domElement)

const camera = new THREE.PerspectiveCamera(
  CFG.CAMERA.fov,
  innerWidth / innerHeight,
  CFG.CAMERA.near,
  CFG.CAMERA.far
)
camera.position.set(...CFG.CAMERA.initial)

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})

/* ================================================================
   1b. НЕБО — градиентный купол + солнце (шейдер)
================================================================ */
const SKY_ZENITH = new THREE.Color(CFG.SKY.zenith)
const SKY_HORIZON = new THREE.Color(CFG.SKY.horizon)
const SUN_COLOR = new THREE.Color(CFG.SKY.sun)

const scene = new THREE.Scene()
scene.fog = new THREE.Fog(CFG.SKY.horizon, CFG.FOG.initialNear, CFG.FOG.initialFar)

const SUN_DIR = new THREE.Vector3(...CFG.SKY.sunDir).normalize()

const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    topColor: { value: SKY_ZENITH.clone() },
    bottomColor: { value: SKY_HORIZON.clone() },
    sunColor: { value: SUN_COLOR.clone() },
    sunDir: { value: SUN_DIR.clone() },
    exponent: { value: CFG.SKY.exponent },
    hazeColor: { value: new THREE.Vector3(...CFG.SKY.hazeColor) },
    hazePow: { value: CFG.SKY.hazePow },
    glowPow: { value: CFG.SKY.glowPow },
    glowAmt: { value: CFG.SKY.glowAmt },
    corePow: { value: CFG.SKY.corePow },
    coreAmt: { value: CFG.SKY.coreAmt },
  },
  vertexShader: `
    varying vec3 vWorldPos;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldPos = wp.xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform vec3  topColor;
    uniform vec3  bottomColor;
    uniform vec3  sunColor;
    uniform vec3  sunDir;
    uniform float exponent;
    uniform vec3  hazeColor;
    uniform float hazePow;
    uniform float glowPow;
    uniform float glowAmt;
    uniform float corePow;
    uniform float coreAmt;
    varying vec3 vWorldPos;

    void main() {
      vec3 dir = normalize(vWorldPos - cameraPosition);
      float h = max(dir.y, 0.0);
      float t = pow(h, exponent);
      vec3 col = mix(bottomColor, topColor, t);

      float haze = exp(-h * hazePow);
      col = mix(col, col + hazeColor, haze);

      float d    = max(dot(dir, normalize(sunDir)), 0.0);
      float glow = pow(d, glowPow) * glowAmt;
      float core = pow(d, corePow) * coreAmt;
      col += sunColor * (glow + core);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
})

const skyDome = new THREE.Mesh(
  new THREE.SphereGeometry(CFG.SKY.domeRadius, CFG.SKY.domeSegW, CFG.SKY.domeSegH),
  skyMat
)
skyDome.frustumCulled = false
skyDome.renderOrder = -1
scene.add(skyDome)

/* ---------- Elliptical fog uniforms ----------
   Один набор uniform-объектов, разделяемый всеми материалами через
   applySkyFog. Обновляется каждый кадр в updateFogEllipse().
*/
const fogU = {
  /** Центр эллипса (XZ-проекция позиции ракеты). */
  center: { value: new THREE.Vector2(0, 0) },

  /** Направление эллипса (XZ-проекция нормированной скорости). */
  dir: { value: new THREE.Vector2(1, 0) },

  /** Множитель дальности в стороны (из config). */
  shapeSide: { value: CFG.FOG.ellipseSide },

  /** Множитель дальности назад (из config). */
  shapeBack: { value: CFG.FOG.ellipseBack },
}

/* ---------- Sky-matching fog ---------- */
function applySkyFog(mat) {
  mat.onBeforeCompile = (shader) => {
    // --- Sky-matching ---
    shader.uniforms.skyTop = { value: SKY_ZENITH }
    shader.uniforms.skyBottom = { value: SKY_HORIZON }
    shader.uniforms.skyExponent = { value: CFG.SKY.exponent }
    shader.uniforms.sunColorF = { value: SUN_COLOR }
    shader.uniforms.sunDirF = { value: SUN_DIR }
    shader.uniforms.hazeColorF = {
      value: new THREE.Vector3(...CFG.SKY.hazeColor),
    }
    shader.uniforms.hazePowF = { value: CFG.SKY.hazePow }
    shader.uniforms.glowPowF = { value: CFG.SKY.glowPow }
    shader.uniforms.glowAmtF = { value: CFG.SKY.glowAmt }
    shader.uniforms.corePowF = { value: CFG.SKY.corePow }
    shader.uniforms.coreAmtF = { value: CFG.SKY.coreAmt }

    // --- Elliptical fog — делим ОДНИ И ТЕ ЖЕ uniform-объекты
    //     между всеми материалами, чтобы не дублировать состояние.
    shader.uniforms.fogCenter = fogU.center
    shader.uniforms.fogDirU = fogU.dir
    shader.uniforms.fogShapeSide = fogU.shapeSide
    shader.uniforms.fogShapeBack = fogU.shapeBack

    // --- Вершинный: пробрасываем мировую позицию ---
    shader.vertexShader = shader.vertexShader.replace(
      '#include <fog_pars_vertex>',
      `#include <fog_pars_vertex>
       varying vec3 vSkyWorldPos;`
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <fog_vertex>',
      `#include <fog_vertex>
   vec4 _skyWp = vec4(transformed, 1.0);
   #ifdef USE_INSTANCING
     _skyWp = instanceMatrix * _skyWp;
   #endif
   _skyWp = modelMatrix * _skyWp;
   vSkyWorldPos = _skyWp.xyz;`
    )

    // --- Фрагментный: объявляем функцию цвета неба + новые uniform-ы ---
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_pars_fragment>',
      `#include <fog_pars_fragment>
       uniform vec3  skyTop;
       uniform vec3  skyBottom;
       uniform float skyExponent;
       uniform vec3  sunColorF;
       uniform vec3  sunDirF;
       uniform vec3  hazeColorF;
       uniform float hazePowF;
       uniform float glowPowF;
       uniform float glowAmtF;
       uniform float corePowF;
       uniform float coreAmtF;

       // --- эллиптический туман ---
       uniform vec2  fogCenter;
       uniform vec2  fogDirU;
       uniform float fogShapeSide;
       uniform float fogShapeBack;

       varying vec3  vSkyWorldPos;

       vec3 skyColorAtDir(vec3 dir) {
         float h = max(dir.y, 0.0);
         float t = pow(h, skyExponent);
         vec3 col = mix(skyBottom, skyTop, t);
         float haze = exp(-h * hazePowF);
         col = mix(col, col + hazeColorF, haze);
         float d    = max(dot(dir, normalize(sunDirF)), 0.0);
         float glow = pow(d, glowPowF) * glowAmtF;
         float core = pow(d, corePowF) * coreAmtF;
         col += sunColorF * (glow + core);
         return col;
       }`
    )

    // --- Фрагментный: заменяем расчёт тумана на эллиптический ---
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
         // Вектор от центра эллипса (позиция ракеты) до пикселя в XZ.
         vec2  toFrag = vSkyWorldPos.xz - fogCenter;

         // Проекция на ось полёта (вперёд/назад) и на перпендикуляр (в стороны).
         float along  = dot(toFrag, fogDirU);
         float across = abs(dot(toFrag, vec2(-fogDirU.y, fogDirU.x)));

         // Вперёд — без сжатия (rAlong = 1), назад — сжимаем на shapeBack.
         float rAlong = along >= 0.0 ? 1.0 : fogShapeBack;
         vec2  p      = vec2(along / rAlong, across / fogShapeSide);
         float eDist  = length(p);   // в «метрах вперёд»

         // Цвет тумана = цвет неба в направлении луча взгляда.
         vec3  skyLook = normalize(vSkyWorldPos - cameraPosition);
         vec3  fogCol  = skyColorAtDir(skyLook);

         float fogFactor = smoothstep(fogNear, fogFar, eDist);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fogFactor);
       #endif`
    )
  }
  mat.needsUpdate = true
}

/* ================================================================
   2. LIGHTS
================================================================ */
scene.add(
  new THREE.HemisphereLight(CFG.LIGHTS.hemiSky, CFG.LIGHTS.hemiGround, CFG.LIGHTS.hemiIntensity)
)

const sun = new THREE.DirectionalLight(CFG.LIGHTS.sunColor, CFG.LIGHTS.sunIntensity)
sun.position.set(...CFG.LIGHTS.sunOffset)
sun.castShadow = CFG.LIGHTS.shadow.enabled
sun.shadow.mapSize.set(CFG.LIGHTS.shadow.mapSize, CFG.LIGHTS.shadow.mapSize)
const sc = sun.shadow.camera
sc.left = -CFG.LIGHTS.shadow.cameraSize
sc.right = CFG.LIGHTS.shadow.cameraSize
sc.top = CFG.LIGHTS.shadow.cameraSize
sc.bottom = -CFG.LIGHTS.shadow.cameraSize
sc.near = CFG.LIGHTS.shadow.near
sc.far = CFG.LIGHTS.shadow.far
sun.shadow.bias = CFG.LIGHTS.shadow.bias
scene.add(sun)
scene.add(sun.target)

/* ================================================================
   3. Текстура земли + материал
================================================================ */
const TILE = GROUND_TILE
const groundTex = makeGroundTexture(renderer.capabilities.getMaxAnisotropy())
const groundMat = new THREE.MeshStandardMaterial({
  map: groundTex,
  vertexColors: true,
  roughness: 1,
  metalness: 0,
})

/* ================================================================
   3b. CHUNK SYSTEM — 3D мир
================================================================ */
const CHUNK_SIZE = CFG.CHUNKS.size
const CHUNK_SEG = CFG.CHUNKS.segments
const LOAD_FWD_CHUNKS = CFG.CHUNKS.loadForward
const LOAD_BACK_CHUNKS = CFG.CHUNKS.loadBack
const LOAD_SIDE_CHUNKS = CFG.CHUNKS.loadSide
const UNLOAD_MARGIN = CFG.CHUNKS.unloadMargin
const COUNT = CFG.PROPS.density

const chunks = new Map()
// Persistent-чанки: ключи, которые unloadChunk не трогает.
const PERSISTENT_CHUNKS = new Set()
{
  const P = CFG.CHUNKS.persistentStart
  for (let cx = P.xMin; cx <= P.xMax; cx++) {
    for (let cz = P.zMin; cz <= P.zMax; cz++) {
      PERSISTENT_CHUNKS.add(cx + ',' + cz)
    }
  }
}
let showing3D = true

/* Кэш props на чанк. Нужен, потому что props одного и того же чанка
   запрашиваются и для его собственной отрисовки, и как halo-тени
   соседей. Без кэша computeChunkProps вызовется 4× лишний раз. */
const propsCache = new Map() // key -> items[]

function getProps(cx, cz) {
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
 *
 * Свет приходит с +X/+Z (SUN_DIR = 28,32,22). Тень уходит в −X/−Z.
 * Значит деревья из чанков (cx+1, cz), (cx, cz+1) и (cx+1, cz+1)
 * могут отбросить тень в наш чанк (cx, cz).
 *
 * Max смещение ~11 м ≪ 200 м ⇒ одного ряда гало достаточно.
 */
function collectShadowItems(cx, cz) {
  return [
    ...getProps(cx, cz),
    ...getProps(cx + 1, cz),
    ...getProps(cx, cz + 1),
    ...getProps(cx + 1, cz + 1),
  ]
}

function makeChunkMesh(cx, cz, items) {
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG)
  geo.rotateX(-Math.PI / 2)

  const cxw = cx * CHUNK_SIZE + CHUNK_SIZE / 2
  const czw = cz * CHUNK_SIZE + CHUNK_SIZE / 2
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nrm = geo.attributes.normal // уже есть, (0,1,0)

  const colArr = new Float32Array(pos.count * 3)
  const col = new THREE.Color()

  // Отдельный буфер яркости теней, чтобы применять их ПОСЛЕ
  // всех базовых цветов, и брать минимум (самую тёмную тень).
  const shadowB = new Float32Array(pos.count).fill(1)

  const step = CHUNK_SIZE / CHUNK_SEG
  const VPR = CHUNK_SEG + 1

  // Плоская карта высот в «сеточном» порядке [iz * VPR + ix].
  // Заполняется в первом проходе, читается sampleH ниже.
  const heightGrid = new Float32Array(VPR * VPR)

  // ---------- Первый проход: высоты, UV, цвета, аналитические нормали ----------
  for (let i = 0; i < pos.count; i++) {
    const wx = cxw + pos.getX(i)
    const wz = czw + pos.getZ(i)

    const h = terrainHeight(wx, wz)
    const hx = terrainHeight(wx + step, wz)
    const hz = terrainHeight(wx, wz + step)

    pos.setY(i, h)

    // Складываем в heightGrid по индексам (ix, iz).
    // Плоскость после rotateX(-π/2): локальный X → индекс по X,
    // локальный Z → индекс по Z; обе — в [0, CHUNK_SIZE].
    const gix = Math.round((pos.getX(i) + CHUNK_SIZE / 2) / step)
    const giz = Math.round((pos.getZ(i) + CHUNK_SIZE / 2) / step)
    heightGrid[giz * VPR + gix] = h

    uv.setXY(i, wx / TILE, wz / TILE)

    // Аналитическая нормаль — та же, что и в far-tiles.
    // Совпадает на границах соседних чанков → нет швов.
    const nx = -(hx - h) / step
    const nz = -(hz - h) / step
    const len = Math.hypot(nx, 1, nz)
    nrm.setXYZ(i, nx / len, 1 / len, nz / len)

    heightToTerrainColor(h, col)
    const b = terrainBrightnessNoise(wx, wz)
    colArr[i * 3] = col.r * b
    colArr[i * 3 + 1] = col.g * b
    colArr[i * 3 + 2] = col.b * b
  }

  // ---------- Второй проход: запекание теней от деревьев ----------
  // Смещение тени — ФИКСИРОВАННОЕ расстояние по направлению
  // от солнца (в XZ). Никакой зависимости от высоты дерева
  // или угла солнца — по просьбе: тени не «улетают».
  const shLenXZ = Math.hypot(SUN_DIR.x, SUN_DIR.z) || 1
  const shDirX = -SUN_DIR.x / shLenXZ // единичный вектор в XZ
  const shDirZ = -SUN_DIR.z / shLenXZ

  const shStrength = CFG.PROPS.shadow.strength
  const shScale = CFG.PROPS.shadow.scale
  const shSoft = CFG.PROPS.shadow.softness

  const shDist = CFG.PROPS.shadow.offset

  // Радиус кроны — по типу. Камни тень не отбрасывают.
  const treeRadius = (kind) => {
    if (kind === 'pine') return 1.6
    if (kind === 'oak') return 1.8
    if (kind === 'bush') return 0.8
    return 0
  }

  for (let k = 0; k < items.length; k++) {
    const it = items[k]
    const baseR = treeRadius(it.kind)
    if (baseR <= 0) continue

    const R = baseR * it.scale * shScale
    if (R <= 0) continue

    // Центр тени — фиксированно смещённый от основания дерева.
    const tOffset = shDist * (0.6 + 0.4 * it.scale) // 0.6..1.4 от базы
    const tx = it.x + shDirX * tOffset
    const tz = it.z + shDirZ * tOffset

    // Локальные координаты тени от левого края чанка (0..CHUNK_SIZE).
    const lx = tx - baseX
    const lz = tz - baseZ

    // Диапазон индексов вершин, попадающих в квадрат [lx±R, lz±R].
    const ix0 = Math.max(0, Math.floor((lx - R) / step))
    const ix1 = Math.min(CHUNK_SEG, Math.ceil((lx + R) / step))
    const iz0 = Math.max(0, Math.floor((lz - R) / step))
    const iz1 = Math.min(CHUNK_SEG, Math.ceil((lz + R) / step))

    const R2 = R * R

    for (let iz = iz0; iz <= iz1; iz++) {
      const vz = iz * step
      const dz = vz - lz
      const dz2 = dz * dz
      const rowBase = iz * VPR

      for (let ix = ix0; ix <= ix1; ix++) {
        const vx = ix * step
        const dx = vx - lx
        const d2 = dx * dx + dz2
        if (d2 > R2) continue

        const t = Math.sqrt(d2) / R
        const w = 1 - Math.pow(t, shSoft)
        const shade = 1 - w * shStrength

        const idx = rowBase + ix
        if (shade < shadowB[idx]) shadowB[idx] = shade
      }
    }
  }

  // Применяем тени к базовым цветам.
  for (let i = 0; i < pos.count; i++) {
    const s = shadowB[i]
    if (s < 1) {
      colArr[i * 3] *= s
      colArr[i * 3 + 1] *= s
      colArr[i * 3 + 2] *= s
    }
  }

  pos.needsUpdate = true
  uv.needsUpdate = true
  nrm.needsUpdate = true
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))
  // computeVertexNormals() УДАЛЯЕМ — используем аналитические.

  const mesh = new THREE.Mesh(geo, groundMat)
  mesh.position.set(cxw, 0, czw)
  mesh.receiveShadow = false

  // Билинейный сэмплер высоты по heightGrid.
  // Точки вне [baseX, baseX + CHUNK_SIZE] × [baseZ, baseZ + CHUNK_SIZE]
  // зажимаются к границе (для item'ов из своего чанка это не должно
  // случиться, но на всякий случай).
  const stepRecip = 1 / step
  mesh.userData.terrainSampler = (x, z) => {
    const gx = (x - baseX) * stepRecip
    const gz = (z - baseZ) * stepRecip

    let ix = Math.floor(gx)
    let iz = Math.floor(gz)
    let fx = gx - ix
    let fz = gz - iz

    if (ix < 0) {
      ix = 0
      fx = 0
    } else if (ix > VPR - 2) {
      ix = VPR - 2
      fx = 1
    }
    if (iz < 0) {
      iz = 0
      fz = 0
    } else if (iz > VPR - 2) {
      iz = VPR - 2
      fz = 1
    }

    const i00 = iz * VPR + ix
    const i10 = i00 + 1
    const i01 = i00 + VPR
    const i11 = i01 + 1

    return (
      heightGrid[i00] * (1 - fx) * (1 - fz) +
      heightGrid[i10] * fx * (1 - fz) +
      heightGrid[i01] * (1 - fx) * fz +
      heightGrid[i11] * fx * fz
    )
  }

  return mesh
}

const _dummyObj = new THREE.Object3D()

// Ссылки на prop-материал/тень — задаются ниже в секции PROPS
let propMatRef = null

/* ================================================================
   computeChunkProps — детерминированный список «что где растёт»
   на чанке (cx, cz).

   Правила размещения:
     1. Круг safeRadius вокруг босса — ничего не растёт.
     2. Деревья (pine/oak): не растут внутри эллипса safeRadiusTrees
        — «стартовая прогалина», чтобы ракета не врезалась сразу
        после запуска. Кусты и камни в этой зоне появляются.
     3. Ниже vegMaxHeight — все типы. Выше — только камни.
     4. Деревья/кусты — только внутри лесных пятен (см. world.js).
================================================================ */
function computeChunkProps(cx, cz) {
  const seed = hash2i(cx + 0x9e37, cz + 0x79b9) ^ WORLD_SEED
  const rng = mulberry32(seed)

  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const items = []
  const TH = CFG.PROPS.thresholds
  const SC = CFG.PROPS.scales
  const VEG_MAX_H = CFG.PROPS.vegMaxHeight

  // Круг вокруг босса (ничего не растёт).
  const SAFE_R = CFG.PROPS.safeRadius
  const SAFE_R2 = SAFE_R * SAFE_R

  // Эллипс «без деревьев» — вперёд на safeRadiusTrees,
  // в стороны и назад — на safeRadius.
  const SAFE_TREES_FWD = CFG.PROPS.safeRadiusTrees
  const SAFE_TREES_BACK = SAFE_R
  const SAFE_TREES_SIDE = SAFE_R

  // Один раз на чанк — список лесных пятен, дотягивающихся сюда.
  const spheres = collectForestSpheres(cx, cz)

  for (let i = 0; i < COUNT; i++) {
    const wx = baseX + rng() * CHUNK_SIZE
    const wz = baseZ + rng() * CHUNK_SIZE

    // Смещение относительно босса (-2.6, 0).
    const relX = wx + 2.6
    const relZ = wz

    // ─── 1. Круг вокруг босса: никаких пропсов вообще ───
    if (relX * relX + relZ * relZ < SAFE_R2) continue

    // ─── 2. Тип пропса ───
    const r = rng()
    let kind
    if (r < TH.pine) kind = 'pine'
    else if (r < TH.oak) kind = 'oak'
    else if (r < TH.bush) kind = 'bush'
    else kind = 'rock'

    // ─── 3. Для деревьев — эллипс «без деревьев» ───
    if (kind === 'pine' || kind === 'oak' || kind === 'bush') {
      const aX = relX >= 0 ? SAFE_TREES_FWD : SAFE_TREES_BACK
      const ex = relX / aX
      const ez = relZ / SAFE_TREES_SIDE
      if (ex * ex + ez * ez < 1) continue
    }

    // ─── 4. Маска леса и высота ───
    if (kind !== 'rock') {
      // Сначала — дешёвая маска леса. Отсеивает большинство.
      const density = forestDensityFromSpheres(wx, wz, spheres)
      if (density <= 0) continue
      if (rng() > density) continue

      // Только теперь — дорогой terrainHeight, и только
      // для тех деревьев, что выжили по маске.
      if (terrainHeight(wx, wz) > VEG_MAX_H) continue
    } else {
      // ─── камни ───
      // В низинах — пониженная частота, выше линии леса —
      // обычная. То есть получаем «каменистые склоны, чистые луга».
      const h = terrainHeight(wx, wz)
      if (h <= VEG_MAX_H && rng() > CFG.PROPS.rockLowlandFrequency) continue
    }

    const scale =
      kind === 'rock'
        ? SC.rock[0] + (SC.rock[1] - SC.rock[0]) * Math.pow(rng(), CFG.PROPS.rockScaleBias)
        : SC.tree[0] + rng() * (SC.tree[1] - SC.tree[0])
    const rotY = rng() * 6.28

    items.push({ x: wx, z: wz, kind, scale, rotY })
  }
  return items
}

/* ================================================================
   spawnChunkProps — строит InstancedMesh-ы и тени для чанка.
   Использует computeChunkProps, поэтому позиции гарантированно
   совпадают с overlay-точками.
================================================================ */
function spawnChunkProps(cx, cz, items, sampleH) {
  // items приходят извне — computeChunkProps уже вызван в loadChunk.

  const groups = { pine: [], oak: [], bush: [], rock: [] }
  for (const it of items) {
    groups[it.kind].push({
      x: it.x,
      y: sampleH(it.x, it.z),
      z: it.z,
      scale: it.scale,
      rotY: it.rotY,
    })
  }

  const meshes = []

  for (const kind of ['pine', 'oak', 'bush', 'rock']) {
    const list = groups[kind]
    if (list.length === 0) continue

    const inst = new THREE.InstancedMesh(TEMPLATES[kind], propMatRef, list.length)
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    inst.castShadow = false
    inst.receiveShadow = false
    inst.frustumCulled = true

    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      _dummyObj.position.set(it.x, it.y, it.z)
      _dummyObj.rotation.set(0, it.rotY, 0)
      _dummyObj.scale.setScalar(it.scale)
      _dummyObj.updateMatrix()
      inst.setMatrixAt(i, _dummyObj.matrix)
    }
    inst.instanceMatrix.needsUpdate = true
    scene.add(inst)
    meshes.push(inst)
  }

  return meshes
}

function loadChunk(cx, cz) {
  const key = cx + ',' + cz
  if (chunks.has(key)) return

  const items = getProps(cx, cz) // для отрисовки пропсов
  const shadowItems = collectShadowItems(cx, cz) // для запекания теней
  const mesh = makeChunkMesh(cx, cz, shadowItems)
  const props = spawnChunkProps(cx, cz, items, mesh.userData.terrainSampler)

  scene.add(mesh)
  for (const p of props) p.visible = showing3D
  chunks.set(key, { mesh, props })
}

function unloadChunk(key) {
  if (PERSISTENT_CHUNKS.has(key)) return // ← постоянные не выгружаем
  const c = chunks.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.mesh.geometry.dispose()
  for (const p of c.props) scene.remove(p)
  chunks.delete(key)
  propsCache.delete(key)
}

/* ================================================================
   ЧАНКИ: план (refill) / исполнение (process).

   refillChunkQueue  — решает, что выгрузить, прунит кэш, собирает
                        список toLoad в плоскую очередь. Дёргается
                        РЕДКО: только на смене ячейки камеры.
   processChunkQueue — берёт из очереди и грузит, пока не выйдет
                        бюджет 4 мс. Дёргается КАЖДЫЙ кадр.
================================================================ */
const chunkLoadQueue = []
let chunkQueueIdx = 0

function refillChunkQueue(camX, camZ) {
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  // --- Выгрузка ---
  const toUnload = []
  for (const key of chunks.keys()) {
    const [cs, czs] = key.split(',')
    const dx = +cs - cxi,
      dz = +czs - czi
    if (
      dx < -(LOAD_BACK_CHUNKS + UNLOAD_MARGIN) ||
      dx > LOAD_FWD_CHUNKS + UNLOAD_MARGIN ||
      Math.abs(dz) > LOAD_SIDE_CHUNKS + UNLOAD_MARGIN
    )
      toUnload.push(key)
  }
  for (const k of toUnload) unloadChunk(k)

  // --- Прун кэша ---
  const padXf = LOAD_FWD_CHUNKS + 1
  const padXb = LOAD_BACK_CHUNKS + 1
  const padZ = LOAD_SIDE_CHUNKS + 1
  for (const key of propsCache.keys()) {
    if (PERSISTENT_CHUNKS.has(key)) continue
    const [cs, czs] = key.split(',')
    const dx = +cs - cxi
    const dz = +czs - czi
    if (dx < -padXb || dx > padXf || Math.abs(dz) > padZ) {
      propsCache.delete(key)
    }
  }

  // --- Пересобираем очередь загрузки ---
  chunkLoadQueue.length = 0
  chunkQueueIdx = 0
  for (let dx = -LOAD_BACK_CHUNKS; dx <= LOAD_FWD_CHUNKS; dx++) {
    for (let dz = -LOAD_SIDE_CHUNKS; dz <= LOAD_SIDE_CHUNKS; dz++) {
      const cx = cxi + dx,
        cz = czi + dz
      if (!chunks.has(cx + ',' + cz)) chunkLoadQueue.push([cx, cz])
    }
  }
}

function processChunkQueue() {
  // В 2D-режиме 3D-чанки не нужны — земля всё равно не видна.
  if (lodFade > 0.5) return
  if (chunkQueueIdx >= chunkLoadQueue.length) return

  const BUDGET_MS = 4
  const t0 = performance.now()
  while (chunkQueueIdx < chunkLoadQueue.length && performance.now() - t0 < BUDGET_MS) {
    const [cx, cz] = chunkLoadQueue[chunkQueueIdx++]
    // Перепроверка: за время в очереди чанк мог загрузиться
    // как halo-сосед (collectShadowItems трогает getProps → loadChunk).
    if (!chunks.has(cx + ',' + cz)) loadChunk(cx, cz)
  }

  if (chunkQueueIdx >= chunkLoadQueue.length) {
    chunkLoadQueue.length = 0
    chunkQueueIdx = 0
  }
}

// Оставляем как обёртку для совместимости с initialLoad и другими местами.
function updateChunks(camX, camZ, initial = false) {
  refillChunkQueue(camX, camZ)
  if (initial) {
    // Синхронная первичная загрузка — как было.
    while (chunkQueueIdx < chunkLoadQueue.length) {
      const [cx, cz] = chunkLoadQueue[chunkQueueIdx++]
      if (!chunks.has(cx + ',' + cz)) loadChunk(cx, cz)
    }
    chunkLoadQueue.length = 0
    chunkQueueIdx = 0
  }
}

/* ================================================================
   3c. FAR GROUND TILES
================================================================ */
const FAR_TILE_SIZE = CFG.FAR_TILES.size
const FAR_TILE_SEG = CFG.FAR_TILES.segments
const FAR_LOAD_R = CFG.FAR_TILES.loadRadius
const FAR_UNLOAD_R = CFG.FAR_TILES.unloadRadius

const farGroundMat = new THREE.MeshStandardMaterial({
  map: groundTex,
  vertexColors: true,
  roughness: 1,
  metalness: 0,
  transparent: true,
  opacity: 0,
})

const farTiles = new Map()

/* ================================================================
   Инкрементальный билдер дальнего тайла.
   step(budgetMs) — обрабатывает столько строк сетки, сколько
   успеет за budgetMs миллисекунд. Возвращает true, когда готов.
================================================================ */
function createFarTileBuilder(fx, fz) {
  const geo = new THREE.PlaneGeometry(FAR_TILE_SIZE, FAR_TILE_SIZE, FAR_TILE_SEG, FAR_TILE_SEG)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.attributes.position
  const uv = geo.attributes.uv
  const nrm = geo.attributes.normal // существует у PlaneGeometry, изначально (0,1,0)
  const colArr = new Float32Array(pos.count * 3)
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))

  const cxw = fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const czw = fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  const col = new THREE.Color()

  // Шаг конечных разниц. Берём размер квадрата сетки —
  // тогда нормаль сглажена в масштабе видимой тесселяции.
  const eps = FAR_TILE_SIZE / FAR_TILE_SEG // ≈13.3 м

  const vertsPerRow = FAR_TILE_SEG + 1
  const totalRows = FAR_TILE_SEG + 1
  let row = 0

  return {
    geo,
    step(budgetMs) {
      const t0 = performance.now()
      while (row < totalRows && performance.now() - t0 < budgetMs) {
        const start = row * vertsPerRow
        const end = start + vertsPerRow
        for (let i = start; i < end; i++) {
          const wx = cxw + pos.getX(i)
          const wz = czw + pos.getZ(i)

          const h = terrainHeight(wx, wz)
          const hx = terrainHeight(wx + eps, wz)
          const hz = terrainHeight(wx, wz + eps)

          pos.setY(i, h)
          uv.setXY(i, wx / TILE, wz / TILE)

          // Аналитическая нормаль поверхности.
          // Одинакова для любой плитки в этой мировой точке → нет шва.
          const nx = -(hx - h) / eps
          const nz = -(hz - h) / eps
          const len = Math.hypot(nx, 1, nz)
          nrm.setXYZ(i, nx / len, 1 / len, nz / len)

          heightToTerrainColor(h, col)
          colArr[i * 3] = col.r
          colArr[i * 3 + 1] = col.g
          colArr[i * 3 + 2] = col.b
        }
        row++
      }
      if (row >= totalRows) {
        pos.needsUpdate = true
        uv.needsUpdate = true
        nrm.needsUpdate = true
        geo.attributes.color.needsUpdate = true
        // computeVertexNormals() БОЛЬШЕ НЕ НУЖЕН.
        return true
      }
      return false
    },
  }
}
function loadFarTile(fx, fz) {
  const key = fx + ',' + fz
  if (farTiles.has(key)) return
  const geo = makeFarTileGeometry(fx, fz)
  const mesh = new THREE.Mesh(geo, farGroundMat)
  mesh.position.set(
    fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2,
    0,
    fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  )
  mesh.receiveShadow = false
  mesh.visible = false
  scene.add(mesh)
  farTiles.set(key, { mesh, geo })
}

function unloadFarTile(key) {
  const c = farTiles.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  farTiles.delete(key)
}

const pendingFarTiles = new Map() // key -> { fx, fz, builder }

function finalizeFarTile(key, fx, fz, geo) {
  const mesh = new THREE.Mesh(geo, farGroundMat)
  mesh.position.set(
    fx * FAR_TILE_SIZE + FAR_TILE_SIZE / 2,
    0,
    fz * FAR_TILE_SIZE + FAR_TILE_SIZE / 2
  )
  mesh.receiveShadow = false
  mesh.visible = lodFade > 0.005
  scene.add(mesh)
  farTiles.set(key, { mesh, geo })
}

/* ================================================================
   FAR TILES: refill / process.
================================================================ */
function refillFarTiles(camX, camZ) {
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)

  // Пополняем очередь (без генерации).
  for (let dx = -FAR_LOAD_R; dx <= FAR_LOAD_R; dx++) {
    for (let dz = -FAR_LOAD_R; dz <= FAR_LOAD_R; dz++) {
      const fx = fxi + dx,
        fz = fzi + dz
      const key = fx + ',' + fz
      if (farTiles.has(key) || pendingFarTiles.has(key)) continue
      pendingFarTiles.set(key, { fx, fz, builder: createFarTileBuilder(fx, fz) })
    }
  }

  // Отменяем «уехавшие» pending-тайлы.
  for (const [key, p] of pendingFarTiles) {
    if (Math.abs(p.fx - fxi) > FAR_UNLOAD_R || Math.abs(p.fz - fzi) > FAR_UNLOAD_R) {
      p.builder.geo.dispose()
      pendingFarTiles.delete(key)
    }
  }

  // Выгрузка.
  const toUnload = []
  for (const key of farTiles.keys()) {
    const [fxs, fzs] = key.split(',')
    if (Math.abs(+fxs - fxi) > FAR_UNLOAD_R || Math.abs(+fzs - fzi) > FAR_UNLOAD_R) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadFarTile(k)
}

function processFarTiles() {
  if (pendingFarTiles.size === 0) return
  const BUDGET_MS = 3
  const t0 = performance.now()
  for (const [key, p] of pendingFarTiles) {
    const elapsed = performance.now() - t0
    if (elapsed >= BUDGET_MS) break
    if (p.builder.step(BUDGET_MS - elapsed)) {
      finalizeFarTile(key, p.fx, p.fz, p.builder.geo)
      pendingFarTiles.delete(key)
    }
  }
}

// Обёртка — оставляем для initialLoad.
function updateFarTiles(camX, camZ, initial = false) {
  refillFarTiles(camX, camZ)
  if (initial) {
    for (const [key, p] of pendingFarTiles) {
      while (!p.builder.step(Infinity)) {}
      finalizeFarTile(key, p.fx, p.fz, p.builder.geo)
    }
    pendingFarTiles.clear()
  }
}

/* ================================================================
   4. PROPS — материал и тень (шаблоны уже в props.js)
================================================================ */
const propMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: CFG.PROPS.material.roughness,
  metalness: CFG.PROPS.material.metalness,
  flatShading: false,
})
propMatRef = propMat

/* ================================================================
   5. BOSS
================================================================ */
const boss = new THREE.Group()
boss.position.set(...CFG.BOSS.position)

const skinMat = new THREE.MeshStandardMaterial({
  color: CFG.BOSS.colors.skin,
  roughness: 0.55,
})
const darkMat = new THREE.MeshStandardMaterial({
  color: CFG.BOSS.colors.dark,
  roughness: 0.8,
})
const accentMat = new THREE.MeshStandardMaterial({
  color: CFG.BOSS.colors.accent,
  roughness: 0.4,
  metalness: 0.3,
})

function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

const torso = box(2.0, 2.4, 1.4, skinMat)
torso.position.y = 3.8
boss.add(torso)

const chest = box(1.1, 0.9, 0.15, accentMat)
chest.position.set(0, 4.0, 0.75)
boss.add(chest)

const head = box(1.25, 1.2, 1.2, skinMat)
head.position.y = 5.7
boss.add(head)

for (const zz of [0.62, -0.62]) {
  const eye = box(0.3, 0.22, 0.1, darkMat)
  eye.position.set(0.3, 5.85, zz)
  eye.rotation.y = 0
  boss.add(eye)
}
const brow = box(0.36, 0.1, 0.12, darkMat)
brow.position.set(0.32, 6.05, 0.62)
brow.rotation.z = -0.35
boss.add(brow)
const brow2 = brow.clone()
brow2.position.z = -0.62
brow2.rotation.z = 0.35
boss.add(brow2)

const armL = box(0.55, 2.1, 0.55, skinMat)
armL.position.set(0, 3.6, 1.05)
armL.geometry.translate(0, -1.05, 0)
armL.position.y = 4.7
boss.add(armL)

const armR = box(0.55, 2.1, 0.55, skinMat)
armR.geometry.translate(0, -1.05, 0)
armR.position.set(0, 4.7, -1.05)
boss.add(armR)

function makeLeg() {
  const pivot = new THREE.Group()
  const upper = box(0.72, 1.4, 0.72, darkMat)
  upper.position.y = -0.7
  pivot.add(upper)
  const lower = box(0.62, 1.3, 0.62, darkMat)
  lower.position.y = -2.0
  pivot.add(lower)
  const foot = box(0.85, 0.4, 0.95, accentMat)
  foot.position.set(0.18, -2.75, 0)
  pivot.add(foot)
  return pivot
}

const legBack = makeLeg()
legBack.position.set(0, 2.6, -0.5)
boss.add(legBack)

const legKick = makeLeg()
legKick.position.set(0, 2.6, 0.5)
boss.add(legKick)

scene.add(boss)

/* ================================================================
   5b. VEG OVERLAY CHUNKS
================================================================ */
const OVERLAY_SIZE = CFG.OVERLAY.size
const OVERLAY_SEG = CFG.OVERLAY.segments
const OVERLAY_CANVAS = CFG.OVERLAY.canvasSize
const OVERLAY_LOAD_R = CFG.OVERLAY.loadRadius
const OVERLAY_UNLOAD_R = CFG.OVERLAY.unloadRadius

const overlayChunks = new Map()

/* ================================================================
   Инкрементальный билдер overlay-чанка:
   фаза 0 — привязка геометрии к рельефу (по строкам),
   фаза 1 — рисование точек-деревьев (по 3D-чанкам внутри overlay).
================================================================ */
/* ---------- Хелперы для рисования точек ---------- */

function hexToRgb(hex) {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]
}

/**
 * Предсчёт смещений пикселей внутри диска радиуса R.
 * Возвращает массив [dx, dy] — для каждой точки дерева
 * просто прогоняем этот маленький массив.
 */
function makeDiscOffsets(sizePx) {
  const R = (sizePx - 1) / 2
  const offsets = []
  const R2 = R * R + 0.25
  const Ri = Math.ceil(R)
  for (let dy = -Ri; dy <= Ri; dy++) {
    for (let dx = -Ri; dx <= Ri; dx++) {
      if (dx * dx + dy * dy <= R2) offsets.push([dx, dy])
    }
  }
  return offsets
}

/**
 * Записать точку диаметром offsets.length в ImageData.
 *
 * Режимы (см. CFG.OVERLAY.mergeAlpha):
 *   - source-over: точки накапливают alpha → плотный лес темнее.
 *   - max-alpha:   пиксель держит самый «плотный» из перекрытий,
 *                  без накопления → ровный ковёр.
 *
 * Формат — straight alpha (как в ImageData).
 */
function plotPoint(pix, W, H, cx, cy, offsets, r, g, b, a, merge) {
  const sa = a / 255
  if (sa <= 0) return

  for (let i = 0; i < offsets.length; i++) {
    const x = cx + offsets[i][0]
    const y = cy + offsets[i][1]
    if (x < 0 || x >= W || y < 0 || y >= H) continue

    const i4 = (y * W + x) * 4

    if (merge) {
      // ─── source-over ───
      const da = pix[i4 + 3] / 255
      const inv = 1 - sa
      const outA = sa + da * inv
      if (outA <= 0) continue
      const k = 1 / outA

      pix[i4] = (r * sa + pix[i4] * da * inv) * k
      pix[i4 + 1] = (g * sa + pix[i4 + 1] * da * inv) * k
      pix[i4 + 2] = (b * sa + pix[i4 + 2] * da * inv) * k
      pix[i4 + 3] = outA * 255
    } else {
      // ─── max-alpha: побеждает самая плотная точка ───
      const curA = pix[i4 + 3]
      if (a > curA) {
        pix[i4] = r
        pix[i4 + 1] = g
        pix[i4 + 2] = b
        pix[i4 + 3] = a
      }
    }
  }
}

function createOverlayBuilder(ox, oz) {
  // --- геометрия ---
  const geo = new THREE.PlaneGeometry(OVERLAY_SIZE, OVERLAY_SIZE, OVERLAY_SEG, OVERLAY_SEG)
  geo.rotateX(-Math.PI / 2)
  const pos = geo.attributes.position

  const cxw = ox * OVERLAY_SIZE + OVERLAY_SIZE / 2
  const czw = oz * OVERLAY_SIZE + OVERLAY_SIZE / 2
  const vertsPerRow = OVERLAY_SEG + 1
  const totalGeoRows = OVERLAY_SEG + 1

  // --- canvas ---
  const W = OVERLAY_CANVAS
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = W
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, W, W)

  const imgData = ctx.createImageData(W, W)
  const pix = imgData.data

  const pxPerM = W / OVERLAY_SIZE
  const chunksPerSide = Math.round(OVERLAY_SIZE / CHUNK_SIZE)
  const totalChunkCells = chunksPerSide * chunksPerSide

  const baseX = ox * OVERLAY_SIZE
  const baseZ = oz * OVERLAY_SIZE

  // --- цвета и параметры точек из конфига ---
  const O = CFG.OVERLAY
  const PINE_RGB = hexToRgb(O.colors.pine)
  const OAK_RGB = hexToRgb(O.colors.oak)
  const DISC = makeDiscOffsets(O.pointSize)
  const JIT = O.colorJitter
  const MERGE = O.mergeAlpha
  const BASE_ALPHA = O.pointAlpha * 255
  const ALPHA_JIT = O.alphaJitter

  // Верхняя граница «нулевого» уровня — используется при jitter,
  // чтобы точки не улетали в чёрный или белый.
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)

  let phase = 0 // 0 = рельеф, 1 = деревья
  let row = 0

  return {
    geo,
    canvas,
    step(budgetMs) {
      const t0 = performance.now()

      // ---------- Фаза 0: рельеф ----------
      if (phase === 0) {
        while (row < totalGeoRows && performance.now() - t0 < budgetMs) {
          const start = row * vertsPerRow
          const end = start + vertsPerRow
          for (let i = start; i < end; i++) {
            const wx = cxw + pos.getX(i)
            const wz = czw + pos.getZ(i)
            pos.setY(i, terrainHeight(wx, wz))
          }
          row++
        }
        if (row >= totalGeoRows) {
          pos.needsUpdate = true
          geo.computeVertexNormals()
          phase = 1
          row = 0
        }
      }

      // ---------- Фаза 1: деревья ----------
      if (phase === 1) {
        const c0x = Math.floor(baseX / CHUNK_SIZE)
        const c0z = Math.floor(baseZ / CHUNK_SIZE)

        while (row < totalChunkCells && performance.now() - t0 < budgetMs) {
          const cx = c0x + (row % chunksPerSide)
          const cz = c0z + Math.floor(row / chunksPerSide)
          const items = computeChunkProps(cx, cz)

          for (let k = 0; k < items.length; k++) {
            const it = items[k]
            // Кусты и камни — не рисуем.
            if (it.kind !== 'pine' && it.kind !== 'oak') continue

            const px = ((it.x - baseX) * pxPerM) | 0
            const py = ((it.z - baseZ) * pxPerM) | 0
            if (px < -3 || px >= W + 3 || py < -3 || py >= W + 3) continue

            // Цветовой jitter.
            const h = hash2i((it.x * 10) | 0, (it.z * 10) | 0)
            const rnd01 = (h & 1023) / 1023
            const factor = 1 + (rnd01 * 2 - 1) * JIT

            const base = it.kind === 'pine' ? PINE_RGB : OAK_RGB
            const cr = clamp255(base[0] * factor) | 0
            const cg = clamp255(base[1] * factor) | 0
            const cb = clamp255(base[2] * factor) | 0

            // ─── новое: alpha-jitter ───
            // Используем ДРУГИЕ биты того же хэша, чтобы alpha и цвет
            // не коррелировали (иначе «светлые = прозрачнее»).
            const rnd02 = ((h >>> 10) & 1023) / 1023
            const aFactor = 1 + (rnd02 * 2 - 1) * ALPHA_JIT
            const ca = clamp255(BASE_ALPHA * aFactor) | 0
            // ───────────────────────────

            plotPoint(pix, W, W, px, py, DISC, cr, cg, cb, ca, MERGE)
          }
          row++
        }

        if (row >= totalChunkCells) {
          ctx.putImageData(imgData, 0, 0)
          return true
        }
      }

      return false
    },
  }
}

const pendingOverlays = new Map()

function finalizeOverlayChunk(key, ox, oz, builder) {
  const tex = new THREE.CanvasTexture(builder.canvas)
  tex.colorSpace = THREE.SRGBColorSpace // ← фикс бага 2 (см. ниже)
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  tex.generateMipmaps = false
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy()

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    toneMapped: CFG.OVERLAY.toneMapped, // ← фикс бага 2
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  })

  // ← ФИКС БАГА 1: подключаем тот же эллиптический туман, что и у земли.
  applySkyFog(mat)

  const mesh = new THREE.Mesh(builder.geo, mat)
  mesh.position.set(ox * OVERLAY_SIZE + OVERLAY_SIZE / 2, 0, oz * OVERLAY_SIZE + OVERLAY_SIZE / 2)
  mesh.renderOrder = 2
  mesh.material.opacity = lodFade
  mesh.visible = lodFade > 0.005
  scene.add(mesh)

  overlayChunks.set(key, { mesh, mat, tex, geo: builder.geo })
}

function unloadOverlayChunk(key) {
  const c = overlayChunks.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.geo.dispose()
  c.tex.dispose()
  c.mat.dispose()
  overlayChunks.delete(key)
}

/* ================================================================
   OVERLAY: refill / process.
================================================================ */
function refillOverlayChunks(camX, camZ) {
  if (!CFG.OVERLAY.enabled) {
    // Чистим всё, что успело построиться.
    if (overlayChunks.size > 0) {
      for (const key of [...overlayChunks.keys()]) unloadOverlayChunk(key)
    }
    if (pendingOverlays.size > 0) {
      for (const [, p] of pendingOverlays) p.builder.geo.dispose()
      pendingOverlays.clear()
    }
    return
  }

  const oxi = Math.floor(camX / OVERLAY_SIZE)
  const ozi = Math.floor(camZ / OVERLAY_SIZE)

  // Пополняем очередь.
  for (let dx = -OVERLAY_LOAD_R; dx <= OVERLAY_LOAD_R; dx++) {
    for (let dz = -OVERLAY_LOAD_R; dz <= OVERLAY_LOAD_R; dz++) {
      const ox = oxi + dx,
        oz = ozi + dz
      const key = ox + ',' + oz
      if (overlayChunks.has(key) || pendingOverlays.has(key)) continue
      pendingOverlays.set(key, { ox, oz, builder: createOverlayBuilder(ox, oz) })
    }
  }

  // Отменяем «уехавшие» pending-чанки.
  for (const [key, p] of pendingOverlays) {
    if (Math.abs(p.ox - oxi) > OVERLAY_UNLOAD_R || Math.abs(p.oz - ozi) > OVERLAY_UNLOAD_R) {
      p.builder.geo.dispose()
      pendingOverlays.delete(key)
    }
  }

  // Выгрузка.
  const toUnload = []
  for (const key of overlayChunks.keys()) {
    const [oxs, ozs] = key.split(',')
    if (Math.abs(+oxs - oxi) > OVERLAY_UNLOAD_R || Math.abs(+ozs - ozi) > OVERLAY_UNLOAD_R)
      toUnload.push(key)
  }
  for (const k of toUnload) unloadOverlayChunk(k)
}

function processOverlayChunks() {
  if (pendingOverlays.size === 0) return
  const BUDGET_MS = 3
  const t0 = performance.now()
  for (const [key, p] of pendingOverlays) {
    const elapsed = performance.now() - t0
    if (elapsed >= BUDGET_MS) break
    if (p.builder.step(BUDGET_MS - elapsed)) {
      finalizeOverlayChunk(key, p.ox, p.oz, p.builder)
      pendingOverlays.delete(key)
    }
  }
}

// Обёртка — оставляем для initialLoad.
function updateOverlayChunks(camX, camZ, initial = false) {
  refillOverlayChunks(camX, camZ)
  if (initial) {
    for (const [key, p] of pendingOverlays) {
      while (!p.builder.step(Infinity)) {}
      finalizeOverlayChunk(key, p.ox, p.oz, p.builder)
    }
    pendingOverlays.clear()
  }
}

// Флаги LOD
let in2DMode = false
let lodFade = 0
let lodAltSmooth = 0 // ← сглаженная по времени высота над рельефом
let lodAltInit = false // ← первый кадр — инициализация

const FOG_3D_NEAR = CFG.FOG.near3D,
  FOG_3D_FAR = CFG.FOG.far3D
const FOG_2D_NEAR = CFG.FOG.near2D,
  FOG_2D_FAR = CFG.FOG.far2D

/* ================================================================
   5c. CHESTS — статичные сундуки с редкими карточками
================================================================ */
const chestGroup = new THREE.Group()
scene.add(chestGroup)

/** Известные сундуки: массив { x, z, y, mesh, beam, glow, opened } */
const chests = []

function buildChestMesh(x, z) {
  const g = new THREE.Group()

  // Тело сундука
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x6b3a14,
    roughness: 0.7,
    metalness: 0.1,
  })
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xffd75e,
    roughness: 0.35,
    metalness: 0.8,
    emissive: 0xffb300,
    emissiveIntensity: 0.6,
  })
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.6), bodyMat)
  body.position.y = 0.7
  body.castShadow = true
  g.add(body)

  // Обручи
  for (const dz of [-0.55, 0.55]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.12), trimMat)
    b.position.set(0, 0.7, dz)
    g.add(b)
  }

  // Крышка (наклонная коробка сверху)
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.5, 1.7), bodyMat)
  lid.position.set(0, 1.6, 0)
  lid.castShadow = true
  g.add(lid)

  // Замок
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.15), trimMat)
  lock.position.set(0, 0.85, 0.85)
  g.add(lock)

  // Световой столб — виден издалека, не тонет в тумане
  const beamMat = new THREE.MeshBasicMaterial({
    color: CFG.CHESTS.beamColor,
    transparent: true,
    opacity: CFG.CHESTS.beamOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
    side: THREE.DoubleSide,
  })
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(
      CFG.CHESTS.beamRadius,
      CFG.CHESTS.beamRadius * 1.8,
      CFG.CHESTS.beamHeight,
      12,
      1,
      true
    ),
    beamMat
  )
  beam.position.y = CFG.CHESTS.beamHeight / 2
  beam.renderOrder = 5
  beam.frustumCulled = false
  g.add(beam)

  // Ядро свечения у основания — «точка притяжения»
  const glowMat = new THREE.MeshBasicMaterial({
    color: CFG.CHESTS.glowColor,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  })
  const glow = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 10), glowMat)
  glow.position.y = 1.2
  glow.renderOrder = 4
  glow.frustumCulled = false
  g.add(glow)

  // Точечный свет — освещает землю вокруг
  const light = new THREE.PointLight(CFG.CHESTS.glowColor, CFG.CHESTS.glowIntensity, 40)
  light.position.y = 2.0
  g.add(light)

  g.position.set(x, terrainHeight(x, z), z)
  return { group: g, beam, glow, light }
}

/** Z-координата сундука на дистанции x — вдоль траектории полёта. */
function chestZ(x) {
  const yaw = CFG.GAME.flightYaw || 0
  return x * Math.tan(yaw) + Math.random() * 2.0 * CFG.CHESTS.zOffset - CFG.CHESTS.zOffset
}

function initChests() {
  for (const x of CFG.CHESTS.xPositions) {
    const z = chestZ(x)
    const opened = G.openedChests.has(x)
    const { group, beam, glow, light } = buildChestMesh(x, z)
    group.visible = !opened
    chestGroup.add(group)
    chests.push({ x, z, group, beam, glow, light, opened })
  }
}

/* ================================================================
   6. ROCKET
================================================================ */
const rocket = new THREE.Group()

const bodyMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.body,
  metalness: 0.55,
  roughness: 0.3,
})
const redMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.red,
  metalness: 0.3,
  roughness: 0.45,
})
const glassMat = new THREE.MeshStandardMaterial({
  color: CFG.ROCKET.colors.glass,
  metalness: 0.9,
  roughness: 0.15,
})

const rBody = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 2.2, 16), bodyMat)
rBody.rotation.z = Math.PI / 2
rBody.castShadow = true
rocket.add(rBody)

const rNose = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.0, 16), redMat)
rNose.rotation.z = -Math.PI / 2
rNose.position.x = 1.6
rNose.castShadow = true
rocket.add(rNose)

const port = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.06, 12), glassMat)
port.rotation.x = Math.PI / 2
port.position.set(0.5, 0.3, 0.33)
rocket.add(port)

const finShape = new THREE.Shape()
finShape.moveTo(0, 0)
finShape.lineTo(-1.0, 0)
finShape.lineTo(-1.0, 0.55)
finShape.closePath()
const finGeo = new THREE.ExtrudeGeometry(finShape, {
  depth: 0.07,
  bevelEnabled: false,
})
finGeo.translate(0, 0, -0.035)

for (const sgn of [1, -1]) {
  const fin = new THREE.Mesh(finGeo, redMat)
  fin.position.set(-0.35, 0.34 * sgn, 0)
  fin.scale.y = sgn
  fin.castShadow = true
  rocket.add(fin)
}

const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 0.5, 14), darkMat)
nozzle.rotation.z = Math.PI / 2
nozzle.position.x = -1.25
rocket.add(nozzle)

const flameMat = new THREE.MeshBasicMaterial({
  color: CFG.ROCKET.flame.outer,
  transparent: true,
  opacity: 0.95,
})
const flame = new THREE.Mesh(new THREE.ConeGeometry(0.36, 1.4, 12), flameMat)
flame.rotation.z = Math.PI / 2
flame.position.x = -2.1
rocket.add(flame)

const flameInner = new THREE.Mesh(
  new THREE.ConeGeometry(0.2, 0.9, 10),
  new THREE.MeshBasicMaterial({ color: CFG.ROCKET.flame.inner })
)
flameInner.rotation.z = Math.PI / 2
flameInner.position.x = -1.85
rocket.add(flameInner)

const exhaustLight = new THREE.PointLight(CFG.ROCKET.exhaustLight, 0, 14)
exhaustLight.position.set(-2.0, 0, 0)
rocket.add(exhaustLight)

scene.add(rocket)

/* ================================================================
   7. GAME STATE
================================================================ */
const GRAVITY = CFG.GAME.gravity
const REST_Y = CFG.GAME.restY
const LAUNCH_ANGLE = CFG.GAME.launchAngle

const ANG_ACC = CFG.GAME.angAcc
const ANG_DAMP = CFG.GAME.angDamp
const ANG_MAX = CFG.GAME.angMax

const G = {
  phase: 'ready',
  timer: 0,
  coins: CFG.GAME.initialCoins,
  best: CFG.GAME.initialBest,
  lastDist: 0,
  fuel: 0,
  upgrades: { ...CFG.GAME.initialUpgrades },
  // Карточки: { fuel2x: 0, thrust2x: 1, ... } — сколько раз получена.
  cards: {},
  // Открытые сундуки: Set<number> — X-координаты открытых.
  openedChests: new Set(),
}

const rocketState = {
  pos: new THREE.Vector3(0, REST_Y, 0),
  vel: new THREE.Vector3(),
  angVel: 0,
}

let boosting = false

const UPGRADES = CFG.UPGRADES
const costOf = (u) => CFG.RULES.upgradeCost(u, G.upgrades[u.key])
const launchSpeed = () => CFG.RULES.launchSpeed(G.upgrades) * cardMul('power2x')
const maxFuel = () => CFG.RULES.maxFuel(G.upgrades) * cardMul('fuel2x')
const thrustAcc = () => CFG.RULES.thrustAcc(G.upgrades) * cardMul('thrust2x')
const dragCoefAtAngle = (alpha) => CFG.RULES.dragCoefAtAngle(G.upgrades, alpha) * cardMul('aero2x')
const airDensity = (y) => CFG.RULES.airDensity(y)
// Гравитацию умножаем в updateRocket вручную — она не через функцию.
const gravityMul = () => cardMul('airtime')

/** Множитель к базовой величине от карточек. */
const cardMul = (key) => {
  const n = G.cards[key] || 0
  if (n === 0) return 1
  if (key === 'fuel2x') return Math.pow(CFG.CHESTS.buffChests[0], n)
  if (key === 'thrust2x') return Math.pow(CFG.CHESTS.buffChests[1], n)
  if (key === 'power2x') return Math.pow(CFG.CHESTS.buffChests[2], n)
  if (key === 'aero2x') return Math.pow(CFG.CHESTS.buffChests[3], n)
  if (key === 'airtime') return Math.pow(CFG.CHESTS.buffChests[4], n)
  return 1
}

/* ================================================================
   7b. SAVE / LOAD — сохранение прогресса в localStorage

   Формат:
     { v: 1, coins: number, best: number, upgrades: {power, aero, fuel, thrust} }
   Все поля валидируются на загрузке: если значение кривое — берём дефолт.
   localStorage может быть недоступен (iOS private mode, квота) —
   поэтому все операции обёрнуты в try/catch.
================================================================ */

function saveProgress() {
  if (!CFG.SAVE.autoSave) return
  try {
    const data = {
      v: CFG.SAVE.version,
      coins: G.coins,
      best: G.best,
      upgrades: { ...G.upgrades },
      cards: { ...G.cards },
      openedChests: [...G.openedChests],
    }
    localStorage.setItem(CFG.SAVE.key, JSON.stringify(data))
  } catch (e) {
    // Не падаем: игра работает без сохранения
    console.warn('saveProgress failed:', e)
  }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(CFG.SAVE.key)
    if (!raw) return

    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return

    // Монеты: неотрицательное число
    if (typeof data.coins === 'number' && isFinite(data.coins) && data.coins >= 0) {
      G.coins = Math.floor(data.coins)
    }

    // Рекорд: неотрицательное число (может быть float)
    if (typeof data.best === 'number' && isFinite(data.best) && data.best >= 0) {
      G.best = data.best
    }

    // Апгрейды: только известные ключи, только числа >= 1
    if (data.upgrades && typeof data.upgrades === 'object') {
      for (const key of Object.keys(CFG.GAME.initialUpgrades)) {
        const v = data.upgrades[key]
        if (typeof v === 'number' && isFinite(v) && v >= 1) {
          G.upgrades[key] = Math.floor(v)
        }
        // Иначе оставляем дефолт из CFG.GAME.initialUpgrades
      }
    }

    // Карточки: только известные ключи, целые >= 0
    if (data.cards && typeof data.cards === 'object') {
      for (const c of CFG.CARDS) {
        const v = data.cards[c.key]
        if (typeof v === 'number' && isFinite(v) && v >= 0) {
          G.cards[c.key] = Math.floor(v)
        }
      }
    }

    // Открытые сундуки
    if (Array.isArray(data.openedChests)) {
      for (const x of data.openedChests) {
        if (typeof x === 'number' && isFinite(x)) G.openedChests.add(x)
      }
    }
  } catch (e) {
    console.warn('loadProgress failed:', e)
  }
}

function resetProgress() {
  const ok = confirm('Сбросить весь прогресс? Монеты, рекорд и апгрейды будут потеряны.')
  if (!ok) return

  try {
    localStorage.removeItem(CFG.SAVE.key)
  } catch (e) {
    console.warn('resetProgress failed:', e)
  }

  G.coins = CFG.GAME.initialCoins
  G.best = CFG.GAME.initialBest
  G.upgrades = { ...CFG.GAME.initialUpgrades }
  G.cards = {}
  G.openedChests = new Set()

  updateHUD()
  renderShop()
  showToast('Прогресс сброшен 🗑️', '#ff7a7a')
}

/* ================================================================
   8. UI
================================================================ */
const $dist = document.getElementById('dist')
const $coins = document.getElementById('coins')
const $best = document.getElementById('best')
const $shop = document.getElementById('shop')
const $launch = document.getElementById('launch')
const $boostUI = document.getElementById('boostUI')
const $fuelFill = document.getElementById('fuelFill')
const $fuelText = document.getElementById('fuelText')

const $alignText = document.getElementById('alignText')
const $touchUI = document.getElementById('touchControls')
const $toast = document.getElementById('toast')

const $pushBtn = document.getElementById('pushBtn')
const $helpText = document.getElementById('helpText')

function updateHUD() {
  $dist.textContent = Math.max(0, Math.floor(rocketState.pos.x))
  $coins.textContent = G.coins
  $best.textContent = Math.floor(G.best)
}

function renderShop() {
  $shop.innerHTML = ''
  for (const u of UPGRADES) {
    const lvl = G.upgrades[u.key]
    const cost = costOf(u)
    const can = G.coins >= cost

    const btn = document.createElement('button')
    btn.className = 'upg' + (can ? '' : ' disabled')
    // Уровень — отдельный чип ПЕРЕД названием.
    // Так название не обрезается из-за хвоста «Lv.N».
    btn.innerHTML = `
      <div class="u-main">
        <div class="u-name">
          <span class="u-lvl">${lvl}</span>
          <span class="u-icon">${u.icon}</span>
          <span class="u-title">${u.name}</span>
        </div>
        <div class="u-desc">${u.desc}</div>
      </div>
      <div class="u-cost">${cost} 💲</div>`
    btn.addEventListener('click', () => buy(u))
    $shop.appendChild(btn)
  }
}

function buy(u) {
  const cost = costOf(u)
  if (G.coins < cost) return
  G.coins -= cost
  G.upgrades[u.key]++
  updateHUD()
  renderShop()
  showToast(`${u.icon} Lv.${G.upgrades[u.key]}`, CFG.UI.toastColors.upgrade)
  saveProgress()
}

let toastTimer
function showToast(text, color = CFG.UI.toastColors.default) {
  $toast.textContent = text
  $toast.style.color = color
  $toast.classList.add('on')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => $toast.classList.remove('on'), CFG.UI.toastDuration)
}

/* ================================================================
   9. INPUT
================================================================ */
const input = { boost: false }
const keys = { W: false, S: false }
const touchKeys = { W: false, S: false }

addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    input.boost = true
    if (G.phase === 'ready' || G.phase === 'landed') startKick()
  }
  if (e.code === 'KeyW') {
    keys.W = true
    e.preventDefault()
  }
  if (e.code === 'KeyS') {
    keys.S = true
    e.preventDefault()
  }
})
addEventListener('keyup', (e) => {
  if (e.code === 'Space') input.boost = false
  if (e.code === 'KeyW') keys.W = false
  if (e.code === 'KeyS') keys.S = false
})

const $rotUp = document.getElementById('rotUp')
const $rotDown = document.getElementById('rotDown')

function bindHold(el, setter) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    setter(true)
  })
  el.addEventListener('pointerup', () => setter(false))
  el.addEventListener('pointerleave', () => setter(false))
  el.addEventListener('pointercancel', () => setter(false))
}
bindHold($rotUp, (v) => (touchKeys.W = v))
bindHold($rotDown, (v) => (touchKeys.S = v))
bindHold($pushBtn, (v) => (input.boost = v))

renderer.domElement.addEventListener('pointerdown', (e) => {
  if (G.phase === 'ready' || G.phase === 'landed') {
    startKick()
    return
  }
  // На десктопе тап мышкой по канвасу тоже даёт тягу.
  // На тач — только кнопка PUSH, иначе один палец на кнопке поворота
  // «сбрасывает» boost через window.pointerup.
  if (G.phase === 'fly' && e.pointerType === 'mouse') {
    input.boost = true
  }
})
addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') input.boost = false
})
addEventListener('pointercancel', (e) => {
  if (e.pointerType === 'mouse') input.boost = false
})

$launch.addEventListener('click', (e) => {
  e.stopPropagation()
  if (G.phase === 'ready' || G.phase === 'landed') startKick()
})

document.getElementById('resetBtn').addEventListener('click', (e) => {
  e.stopPropagation()
  resetProgress()
})

/* ================================================================
   10. GAME LOGIC
================================================================ */
function startKick() {
  if (G.phase !== 'ready' && G.phase !== 'landed') return
  resetRocket()
  G.phase = 'prekick'
  G.timer = 0
  // Мгновенно сбрасываем camBlend — иначе камера будет «ползти»
  // к боковому виду через медленный blendOut (~3 с). А так целевая
  // точка сразу переключается, и позиция плавно едет через
  // обычное follow-сглаживание (быстрее).
  camBlend = 0
  $launch.classList.add('hidden')
  $shop.style.display = 'none'
}

function resetRocket() {
  const gY = terrainHeight(0, 0)
  rocketState.pos.set(0, gY + REST_Y, 0)
  rocketState.vel.set(0, 0, 0)
  rocket.rotation.z = 0
  rocket.rotation.y = 0
  rocketState.angVel = 0
  rocket.position.copy(rocketState.pos)
  G.fuel = maxFuel()
  input.boost = false
}

function launch() {
  const speed = launchSpeed()
  const yaw = CFG.GAME.flightYaw || 0
  // Горизонтальная составляющая скорости делится между X и Z
  // по углу flightYaw. yaw = 0 → чистый +X (как раньше).
  const horiz = Math.cos(LAUNCH_ANGLE) * speed
  rocketState.vel.set(Math.cos(yaw) * horiz, Math.sin(LAUNCH_ANGLE) * speed, Math.sin(yaw) * horiz)
  rocket.rotation.z = LAUNCH_ANGLE
  // Нос доворачиваем в сторону полёта (yaw вокруг Y).
  // Знак минус — из-за соглашения three.js: rotation.y вращает
  // +X-ось в сторону −Z, а нам нужно в +Z.
  rocket.rotation.y = -yaw
  rocketState.angVel = 0
  G.phase = 'fly'
  G.timer = 0
  boosting = false
  showToast('ПОЛЕТЕЛИ! 🚀', CFG.UI.toastColors.upgrade)
}

function land() {
  G.phase = 'landed'

  // Проверка: не попали ли в радиус сундука?
  const landedX = rocketState.pos.x
  const landedZ = rocketState.pos.z
  for (const c of chests) {
    if (c.opened) continue
    const dx = landedX - c.x
    const dz = landedZ - c.z
    if (dx * dx + dz * dz <= CFG.CHESTS.pickupRadius * CFG.CHESTS.pickupRadius) {
      openChest(c)
    }
  }

  G.timer = 0
  rocketState.angVel = 0
  const gY = terrainHeight(rocketState.pos.x, rocketState.pos.z)
  rocketState.pos.y = gY + REST_Y
  rocketState.vel.set(0, 0, 0)

  const dist = Math.max(0, rocketState.pos.x)
  const earned = Math.max(1, Math.floor(dist))
  G.lastDist = dist
  G.coins += earned
  if (dist > G.best) G.best = dist

  updateHUD()
  renderShop()
  saveProgress()

  $launch.classList.remove('hidden')
  $shop.style.display = ''
  $launch.textContent = 'Пнуть снова! 🦵'

  showToast(`${Math.floor(dist)} м  +${earned} 💥`, CFG.UI.toastColors.land)

  shake = CFG.CAMERA.shakeOnLand
}

function openChest(chest) {
  chest.opened = true
  G.openedChests.add(chest.x)

  // Убираем сундук из сцены (он «открыт»)
  chest.group.visible = false

  // Случайная карточка
  const card = CFG.CARDS[Math.floor(Math.random() * CFG.CARDS.length)]
  G.cards[card.key] = (G.cards[card.key] || 0) + 1

  showCardPopup(card)
  saveProgress()

  // Обновляем магазин — карточки влияют на формулы, но UI
  // показывает только уровни апгрейдов, так что перерисовка
  // не обязательна. Оставляем на всякий случай.
  // renderShop()
}

let cardCloseHandler = null
function showCardPopup(card) {
  const $popup = document.getElementById('cardPopup')
  document.getElementById('cardIcon').textContent = card.icon
  document.getElementById('cardName').textContent = card.name
  document.getElementById('cardDesc').textContent = card.desc
  $popup.classList.add('on')

  // Закрытие — тапом в любом месте
  if (cardCloseHandler) $popup.removeEventListener('click', cardCloseHandler)
  cardCloseHandler = () => $popup.classList.remove('on')
  $popup.addEventListener('click', cardCloseHandler)
}

let shake = 0

/* ================================================================
   11. UPDATE
================================================================ */
function update(dt) {
  updateChests(dt)
  updateBoss(dt)
  updateRocket(dt)
  updateCamera(dt)
  updateScenery()
  updateFogEllipse(dt)
  updateLOD(dt)
  updateSceneryCells()

  if (G.phase === 'fly') {
    $boostUI.classList.add('on')
    $helpText.classList.add('on')
    $touchUI.classList.remove('hidden')
    $fuelFill.style.width = (G.fuel / maxFuel()) * 100 + '%'
    $fuelText.textContent = G.fuel.toFixed(1)
  } else {
    $boostUI.classList.remove('on')
    $helpText.classList.remove('on')
    $touchUI.classList.add('hidden')
  }

  if (G.phase === 'fly') updateHUD()
}

function updateBoss(dt) {
  const idle = performance.now() * 0.0022

  if (G.phase === 'ready' || G.phase === 'landed') {
    legKick.rotation.z += (0 - legKick.rotation.z) * Math.min(1, dt * 12)
    boss.position.y = Math.sin(idle) * 0.08
    torso.rotation.z = Math.sin(idle * 0.7) * 0.03
    head.rotation.z = Math.sin(idle * 0.7) * 0.05
    legBack.rotation.z = Math.sin(idle) * 0.03
  } else if (G.phase === 'prekick') {
    // Пауза перед замахом. Босс стоит в idle-позе, камера тем
    // временем едет к стартовой точке.

    // Отсчёт prekickDelay начинаем только когда камера «доехала».
    const dist = camera.position.distanceTo(_camTarget)
    if (dist <= CFG.GAME.prekickCamTolerance) {
      G.timer += dt
      if (G.timer >= CFG.GAME.prekickDelay) {
        G.phase = 'windup'
        G.timer = 0
      }
    } else {
      // Камера ещё в пути — отсчёт сбрасываем, чтобы задержка
      // была именно ПОСЛЕ возврата.
      G.timer = 0
    }
  } else if (G.phase === 'windup') {
    G.timer += dt
    const t = Math.min(1, G.timer / 0.3)
    const e = 1 - Math.pow(1 - t, 3)
    legKick.rotation.z = -0.85 * e
    torso.rotation.z = 0.12 * e
    boss.position.y = -0.12 * e

    if (t >= 1) {
      G.phase = 'strike'
      G.timer = 0
    }
  } else if (G.phase === 'strike') {
    G.timer += dt
    const t = Math.min(1, G.timer / 0.11)
    const e = t * t * (3 - 2 * t)
    legKick.rotation.z = -0.85 + (2.05 + 0.85) * e
    torso.rotation.z = 0.12 - 0.28 * e
    boss.position.y = -0.12 + 0.2 * e

    if (t >= 1 && G.phase === 'strike') launch()
  } else if (G.phase === 'fly') {
    legKick.rotation.z += (0 - legKick.rotation.z) * Math.min(1, dt * 6)
    torso.rotation.z += (0 - torso.rotation.z) * Math.min(1, dt * 6)
    boss.position.y += (0 - boss.position.y) * Math.min(1, dt * 6)
  }
}

function updateRocket(dt) {
  const p = rocketState
  const restY = terrainHeight(p.pos.x, p.pos.z) + REST_Y

  if (G.phase === 'fly') {
    const ang = rocket.rotation.z
    const yaw = CFG.GAME.flightYaw || 0

    boosting = input.boost && G.fuel > 0
    if (boosting) {
      const ta = thrustAcc()
      const c = Math.cos(ang)
      p.vel.x += c * Math.cos(yaw) * ta * dt
      p.vel.y += Math.sin(ang) * ta * dt
      p.vel.z += c * Math.sin(yaw) * ta * dt
      G.fuel = Math.max(0, G.fuel - dt)
    }

    p.vel.y -= GRAVITY * gravityMul() * dt

    const speed = p.vel.length()
    if (speed > 0.01) {
      // Угол атаки: между носом ракеты и вектором скорости.
      // Нос в мире — тот же единичный вектор, что идёт в тягу.
      const noseX = Math.cos(ang) * Math.cos(yaw)
      const noseY = Math.sin(ang)
      const noseZ = Math.cos(ang) * Math.sin(yaw)
      const dot = (noseX * p.vel.x + noseY * p.vel.y + noseZ * p.vel.z) / speed
      // acos(±1) → защита от выхода за [-1, 1] из-за округления
      const alpha = Math.acos(Math.max(-1, Math.min(1, dot)))

      const k = dragCoefAtAngle(alpha) * airDensity(p.pos.y)
      const aDrag = k * speed
      p.vel.x -= p.vel.x * aDrag * dt
      p.vel.y -= p.vel.y * aDrag * dt
      p.vel.z -= p.vel.z * aDrag * dt
    }

    p.pos.addScaledVector(p.vel, dt)

    if (p.pos.y <= restY && p.vel.y < 0) {
      p.pos.y = restY
      land()
    }
  } else if (G.phase === 'landed') {
    p.pos.y += (restY - p.pos.y) * Math.min(1, dt * 8)
    rocket.rotation.z += (0 - rocket.rotation.z) * Math.min(1, dt * 6)
  }

  rocket.position.copy(p.pos)

  if (G.phase === 'fly') {
    const rotInput = (keys.W || touchKeys.W ? 1 : 0) - (keys.S || touchKeys.S ? 1 : 0)

    p.angVel += rotInput * ANG_ACC * dt
    p.angVel -= p.angVel * ANG_DAMP * dt
    p.angVel = Math.max(-ANG_MAX, Math.min(ANG_MAX, p.angVel))

    rocket.rotation.z += p.angVel * dt

    // ─── Аэродинамическая стабилизация ───
    // Доворачиваем нос к вектору скорости с ограниченной скоростью.
    // Работает ПОСЛЕ ручного управления: если игрок крутит W/S,
    // angVel >> aeroAlign, и стабилизация почти не мешает.
    // Когда игрок отпускает клавиши, angVel затухает — и ракета
    // плавно возвращается «в поток» сама.
    const ALIGN_RATE = CFG.GAME.aeroAlign
    const MIN_SPEED = CFG.GAME.aeroAlignMinSpeed
    const spd = p.vel.length()
    if (ALIGN_RATE > 0 && spd > MIN_SPEED) {
      // Угол тангажа вектора скорости. Берём hypot(x,z), а не x,
      // чтобы учесть yaw — иначе при большом yaw будет ошибка.
      const desired = Math.atan2(p.vel.y, Math.hypot(p.vel.x, p.vel.z))

      // Кратчайшая разница по кругу, в диапазоне (−π, π].
      let diff = desired - rocket.rotation.z
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2

      // Не поворачиваем больше, чем ALIGN_RATE * dt за кадр.
      // Если разница меньше — доходим точно до цели без «дрожания».
      const maxStep = ALIGN_RATE * dt
      const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep)
      rocket.rotation.z += step
    }
  }

  if (G.phase === 'fly') {
    let diff = rocket.rotation.z - Math.atan2(p.vel.y, p.vel.x)
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    const deg = (Math.abs(diff) * 180) / Math.PI

    if (deg < 8) {
      $alignText.textContent = '🎯 0°'
      $alignText.style.color = '#7dffa0'
    } else if (deg < 25) {
      $alignText.textContent = Math.round(deg) + '°'
      $alignText.style.color = '#ffd75e'
    } else {
      $alignText.textContent = Math.round(deg) + '°'
      $alignText.style.color = '#ff7a7a'
    }

    if (boosting) {
      flameMat.color.setHex(deg < 15 ? CFG.ROCKET.flame.aligned : CFG.ROCKET.flame.misaligned)
    }
  }

  const boostAmt = boosting ? 1 : G.phase === 'fly' ? 0.35 : 0
  const flick = 0.85 + Math.random() * 0.3
  flame.scale.set(boostAmt * flick, boostAmt * flick, boostAmt * flick)
  flameInner.scale.set(boostAmt * flick * 1.1, boostAmt * flick, boostAmt * flick)
  flame.visible = boostAmt > 0.05
  flameInner.visible = flame.visible
  flameMat.opacity = boosting ? 0.95 : 0.5
  exhaustLight.intensity = boostAmt * (boosting ? 45 : 8)
}

function updateChests(dt) {
  const t = performance.now() * 0.001
  const rx = rocketState.pos.x
  const rz = rocketState.pos.z

  for (const c of chests) {
    if (c.opened) continue

    // Пульсация столба
    c.beam.material.opacity = CFG.CHESTS.beamOpacity * (0.75 + Math.sin(t * 2 + c.x * 0.001) * 0.25)

    // Дистанция — в XZ-плоскости, чтобы «ярче» загоралось
    // только когда мы реально приближаемся к сундуку,
    // а не когда просто пролетаем по X мимо.
    const dx = rx - c.x
    const dz = rz - c.z
    const dist = Math.hypot(dx, dz)
    const near = Math.max(0, 1 - dist / CFG.CHESTS.nearRadius)
    c.glow.scale.setScalar(1 + near * 0.6)
    c.glow.material.opacity = 0.35 + near * 0.4
    c.light.intensity = CFG.CHESTS.glowIntensity * (1 + near * 2)
  }
}

const camLook = new THREE.Vector3(0, 3, 0)
let camBlend = 0
// Целевая позиция камеры (куда она стремится). Сохраняем её,
// чтобы updateBoss мог понять, «доехала» ли камера до стартовой
// точки перед замахом босса.
const _camTarget = new THREE.Vector3()

function updateCamera(dt) {
  const p = rocketState.pos
  const gY = terrainHeight(p.x, 0)
  const speed = rocketState.vel.length()

  const wantBehind = G.phase === 'fly' ? 1 : 0
  const blendSpeed = wantBehind > camBlend ? CFG.CAMERA.blendIn : CFG.CAMERA.blendOut
  camBlend += (wantBehind - camBlend) * Math.min(1, dt * blendSpeed)
  if (camBlend < 0.001) camBlend = 0
  if (camBlend > 0.999) camBlend = 1

  const alt = Math.max(0, p.y - gY)
  const altT = Math.min(1, alt / CFG.CAMERA.maxViewHeight)
  const range = CFG.CAMERA.maxAngle - CFG.CAMERA.baseAngle
  const elev = ((CFG.CAMERA.baseAngle + range * altT) * Math.PI) / 180

  const R =
    CFG.CAMERA.baseRadius + Math.min(CFG.CAMERA.maxSpeedRadius, speed * CFG.CAMERA.speedRadiusK)
  const hDist = R * Math.cos(elev)
  const vDist = R * Math.sin(elev)

  const lead = CFG.CAMERA.leadTime
  const px = p.x + rocketState.vel.x * lead
  const py = p.y + rocketState.vel.y * lead
  const pz = p.z + rocketState.vel.z * lead

  const camX = px - hDist * camBlend
  const camY = py + vDist
  // Камера должна следовать и по Z, иначе при сносе ракета
  // будет «уползать» вбок из кадра.
  const camZ = pz + hDist * (1 - camBlend)

  // Запоминаем цель — updateBoss использует её в фазе prekick.
  _camTarget.set(camX, camY, camZ)

  const follow =
    CFG.CAMERA.followBase + Math.min(CFG.CAMERA.followMaxSpeed, speed * CFG.CAMERA.followSpeedK)
  const s = 1 - Math.exp(-follow * dt)

  camera.position.x += (camX - camera.position.x) * s
  camera.position.y += (camY - camera.position.y) * s
  camera.position.z += (camZ - camera.position.z) * s

  const lookAhead =
    (CFG.CAMERA.lookAheadBase + CFG.CAMERA.lookAheadBehind * camBlend) *
    (1 - altT * CFG.CAMERA.lookAheadAltK)
  const lookX = px + lookAhead
  const lookY = py

  camLook.x += (lookX - camLook.x) * s
  camLook.y += (lookY - camLook.y) * s
  camLook.z += (pz - camLook.z) * s

  if (shake > 0) {
    shake = Math.max(0, shake - dt * CFG.CAMERA.shakeDecayK)
    const a = shake * shake * CFG.CAMERA.shakeAmpK
    camera.position.x += (Math.random() - 0.5) * a
    camera.position.y += (Math.random() - 0.5) * a
  }

  camera.lookAt(camLook)
}

function updateScenery() {
  const camX = camera.position.x
  const [ox, oy, oz] = CFG.LIGHTS.sunOffset
  sun.position.set(camX + ox, oy, oz)
  sun.target.position.set(camX, 0, 0)
  sun.target.updateMatrixWorld()
  skyDome.position.copy(camera.position)
}

/* ---------- Эллиптический туман: обновление центра и направления ---------- */
function updateFogEllipse(dt) {
  // Центр эллипса — XZ-позиция ракеты.
  // Логичнее привязывать к ракете, а не к камере: «вперёд» — относительно
  // игрового персонажа, а не наблюдателя.
  fogU.center.value.set(rocketState.pos.x, rocketState.pos.z)

  // Направление — нормированная горизонтальная скорость.
  const v = rocketState.vel
  const speed = Math.hypot(v.x, v.z)

  if (speed >= CFG.FOG.dirMinSpeed) {
    const tx = v.x / speed
    const tz = v.z / speed

    // Сглаживание, чтобы эллипс плавно доворачивал, а не «щёлкал».
    const k = 1 - Math.exp(-CFG.FOG.dirSmoothing * dt)
    fogU.dir.value.x += (tx - fogU.dir.value.x) * k
    fogU.dir.value.y += (tz - fogU.dir.value.y) * k

    // Ре-нормализация, чтобы длина не «сдувалась» сглаживанием.
    const l = Math.hypot(fogU.dir.value.x, fogU.dir.value.y) || 1
    fogU.dir.value.x /= l
    fogU.dir.value.y /= l
  }
  // Если скорость мала — оставляем последнее направление.
}

function updateLOD(dt) {
  const CHANGE_OVERLAY = CFG.LOD.changeAltitude
  const CHANGE_OVERLAY_BACK = CFG.LOD.changeBack
  const SAMPLE_R = CFG.LOD.sampleRadius
  const SAMPLES = CFG.LOD.sampleCount

  const p = rocketState.pos
  const flying = G.phase === 'fly'

  let alt = p.y - terrainHeight(p.x, p.z)
  for (let i = 0; i < SAMPLES; i++) {
    const a = (i / SAMPLES) * Math.PI * 2
    const gx = p.x + Math.cos(a) * SAMPLE_R
    const gz = p.z + Math.sin(a) * SAMPLE_R
    const a2 = p.y - terrainHeight(gx, gz)
    if (a2 < alt) alt = a2
  }
  if (alt < 0) alt = 0

  // Сглаживание высоты по времени — гасит дёрганье на пиках гор
  // и даёт стабильный вход/выход из 2D. Туман тоже использует
  // это сглаженное значение.
  if (!lodAltInit) {
    lodAltSmooth = alt
    lodAltInit = true
  } else {
    const k = 1 - Math.exp(-4.0 * dt) // 4.0 = скорость сглаживания (1/с)
    lodAltSmooth += (alt - lodAltSmooth) * k
  }

  if (!in2DMode) {
    if (flying && lodAltSmooth > CHANGE_OVERLAY) in2DMode = true
  } else {
    if (!flying || lodAltSmooth < CHANGE_OVERLAY_BACK) in2DMode = false
  }

  const targetFade = in2DMode ? 1 : 0
  const speed = in2DMode ? CFG.LOD.fadeIn : CFG.LOD.fadeOut
  lodFade += (targetFade - lodFade) * Math.min(1, dt * speed)
  if (lodFade < 0.005) lodFade = 0
  if (lodFade > 0.995) lodFade = 1

  for (const c of overlayChunks.values()) {
    c.mat.opacity = lodFade
    c.mesh.visible = lodFade > 0.005
  }

  farGroundMat.opacity = lodFade
  const farVisible = lodFade > 0.005
  for (const c of farTiles.values()) c.mesh.visible = farVisible

  const showFine = lodFade < 0.95
  for (const [key, c] of chunks) {
    if (PERSISTENT_CHUNKS.has(key)) continue // ← их видимость рулит updatePersistentVisibility
    c.mesh.visible = showFine
  }

  const want3D = lodFade < 0.15
  if (want3D !== showing3D) {
    for (const [key, c] of chunks) {
      if (PERSISTENT_CHUNKS.has(key)) continue // ← пропускаем
      for (const pr of c.props) pr.visible = want3D
    }
    boss.visible = want3D
    showing3D = want3D
  }

  // ─── Динамический туман по высоте ───
  // «Базовые» значения для 3D-режима. При dynamicByAltitude
  // они интерполируются от nearGround/farGround (у земли)
  // к near3D/far3D (на altRef и выше).
  let dNear = FOG_3D_NEAR
  let dFar = FOG_3D_FAR

  if (CFG.FOG.dynamicByAltitude) {
    const F = CFG.FOG
    const t = Math.min(1, Math.max(0, lodAltSmooth / F.altRef))
    dNear = F.nearGround + (FOG_3D_NEAR - F.nearGround) * t
    dFar = F.farGround + (FOG_3D_FAR - F.farGround) * t
  }

  scene.fog.near = dNear + (FOG_2D_NEAR - dNear) * lodFade
  scene.fog.far = dFar + (FOG_2D_FAR - dFar) * lodFade
}

/* ================================================================
   updatePersistentVisibility — показываем только ближние persistent.

   Persistent-чанки не выгружаются никогда, но в сцене могут
   висеть десятками. Тут мы включаем visible только для тех,
   что находятся в радиусе persistentVisibleRadius от камеры.
   Остальные остаются в scene.children, но с visible=false — Three.js
   пропускает их на этапе рендера почти бесплатно.
================================================================ */
function updatePersistentVisibility(camX, camZ) {
  if (PERSISTENT_CHUNKS.size === 0) return

  const R = CFG.CHUNKS.persistentVisibleRadius
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  // showFine и showProps согласованы с updateLOD.
  const showFine = lodFade < 0.95
  const showProps = showing3D // ← значение уже установлено updateLOD

  for (const key of PERSISTENT_CHUNKS) {
    const c = chunks.get(key)
    if (!c) continue

    const [cs, czs] = key.split(',')
    const near = Math.abs(+cs - cxi) <= R && Math.abs(+czs - czi) <= R

    c.mesh.visible = near && showFine

    const pv = near && showProps
    for (const p of c.props) p.visible = pv
  }
}

/* ================================================================
   Кэш «последней ячейки» для per-cell update-функций.

   Раньше updateChunks / updateFarTiles / updateOverlayChunks /
   updatePersistentVisibility вызывались КАЖДЫЙ кадр, хотя реально
   зависят от дискретных величин: номер ячейки, в которой сидит
   камера, и от состояния LOD (showFine / showProps / loadingEnabled).

   Теперь пересчёт идёт только когда эти величины изменились.
   При 60 fps это снимает ~400 итераций × 60 ≈ 24 000 итераций/с,
   а также убирает key.split(',') и аллокации из горячего пути.
================================================================ */
let _lastChunkCell = { x: NaN, z: NaN }
let _lastFarCell = { x: NaN, z: NaN }
let _lastOverlayCell = { x: NaN, z: NaN }
let _lastPersistState = { cxi: NaN, czi: NaN, showFine: null, showProps: null }

function updateSceneryCells() {
  const camX = camera.position.x
  const camZ = camera.position.z

  // ---------- План (редко) ----------
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)
  if (cxi !== _lastChunkCell.x || czi !== _lastChunkCell.z) {
    refillChunkQueue(camX, camZ)
    _lastChunkCell.x = cxi
    _lastChunkCell.z = czi
  }

  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)
  if (fxi !== _lastFarCell.x || fzi !== _lastFarCell.z) {
    refillFarTiles(camX, camZ)
    _lastFarCell.x = fxi
    _lastFarCell.z = fzi
  }

  const oxi = Math.floor(camX / OVERLAY_SIZE)
  const ozi = Math.floor(camZ / OVERLAY_SIZE)
  if (oxi !== _lastOverlayCell.x || ozi !== _lastOverlayCell.z) {
    refillOverlayChunks(camX, camZ)
    _lastOverlayCell.x = oxi
    _lastOverlayCell.z = ozi
  }

  // ---------- Исполнение (каждый кадр, но дешёвое) ----------
  processChunkQueue()
  processFarTiles()
  processOverlayChunks()

  // ---------- Persistent: видимость ----------
  const showFine = lodFade < 0.95
  const showProps = showing3D
  if (
    cxi !== _lastPersistState.cxi ||
    czi !== _lastPersistState.czi ||
    showFine !== _lastPersistState.showFine ||
    showProps !== _lastPersistState.showProps
  ) {
    updatePersistentVisibility(camX, camZ)
    _lastPersistState.cxi = cxi
    _lastPersistState.czi = czi
    _lastPersistState.showFine = showFine
    _lastPersistState.showProps = showProps
  }
}

/* ================================================================
   12. MAIN LOOP
================================================================ */
let last = performance.now()

function loop(now) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now

  update(dt)
  renderer.render(scene, camera)

  requestAnimationFrame(loop)
}

/* ================================================================
   13. INIT
================================================================ */
applySkyFog(groundMat)
applySkyFog(farGroundMat)
applySkyFog(propMat)

loadProgress()
initChests()
resetRocket()
rocket.position.copy(rocketState.pos)
G.fuel = maxFuel()
updateHUD()
renderShop()

/* ================================================================
   Первичная загрузка — порционная, с прогресс-баром.
================================================================ */
async function initialLoad() {
  const $loading = document.getElementById('loading')
  const $bar = document.getElementById('loadingBar')
  const $text = document.getElementById('loadingText')
  if ($loading) $loading.style.display = 'flex'

  const cxi = Math.floor(camera.position.x / CHUNK_SIZE)
  const czi = Math.floor(camera.position.z / CHUNK_SIZE)

  // --- Собираем список нужных 3D-чанков ---
  const needed = []
  const seen = new Set()
  for (let dx = -LOAD_BACK_CHUNKS; dx <= LOAD_FWD_CHUNKS; dx++) {
    for (let dz = -LOAD_SIDE_CHUNKS; dz <= LOAD_SIDE_CHUNKS; dz++) {
      const key = cxi + dx + ',' + (czi + dz)
      if (!seen.has(key)) {
        seen.add(key)
        needed.push([cxi + dx, czi + dz])
      }
    }
  }
  for (const key of PERSISTENT_CHUNKS) {
    if (seen.has(key)) continue
    const [cs, czs] = key.split(',')
    needed.push([+cs, +czs])
  }

  // Far-tiles и overlay заранее оцениваем для прогресс-бара
  const FAR_NEEDED = (FAR_LOAD_R * 2 + 1) ** 2 // 25
  const OVR_NEEDED = (OVERLAY_LOAD_R * 2 + 1) ** 2 // 9

  const totalSteps = needed.length + FAR_NEEDED + OVR_NEEDED
  let done = 0
  const updateProgress = (label = 'Загрузка мира') => {
    if ($bar) $bar.style.width = ((done / totalSteps) * 100).toFixed(1) + '%'
    if ($text) $text.textContent = `${label}… ${done} / ${totalSteps}`
  }
  updateProgress()

  // ---------- 1) 3D-чанки ----------
  const BUDGET_MS = 12
  for (let i = 0; i < needed.length; ) {
    const t0 = performance.now()
    while (i < needed.length && performance.now() - t0 < BUDGET_MS) {
      const [cx, cz] = needed[i]
      loadChunk(cx, cz)
      i++
      done++
    }
    updateProgress()
    await new Promise((r) => requestAnimationFrame(r))
  }

  // ---------- 2) Дальние тайлы: строим через тот же builder, но с бюджетом ----------
  // Сначала пополняем очередь (без генерации)
  updateFarTiles(camera.position.x, camera.position.z, false)

  while (pendingFarTiles.size > 0) {
    const t0 = performance.now()
    while (performance.now() - t0 < BUDGET_MS && pendingFarTiles.size > 0) {
      for (const [key, p] of pendingFarTiles) {
        // по 4 мс на тайл — чтобы можно было переключаться между тайлами
        if (p.builder.step(4)) {
          finalizeFarTile(key, p.fx, p.fz, p.builder.geo)
          pendingFarTiles.delete(key)
          done++
        }
        if (performance.now() - t0 >= BUDGET_MS) break
      }
    }
    updateProgress('Дальний рельеф')
    await new Promise((r) => requestAnimationFrame(r))
  }

  // ---------- 3) Overlay-чанки: то же самое ----------
  updateOverlayChunks(camera.position.x, camera.position.z, false)

  while (pendingOverlays.size > 0) {
    const t0 = performance.now()
    while (performance.now() - t0 < BUDGET_MS && pendingOverlays.size > 0) {
      for (const [key, p] of pendingOverlays) {
        if (p.builder.step(4)) {
          finalizeOverlayChunk(key, p.ox, p.oz, p.builder)
          pendingOverlays.delete(key)
          done++
        }
        if (performance.now() - t0 >= BUDGET_MS) break
      }
    }
    updateProgress('Лес')
    await new Promise((r) => requestAnimationFrame(r))
  }

  if ($loading) $loading.style.display = 'none'

  // Запускаем главный цикл
  requestAnimationFrame(loop)

  setTimeout(() => showToast('ПНИ РАКЕТУ! 🦵', CFG.UI.toastColors.upgrade), 400)
}

initialLoad()

/* ================================================================
   DEBUG — счётчики в консоли (вызывай вручную из консоли браузера)
================================================================ */
window.dbg = () => {
  let persistentLoaded = 0
  for (const key of chunks.keys()) {
    if (PERSISTENT_CHUNKS.has(key)) persistentLoaded++
  }
  console.log(
    `chunks=${chunks.size} (persistent=${persistentLoaded}/${PERSISTENT_CHUNKS.size}) ` +
      `propsCache=${propsCache.size} ` +
      `farTiles=${farTiles.size} ` +
      `overlayChunks=${overlayChunks.size} ` +
      `pendingFar=${pendingFarTiles.size} pendingOv=${pendingOverlays.size}`
  )
  console.log(
    `lodFade=${lodFade.toFixed(2)} in2DMode=${in2DMode} ` +
      `altSmooth=${lodAltSmooth.toFixed(0)} ` +
      `rocketX=${rocketState.pos.x.toFixed(0)} rocketY=${rocketState.pos.y.toFixed(0)}`
  )
}

/** Показать список persistent-чанков и их статус в сцене. */
window.dbgPersistent = () => {
  const list = []
  for (const key of PERSISTENT_CHUNKS) {
    const c = chunks.get(key)
    list.push({
      key,
      loaded: !!c,
      visible: c ? c.mesh.visible : null,
    })
  }
  console.table(list)
}
