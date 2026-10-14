/* ================================================================
   main.js — точка входа игры.
   Здесь: рендерер, сцена, камера, чанки, пропсы, босс, ракета,
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
  makeGroundTexture,
  GROUND_TILE,
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
const CHUNKS_PER_FRAME = CFG.CHUNKS.perFrame
const COUNT = CFG.PROPS.density

const chunks = new Map()
let showing3D = true

function makeChunkMesh(cx, cz) {
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_SEG, CHUNK_SEG)
  geo.rotateX(-Math.PI / 2)

  const cxw = cx * CHUNK_SIZE + CHUNK_SIZE / 2
  const czw = cz * CHUNK_SIZE + CHUNK_SIZE / 2

  const pos = geo.attributes.position
  const uv = geo.attributes.uv

  const colArr = new Float32Array(pos.count * 3)
  const col = new THREE.Color()

  for (let i = 0; i < pos.count; i++) {
    const wx = cxw + pos.getX(i)
    const wz = czw + pos.getZ(i)
    const h = terrainHeight(wx, wz)

    pos.setY(i, h)
    uv.setXY(i, wx / TILE, wz / TILE)

    heightToTerrainColor(h, col)
    colArr[i * 3] = col.r
    colArr[i * 3 + 1] = col.g
    colArr[i * 3 + 2] = col.b
  }
  pos.needsUpdate = true
  uv.needsUpdate = true
  geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3))
  geo.computeVertexNormals()

  const mesh = new THREE.Mesh(geo, groundMat)
  mesh.position.set(cxw, 0, czw)
  mesh.receiveShadow = false
  return mesh
}

const _dummyObj = new THREE.Object3D()
const _Y_UP = new THREE.Vector3(0, 1, 0)
const _tmpNormal = new THREE.Vector3()

// Ссылки на prop-материал/тень — задаются ниже в секции PROPS
let propMatRef = null
let shadowDiskGeoRef = null
let shadowDiskMatRef = null

/* ================================================================
   computeChunkProps — детерминированный список «что где растёт»
   на чанке (cx, cz). Никакой привязки к THREE.
   Один и тот же вызов из 3D-пропсов и из overlay-точек даёт
   ОДИНАКОВЫЙ набор позиций → точки попадают точно под деревья.
================================================================ */
function computeChunkProps(cx, cz) {
  const seed = hash2i(cx + 0x9e37, cz + 0x79b9) ^ WORLD_SEED
  const rng = mulberry32(seed)

  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE

  const items = []
  const TH = CFG.PROPS.thresholds
  const SC = CFG.PROPS.scales
  const SAFE_R2 = CFG.PROPS.safeRadius * CFG.PROPS.safeRadius

  for (let i = 0; i < COUNT; i++) {
    const wx = baseX + rng() * CHUNK_SIZE
    const wz = baseZ + rng() * CHUNK_SIZE

    const dx = wx + 2.6
    const dz = wz
    if (dx * dx + dz * dz < SAFE_R2) continue

    const r = rng()
    let kind
    if (r < TH.pine) kind = 'pine'
    else if (r < TH.oak) kind = 'oak'
    else if (r < TH.bush) kind = 'bush'
    else kind = 'rock'

    const scale =
      kind === 'rock'
        ? SC.rock[0] + rng() * (SC.rock[1] - SC.rock[0])
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
function spawnChunkProps(cx, cz) {
  const items = computeChunkProps(cx, cz)

  // Раскладываем по группам; y-координату считаем здесь (нужна
  // только для 3D-рендера, поэтому её нет в computeChunkProps).
  const groups = { pine: [], oak: [], bush: [], rock: [] }
  for (const it of items) {
    groups[it.kind].push({
      x: it.x,
      y: terrainHeight(it.x, it.z),
      z: it.z,
      scale: it.scale,
      rotY: it.rotY,
    })
  }

  const meshes = []
  const allShadows = []

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
      allShadows.push(it)
    }
    inst.instanceMatrix.needsUpdate = true
    scene.add(inst)
    meshes.push(inst)
  }

  // ---------- Запечённые тени ----------
  if (allShadows.length > 0) {
    const shadowInst = new THREE.InstancedMesh(
      shadowDiskGeoRef,
      shadowDiskMatRef,
      allShadows.length
    )
    shadowInst.instanceMatrix.setUsage(THREE.StaticDrawUsage)
    shadowInst.renderOrder = 1
    shadowInst.castShadow = false
    shadowInst.receiveShadow = false

    const ss = CFG.PROPS.shadow.scale
    const yo = CFG.PROPS.shadow.yOffset
    const eps = 1.5 // шаг конечных разниц для нормали, м

    for (let i = 0; i < allShadows.length; i++) {
      const p = allShadows[i]

      // Нормаль рельефа в точке (p.x, p.z).
      const hX = terrainHeight(p.x + eps, p.z)
      const hZ = terrainHeight(p.x, p.z + eps)
      _tmpNormal.set(-(hX - p.y) / eps, 1, -(hZ - p.y) / eps).normalize()

      // Сдвиг вдоль НОРМАЛИ, а не по мировому Y.
      _dummyObj.position.set(
        p.x + _tmpNormal.x * yo,
        p.y + _tmpNormal.y * yo,
        p.z + _tmpNormal.z * yo
      )

      // Диск по умолчанию лежит в XZ — доворачиваем нормаль к рельефу.
      _dummyObj.quaternion.setFromUnitVectors(_Y_UP, _tmpNormal)

      _dummyObj.scale.set(p.scale * ss, 1, p.scale * ss)
      _dummyObj.updateMatrix()
      shadowInst.setMatrixAt(i, _dummyObj.matrix)
    }

    shadowInst.instanceMatrix.needsUpdate = true
    scene.add(shadowInst)
    meshes.push(shadowInst)
  }

  return meshes
}

