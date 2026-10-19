/* ================================================================
   space.js — визуальный переход в космос по высоте.

   Управляет:
     • цветом неба/фога (лерп от daynight-значений к SPACE-пресету),
     • интенсивностью света,
     • звёздами (THREE.Points, twinkle в шейдере),
     • светящимися сферами (InstancedMesh, пульсация в шейдере).

   ВАЖНО: update() вызывать ПОСЛЕ DayNight.update() — мы лерпим уже
   посчитанные daynight-значения. Иначе затрутся.
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'
import { scene, camera, sun, hemiLight, SKY_ZENITH, SKY_HORIZON, HAZE_COLOR } from './scene.js'
import { rocketState, time } from './state.js'
import { hash2i, mulberry32 } from './world/world.js'

const SPC = CFG.SPACE

/* ---------- Состояние ---------- */
let _initialized = false
let _factor = 0

const _spaceZenith = new THREE.Color(SPC.zenith)
const _spaceHorizon = new THREE.Color(SPC.horizon)
const _dayHaze = new THREE.Vector3(...CFG.SKY.hazeColor)

/* ================================================================
   ЗВЁЗДЫ
================================================================ */
let _stars = null
let _starMat = null

function makeStarGeometry() {
  const N = SPC.stars.count
  const R = SPC.stars.radius
  const positions = new Float32Array(N * 3)
  const phases = new Float32Array(N)
  const speeds = new Float32Array(N)
  const brights = new Float32Array(N)
  const sizes = new Float32Array(N)

  const rng = mulberry32((CFG.WORLD_SEED ^ 0x5747a3c1) >>> 0)

  for (let i = 0; i < N; i++) {
    // Равномерно по сфере
    const u = rng() * 2 - 1
    const th = rng() * Math.PI * 2
    const rxz = Math.sqrt(1 - u * u)
    positions[i * 3 + 0] = rxz * Math.cos(th) * R
    positions[i * 3 + 1] = u * R
    positions[i * 3 + 2] = rxz * Math.sin(th) * R

    phases[i] = rng() * Math.PI * 2
    speeds[i] = SPC.stars.twinkleSpeed * (0.5 + rng())
    brights[i] = 0.4 + rng() * 0.6
    sizes[i] = 0.6 + rng() * 1.2
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geo.setAttribute('aSpeed', new THREE.BufferAttribute(speeds, 1))
  geo.setAttribute('aBright', new THREE.BufferAttribute(brights, 1))
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  return geo
}

function makeStarMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: SPC.stars.size },
      uPixelRatio: { value: Math.min(devicePixelRatio, CFG.RENDERER.pixelRatioCap) },
      uOpacity: { value: 0 },
      uColor: { value: new THREE.Color(SPC.stars.color) },
      uTwinkleAmp: { value: SPC.stars.twinkleAmp },
    },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSpeed;
      attribute float aBright;
      attribute float aSize;
      uniform float uTime;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uTwinkleAmp;
      varying float vBright;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float tw = 0.5 + 0.5 * sin(uTime * aSpeed + aPhase);
        float intensity = 1.0 - uTwinkleAmp * (1.0 - tw);
        vBright = aBright * intensity;
        gl_PointSize = uSize * aSize * uPixelRatio;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying float vBright;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.1, d) * vBright * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  })
}

/* ================================================================
   СФЕРЫ
================================================================ */
let _sphereMesh = null
let _sphereMat = null
const _sphereCells = new Map() // key → [{x,y,z,r,colorIdx,phase}]
const _activeCells = new Set()
const _dummy = new THREE.Object3D()
const _tmpColor = new THREE.Color()

function getSphereCell(cx, cy, cz) {
  const key = cx + ',' + cy + ',' + cz
  const cached = _sphereCells.get(key)
  if (cached) return cached

  const seed =
    (hash2i(cx + 0x51ab, cy + 0x8c3d) ^ hash2i(cz + 0x3e91, 0x4f3d) ^ CFG.WORLD_SEED) >>> 0
  const rng = mulberry32(seed)

  const CS = SPC.spheres.cellSize
  const N = SPC.spheres.perCell
  const Rmin = SPC.spheres.radius[0]
  const Rmax = SPC.spheres.radius[1]
  const colorsLen = SPC.spheres.colors.length

  const items = new Array(N)
  for (let i = 0; i < N; i++) {
    items[i] = {
      x: (cx + rng()) * CS,
      y: (cy + rng()) * CS,
      z: (cz + rng()) * CS,
      r: Rmin + rng() * (Rmax - Rmin),
      colorIdx: Math.floor(rng() * colorsLen),
      phase: rng() * Math.PI * 2,
    }
  }
  _sphereCells.set(key, items)
  return items
}

function buildSphereGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, SPC.spheres.geoDetail)
  const maxN = SPC.spheres.maxCount
  const colors = new Float32Array(maxN * 3)
  const phases = new Float32Array(maxN)
  geo.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3))
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1))
  return geo
}

function makeSphereMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
      uPulseAmp: { value: SPC.spheres.pulseAmp },
      uPulseSpeed: { value: SPC.spheres.pulseSpeed },
      uNearFadeDist: { value: SPC.spheres.nearFadeDist },
      uEdgeFalloff: { value: SPC.spheres.edgeFalloff },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aColor;
      attribute float aPhase;
      uniform float uTime;
      uniform float uOpacity;
      uniform float uPulseAmp;
      uniform float uPulseSpeed;
      uniform float uNearFadeDist;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vFacing;             
      void main() {
        vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec3 wpos = worldPos.xyz;

        // Нормаль в мире. instanceMatrix уже содержит равномерный масштаб
        // (мы делаем _dummy.scale.setScalar(s.r)), поэтому normalize
        // восстанавливает корректное направление.
        vec3 worldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vec3 toCam = normalize(cameraPosition - wpos);
        // 1.0 — нормаль прямо на камеру (центр видимого диска),
        // 0.0 — нормаль перпендикулярна взгляду (силуэт).
        vFacing = max(dot(worldNormal, toCam), 0.0);

        float distToCam = distance(wpos, cameraPosition);
        float nearFade = clamp(distToCam / uNearFadeDist, 0.0, 1.0);
        float pulse = 1.0 - uPulseAmp * 0.5 * (1.0 - sin(uTime * uPulseSpeed + aPhase));
        vAlpha = uOpacity * nearFade * pulse;
        vColor = aColor;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uEdgeFalloff;
      varying vec3 vColor;
      varying float vAlpha;
      varying float vFacing;
      void main() {
        // Яркий центр → прозрачный край. С additive-блендингом
        // «меньше alpha» = «меньше вклад в кадр» = «прозрачнее».
        float edge = pow(vFacing, uEdgeFalloff);
        float a = vAlpha * edge;
        if (a < 0.005) discard;
        gl_FragColor = vec4(vColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    fog: false,
  })
}

function rebuildSphereInstances() {
  if (!_sphereMesh) return
  const maxN = SPC.spheres.maxCount
  const CS = SPC.spheres.cellSize
  const palette = SPC.spheres.colors
  const jitter = SPC.spheres.colorJitter
  const cam = camera.position

  // Собираем активные ячейки и сортируем по удалённости от камеры.
  // Если (2·loadRadius+1)^3 · perCell > maxCount — без сортировки
  // в инстанс попадают первые по порядку вставки ячейки (угол области),
  // которые при большом loadRadius далеко за far-плоскостью → сферы невидимы.
  const cellArr = []
  for (const key of _activeCells) {
    const p = key.split(',')
    const ox = (+p[0] + 0.5) * CS - cam.x
    const oy = (+p[1] + 0.5) * CS - cam.y
    const oz = (+p[2] + 0.5) * CS - cam.z
    cellArr.push({ key, d2: ox * ox + oy * oy + oz * oz })
  }
  cellArr.sort((a, b) => a.d2 - b.d2)

  const colorAttr = _sphereMesh.geometry.getAttribute('aColor')
  const phaseAttr = _sphereMesh.geometry.getAttribute('aPhase')
  const colorArr = colorAttr.array
  const phaseArr = phaseAttr.array

  let idx = 0
  outer: for (const { key } of cellArr) {
    const items = _sphereCells.get(key)
    if (!items) continue
    for (let i = 0; i < items.length; i++) {
      if (idx >= maxN) break outer
      const s = items[i]

      _dummy.position.set(s.x, s.y, s.z)
      _dummy.scale.setScalar(s.r)
      _dummy.updateMatrix()
      _sphereMesh.setMatrixAt(idx, _dummy.matrix)

      _tmpColor.setHex(palette[s.colorIdx])
      const f = 1 + Math.sin(s.phase * 7.13) * 0.5 * jitter
      colorArr[idx * 3 + 0] = _tmpColor.r * f
      colorArr[idx * 3 + 1] = _tmpColor.g * f
      colorArr[idx * 3 + 2] = _tmpColor.b * f
      phaseArr[idx] = s.phase
      idx++
    }
  }

  _sphereMesh.count = idx
  _sphereMesh.instanceMatrix.needsUpdate = true
  colorAttr.needsUpdate = true
  phaseAttr.needsUpdate = true
}