function loadChunk(cx, cz) {
  const key = cx + ',' + cz
  if (chunks.has(key)) return
  const mesh = makeChunkMesh(cx, cz)
  const props = spawnChunkProps(cx, cz)
  scene.add(mesh)
  for (const p of props) p.visible = showing3D
  chunks.set(key, { mesh, props })
}

function unloadChunk(key) {
  const c = chunks.get(key)
  if (!c) return
  scene.remove(c.mesh)
  c.mesh.geometry.dispose()
  for (const p of c.props) scene.remove(p)
  chunks.delete(key)
}

function updateChunks(camX, camZ, initial = false) {
  const cxi = Math.floor(camX / CHUNK_SIZE)
  const czi = Math.floor(camZ / CHUNK_SIZE)

  // --- Выгрузка: всегда, чтобы не копить мусор ---
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

  // --- НЕ грузим новые чанки, пока сидим в 2D ---
  // lodFade > 0.5 значит уже глубоко в 2D-режиме, толку от детальных чанков нет.
  if (!initial && lodFade > 0.5) return

  // --- Загрузка ---
  const toLoad = []
  for (let dx = -LOAD_BACK_CHUNKS; dx <= LOAD_FWD_CHUNKS; dx++) {
    for (let dz = -LOAD_SIDE_CHUNKS; dz <= LOAD_SIDE_CHUNKS; dz++) {
      const cx = cxi + dx,
        cz = czi + dz
      if (!chunks.has(cx + ',' + cz)) toLoad.push([cx, cz])
    }
  }

  if (initial) {
    for (const [cx, cz] of toLoad) loadChunk(cx, cz)
  } else {
    const n = Math.min(CHUNKS_PER_FRAME, toLoad.length)
    for (let i = 0; i < n; i++) loadChunk(toLoad[i][0], toLoad[i][1])
  }
}

/* ================================================================
   3c. FAR GROUND TILES
================================================================ */
const FAR_TILE_SIZE = CFG.FAR_TILES.size
const FAR_TILE_SEG = CFG.FAR_TILES.segments
const FAR_LOAD_R = CFG.FAR_TILES.loadRadius
const FAR_UNLOAD_R = CFG.FAR_TILES.unloadRadius
const FAR_PER_FRAME = CFG.FAR_TILES.perFrame

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