function refillCells(camX, camY, camZ) {
  const CS = SPC.spheres.cellSize
  const R = SPC.spheres.loadRadius
  const cxi = Math.floor(camX / CS)
  const cyi = Math.floor(camY / CS)
  const czi = Math.floor(camZ / CS)

  // Загрузка
  for (let dx = -R; dx <= R; dx++) {
    for (let dy = -R; dy <= R; dy++) {
      for (let dz = -R; dz <= R; dz++) {
        const key = cxi + dx + ',' + (cyi + dy) + ',' + (czi + dz)
        if (_activeCells.has(key)) continue
        getSphereCell(cxi + dx, cyi + dy, czi + dz)
        _activeCells.add(key)
      }
    }
  }

  // Выгрузка
  for (const key of _activeCells) {
    const p = key.split(',')
    if (Math.abs(+p[0] - cxi) > R || Math.abs(+p[1] - cyi) > R || Math.abs(+p[2] - czi) > R) {
      _activeCells.delete(key)
      _sphereCells.delete(key)
    }
  }
}

/* ================================================================
   INIT
================================================================ */
export function init() {
  if (_initialized) return
  _initialized = true

  // --- Звёзды ---
  _starMat = makeStarMaterial()
  _stars = new THREE.Points(makeStarGeometry(), _starMat)
  _stars.frustumCulled = false
  _stars.renderOrder = 1
  _stars.visible = false
  scene.add(_stars)

  // --- Сферы ---
  _sphereMat = makeSphereMaterial()
  _sphereMesh = new THREE.InstancedMesh(buildSphereGeometry(), _sphereMat, SPC.spheres.maxCount)
  _sphereMesh.frustumCulled = false
  _sphereMesh.renderOrder = 2
  _sphereMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  _sphereMesh.count = 0
  _sphereMesh.visible = false
  scene.add(_sphereMesh)
}

/* ================================================================
   UPDATE
================================================================ */
let _lastCell = { x: NaN, y: NaN, z: NaN }

export function update() {
  if (!_initialized) return

  // --- spaceFactor по rocketState.pos.y ---
  const y = rocketState.pos.y
  const a = SPC.startAltitude
  const b = SPC.blendToAltitude
  let f
  if (y <= a) f = 0
  else if (y >= b) f = 1
  else {
    const t = (y - a) / (b - a)
    f = t * t * (3 - 2 * t) // smoothstep
  }
  _factor = f

  // --- Небо/фог: лерпим ОТ daynight-значений к space ---
  // DayNight.update() уже записал в SKY_ZENITH / SKY_HORIZON / scene.fog.color.
  SKY_ZENITH.lerp(_spaceZenith, f)
  SKY_HORIZON.lerp(_spaceHorizon, f)
  scene.fog.color.copy(SKY_HORIZON)

  // Убираем тёплую дымку у горизонта (иначе на фоне чёрного космоса
  // looking-down-на-землю получит коричневый оттенок).
  HAZE_COLOR.copy(_dayHaze).multiplyScalar(1 - f)

  // --- Свет ---
  sun.intensity = sun.intensity * (1 - f) + SPC.sunIntensity * f
  hemiLight.intensity = hemiLight.intensity * (1 - f) + SPC.hemiIntensity * f

  // --- Звёзды ---
  _stars.visible = f > 0.001
  if (_stars.visible) {
    _stars.position.copy(camera.position) // сфера вокруг камеры
    _starMat.uniforms.uTime.value = time.gameTime
    _starMat.uniforms.uOpacity.value = f * SPC.stars.opacity
  }

  // --- Сферы ---
  _sphereMesh.visible = f > 0.001
  if (_sphereMesh.visible) {
    _sphereMat.uniforms.uTime.value = time.gameTime
    _sphereMat.uniforms.uOpacity.value = f * SPC.spheres.opacity

    const CS = SPC.spheres.cellSize
    const cxi = Math.floor(camera.position.x / CS)
    const cyi = Math.floor(camera.position.y / CS)
    const czi = Math.floor(camera.position.z / CS)
    if (cxi !== _lastCell.x || cyi !== _lastCell.y || czi !== _lastCell.z) {
      refillCells(camera.position.x, camera.position.y, camera.position.z)
      rebuildSphereInstances()
      _lastCell.x = cxi
      _lastCell.y = cyi
      _lastCell.z = czi
    }
  }
}

/* ---------- Debug ---------- */
export function debug() {
  return {
    factor: _factor,
    starsVisible: _stars ? _stars.visible : false,
    spheresCount: _sphereMesh ? _sphereMesh.count : 0,
  }
}