function updateFarTiles(camX, camZ, initial = false) {
  const fxi = Math.floor(camX / FAR_TILE_SIZE)
  const fzi = Math.floor(camZ / FAR_TILE_SIZE)

  // 1) Пополняем очередь — БЕЗ генерации.
  for (let dx = -FAR_LOAD_R; dx <= FAR_LOAD_R; dx++) {
    for (let dz = -FAR_LOAD_R; dz <= FAR_LOAD_R; dz++) {
      const fx = fxi + dx,
        fz = fzi + dz
      const key = fx + ',' + fz
      if (farTiles.has(key) || pendingFarTiles.has(key)) continue
      pendingFarTiles.set(key, { fx, fz, builder: createFarTileBuilder(fx, fz) })
    }
  }

  // 2) Прогреваем очередь.
  if (initial) {
    // При первичной загрузке строим синхронно (один раз на старте — ок).
    for (const [key, p] of pendingFarTiles) {
      while (!p.builder.step(Infinity)) {}
      finalizeFarTile(key, p.fx, p.fz, p.builder.geo)
    }
    pendingFarTiles.clear()
  } else {
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

  // 3) Отменяем «уехавшие» pending-тайлы.
  for (const [key, p] of pendingFarTiles) {
    if (Math.abs(p.fx - fxi) > FAR_UNLOAD_R || Math.abs(p.fz - fzi) > FAR_UNLOAD_R) {
      p.builder.geo.dispose()
      pendingFarTiles.delete(key)
    }
  }

  // 4) Выгрузка — как было.
  const toUnload = []
  for (const key of farTiles.keys()) {
    const [fxs, fzs] = key.split(',')
    if (Math.abs(+fxs - fxi) > FAR_UNLOAD_R || Math.abs(+fzs - fzi) > FAR_UNLOAD_R) {
      toUnload.push(key)
    }
  }
  for (const k of toUnload) unloadFarTile(k)
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

const shadowDiskGeo = new THREE.CircleGeometry(1, 8)
shadowDiskGeo.rotateX(-Math.PI / 2)
const shadowDiskMat = new THREE.MeshBasicMaterial({
  color: CFG.PROPS.shadow.color,
  transparent: true,
  opacity: CFG.PROPS.shadow.opacity,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: CFG.PROPS.shadow.polygonOffset,
  polygonOffsetUnits: CFG.PROPS.shadow.polygonOffset,
})
shadowDiskGeoRef = shadowDiskGeo
shadowDiskMatRef = shadowDiskMat

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
const OVERLAY_PER_FRAME = CFG.OVERLAY.perFrame

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

function updateOverlayChunks(camX, camZ, initial = false) {
  // --- Overlay выключен: чистим всё, что успело построиться. ---
  // Работает и при статичном конфиге (тогда просто пустой сетап),
  // и при hot-toggle: переключил в false — чанки тут же удаляются.
  if (!CFG.OVERLAY.enabled) {
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

  // 1) Пополняем очередь.
  for (let dx = -OVERLAY_LOAD_R; dx <= OVERLAY_LOAD_R; dx++) {
    for (let dz = -OVERLAY_LOAD_R; dz <= OVERLAY_LOAD_R; dz++) {
      const ox = oxi + dx,
        oz = ozi + dz
      const key = ox + ',' + oz
      if (overlayChunks.has(key) || pendingOverlays.has(key)) continue
      pendingOverlays.set(key, { ox, oz, builder: createOverlayBuilder(ox, oz) })
    }
  }

  // 2) Прогреваем.
  if (initial) {
    for (const [key, p] of pendingOverlays) {
      while (!p.builder.step(Infinity)) {}
      finalizeOverlayChunk(key, p.ox, p.oz, p.builder)
    }
    pendingOverlays.clear()
  } else {
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

  // 3) Отменяем «уехавшие» pending-чанки.
  for (const [key, p] of pendingOverlays) {
    if (Math.abs(p.ox - oxi) > OVERLAY_UNLOAD_R || Math.abs(p.oz - ozi) > OVERLAY_UNLOAD_R) {
      p.builder.geo.dispose()
      pendingOverlays.delete(key)
    }
  }

  // 4) Выгрузка — как было.
  const toUnload = []
  for (const key of overlayChunks.keys()) {
    const [oxs, ozs] = key.split(',')
    if (Math.abs(+oxs - oxi) > OVERLAY_UNLOAD_R || Math.abs(+ozs - ozi) > OVERLAY_UNLOAD_R)
      toUnload.push(key)
  }
  for (const k of toUnload) unloadOverlayChunk(k)
}

// Флаги LOD
let in2DMode = false
let lodFade = 0

const FOG_3D_NEAR = CFG.FOG.near3D,
  FOG_3D_FAR = CFG.FOG.far3D
const FOG_2D_NEAR = CFG.FOG.near2D,
  FOG_2D_FAR = CFG.FOG.far2D

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
}

const rocketState = {
  pos: new THREE.Vector3(0, REST_Y, 0),
  vel: new THREE.Vector3(),
  angVel: 0,
}

let boosting = false

const UPGRADES = CFG.UPGRADES
const costOf = (u) => CFG.RULES.upgradeCost(u, G.upgrades[u.key])
const launchSpeed = () => CFG.RULES.launchSpeed(G.upgrades)
const maxFuel = () => CFG.RULES.maxFuel(G.upgrades)
const thrustAcc = () => CFG.RULES.thrustAcc(G.upgrades)
const dragCoef = () => CFG.RULES.dragCoef(G.upgrades)
const airDensity = (y) => CFG.RULES.airDensity(y)

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
    btn.innerHTML = `
      <div class="u-icon">${u.icon}</div>
      <div>
        <div class="u-name">${u.name} <span class="u-lvl">Lv.${lvl}</span></div>
        <div class="u-desc">${u.desc}</div>
      </div>
      <div class="u-cost">💥 ${cost}</div>`
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

renderer.domElement.addEventListener('pointerdown', () => {
  if (G.phase === 'fly') {
    input.boost = true
  } else if (G.phase === 'ready' || G.phase === 'landed') {
    startKick()
  }
})
addEventListener('pointerup', () => {
  input.boost = false
})
addEventListener('pointercancel', () => {
  input.boost = false
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
  G.phase = 'windup'
  G.timer = 0
  $launch.classList.add('hidden')
  $shop.style.display = 'none'
}

function resetRocket() {
  const gY = terrainHeight(0, 0)
  rocketState.pos.set(0, gY + REST_Y, 0)
  rocketState.vel.set(0, 0, 0)
  rocket.rotation.z = 0
  rocketState.angVel = 0
  rocket.position.copy(rocketState.pos)
  G.fuel = maxFuel()
  input.boost = false
}

function launch() {
  const speed = launchSpeed()
  rocketState.vel.set(Math.cos(LAUNCH_ANGLE) * speed, Math.sin(LAUNCH_ANGLE) * speed, 0)
  rocket.rotation.z = LAUNCH_ANGLE
  rocketState.angVel = 0
  G.phase = 'fly'
  G.timer = 0
  boosting = false
  showToast('ПОЛЕТЕЛИ! 🚀', CFG.UI.toastColors.upgrade)
}

function land() {
  G.phase = 'landed'
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

let shake = 0

/* ================================================================
   11. UPDATE
================================================================ */
function update(dt) {
  updateBoss(dt)
  updateRocket(dt)
  updateCamera(dt)
  updateScenery()
  updateFogEllipse(dt)
  updateChunks(camera.position.x, camera.position.z)
  updateFarTiles(camera.position.x, camera.position.z)
  updateOverlayChunks(camera.position.x, camera.position.z)
  updateLOD(dt)

  if (G.phase === 'fly') {
    $boostUI.classList.add('on')
    $touchUI.classList.remove('hidden')
    $fuelFill.style.width = (G.fuel / maxFuel()) * 100 + '%'
    $fuelText.textContent = G.fuel.toFixed(1)
  } else {
    $boostUI.classList.remove('on')
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
    boosting = input.boost && G.fuel > 0
    if (boosting) {
      const ta = thrustAcc()
      const ang = rocket.rotation.z
      p.vel.x += Math.cos(ang) * ta * dt
      p.vel.y += Math.sin(ang) * ta * dt
      G.fuel = Math.max(0, G.fuel - dt)
    }

    p.vel.y -= GRAVITY * dt

    const speed = p.vel.length()
    if (speed > 0.01) {
      const k = dragCoef() * airDensity(p.pos.y)
      const aDrag = k * speed
      p.vel.x -= p.vel.x * aDrag * dt
      p.vel.y -= p.vel.y * aDrag * dt
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

const camLook = new THREE.Vector3(0, 3, 0)
let camBlend = 0

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

  const camX = px - hDist * camBlend
  const camY = py + vDist
  const camZ = hDist * (1 - camBlend)

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
  camLook.z += (0 - camLook.z) * s

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

  if (!in2DMode) {
    if (flying && alt > CHANGE_OVERLAY) in2DMode = true
  } else {
    if (!flying || alt < CHANGE_OVERLAY_BACK) in2DMode = false
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
  for (const c of chunks.values()) c.mesh.visible = showFine

  const want3D = lodFade < 0.15
  if (want3D !== showing3D) {
    for (const c of chunks.values()) {
      for (const pr of c.props) pr.visible = want3D
    }
    boss.visible = want3D
    showing3D = want3D
  }

  scene.fog.near = FOG_3D_NEAR + (FOG_2D_NEAR - FOG_3D_NEAR) * lodFade
  scene.fog.far = FOG_3D_FAR + (FOG_2D_FAR - FOG_3D_FAR) * lodFade
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
applySkyFog(shadowDiskMat)

loadProgress() // ← сначала загружаем сейв
resetRocket()
rocket.position.copy(rocketState.pos)
G.fuel = maxFuel()
updateHUD() // показывает монеты/рекорд из сейва
renderShop() // показывает уровни из сейва

updateChunks(camera.position.x, camera.position.z, true)
updateFarTiles(camera.position.x, camera.position.z, true)
updateOverlayChunks(camera.position.x, camera.position.z, true)

requestAnimationFrame(loop)

setTimeout(() => showToast('ПНИ РАКЕТУ! 🦵', CFG.UI.toastColors.upgrade), 400)
