// patch4.mjs — glow-точка над сундуками (THREE.Points), как у гемов
// Запуск: node patch4.mjs
import fs from 'node:fs'

const read = (p) => {
  const raw = fs.readFileSync(p, 'utf-8')
  const isCRLF = raw.includes('\r\n')
  return { text: raw.replace(/\r\n/g, '\n'), isCRLF }
}
const write = (p, text, isCRLF) => {
  fs.writeFileSync(p, isCRLF ? text.replace(/\n/g, '\r\n') : text, 'utf-8')
}

function replaceOrSkip(s, oldStr, newStr, label) {
  if (s.includes(newStr)) { console.log(`⏭️  ${label} — уже применено`); return s }
  if (!s.includes(oldStr)) {
    console.error(`\n❌ Не найден блок: ${label}`)
    console.error(oldStr.slice(0, 200))
    process.exit(1)
  }
  console.log(`✅ ${label}`)
  return s.replace(oldStr, newStr)
}

// ============================================================
// 1) config.js — блок glow в CHESTS
// ============================================================
{
  const { text, isCRLF } = read('scripts/config.js')
  let s = text

  const OLD = `  /** Цвет для PointLight по умолчанию (fallback). */
  glowColor: 0xffb300, // #ffb300`

  const NEW = `  /** Цвет для PointLight и glow-точки по умолчанию (fallback). */
  glowColor: 0xffb300, // #ffb300

  /**
   * Glow-точка над сундуком — THREE.Points, видна издалека.
   * Та же техника, что у гемов: шейдер с falloff + fog.
   * Цвета: CFG.CHESTS.glowColor (оранжевый) и types.forsage.glowColor (фиолетовый).
   */
  glow: {
    size: 80,
    opacity: 1,
    falloff: 1.1,
    yOffset: 3.0,
    pulseSpeed: 2.5,
    pulseAmount: 0.15,
  },`

  s = replaceOrSkip(s, OLD, NEW, 'config.js / CHESTS.glow')
  write('scripts/config.js', s, isCRLF)
}

// ============================================================
// 2) chests.js — Points + markChestGlowOpened
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/entities/chests.js')
  let s = text

  // --- 2a. Вставляем блок glow-точки сразу после _beamSlots ---
  const OLD = `const _beamSlots = []
let _beamTimeSec = 0`

  const NEW = `const _beamSlots = []
let _beamTimeSec = 0

/* ================================================================
   GLOW POINTS — THREE.Points над всеми сундуками.
   Один draw call. Цвет per-vertex (оранжевый/фиолетовый).
   Гаснет в тумане (fogNear/fogFar из scene.fog), скрывается при открытии
   (aOpened = 1 в шейдере).
================================================================ */
let _glowPoints = null
let _glowMat = null

function buildGlowPoints() {
  const N = chests.length
  if (N === 0) return

  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(N * 3)
  const col = new Float32Array(N * 3)
  const phase = new Float32Array(N)
  const opened = new Float32Array(N)
  for (let i = 0; i < N; i++) phase[i] = (i * 1.37) % 6.28

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
  geo.setAttribute('aOpened', new THREE.BufferAttribute(opened, 1))

  const G = CFG.CHESTS.glow

  _glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: G.size },
      uOpacity: { value: G.opacity },
      uFalloff: { value: G.falloff },
      uPixelRatio: { value: Math.min(devicePixelRatio, CFG.RENDERER.pixelRatioCap) },
      uTime: { value: 0 },
      uPulseSpeed: { value: G.pulseSpeed },
      uPulseAmount: { value: G.pulseAmount },
      fogNear: { value: 0 },
      fogFar: { value: 1 },
    },
    vertexShader: \`
      attribute vec3  aColor;
      attribute float aPhase;
      attribute float aOpened;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uPulseSpeed;
      uniform float uPulseAmount;
      varying vec3  vColor;
      varying float vAlpha;
      varying float vFogDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aOpened > 0.5 ? 0.0
          : uSize * uPixelRatio * (300.0 / max(1.0, -mv.z));
        vFogDepth = -mv.z;
        vAlpha = (aOpened > 0.5) ? 0.0 : 1.0;
        vAlpha *= 1.0 + uPulseAmount * sin(uTime * uPulseSpeed + aPhase);
        vColor = aColor;
      }
    \`,
    fragmentShader: \`
      uniform float uOpacity;
      uniform float uFalloff;
      uniform float fogNear;
      uniform float fogFar;
      varying vec3  vColor;
      varying float vAlpha;
      varying float vFogDepth;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float falloff = 1.0 - smoothstep(0.0, 0.5, d);
        falloff = pow(falloff, uFalloff);
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        float a = uOpacity * falloff * vAlpha * (1.0 - fogFactor);
        if (a < 0.005) discard;
        gl_FragColor = vec4(vColor, a);
      }
    \`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })

  _glowPoints = new THREE.Points(geo, _glowMat)
  _glowPoints.frustumCulled = false
  _glowPoints.renderOrder = 3
  scene.add(_glowPoints)
}

function fillGlowData() {
  if (!_glowPoints) return
  const posAttr = _glowPoints.geometry.getAttribute('position')
  const colAttr = _glowPoints.geometry.getAttribute('aColor')
  const opnAttr = _glowPoints.geometry.getAttribute('aOpened')
  const yOff = CFG.CHESTS.glow.yOffset ?? 3.0
  const tmp = new THREE.Color()

  for (let i = 0; i < chests.length; i++) {
    const c = chests[i]
    posAttr.array[i * 3 + 0] = c.x
    posAttr.array[i * 3 + 1] = terrainHeight(c.x, c.z) + yOff
    posAttr.array[i * 3 + 2] = c.z

    const override = CFG.CHESTS.types[c.type] || {}
    tmp.setHex(override.glowColor ?? CFG.CHESTS.glowColor)
    colAttr.array[i * 3 + 0] = tmp.r
    colAttr.array[i * 3 + 1] = tmp.g
    colAttr.array[i * 3 + 2] = tmp.b

    opnAttr.array[i] = c.opened ? 1 : 0
  }
  posAttr.needsUpdate = true
  colAttr.needsUpdate = true
  opnAttr.needsUpdate = true
}

function updateGlowUniforms() {
  if (!_glowMat) return
  _glowMat.uniforms.uTime.value = _beamTimeSec
  _glowMat.uniforms.fogNear.value = scene.fog.near
  _glowMat.uniforms.fogFar.value = scene.fog.far
}

export function markChestGlowOpened(chest) {
  if (!_glowPoints) return
  const idx = chests.indexOf(chest)
  if (idx < 0) return
  const opnAttr = _glowPoints.geometry.getAttribute('aOpened')
  opnAttr.array[idx] = 1
  opnAttr.needsUpdate = true
}`

  s = replaceOrSkip(s, OLD, NEW, 'chests.js / glow Points блок')

  // --- 2b. Вызов buildGlowPoints/fillGlowData в initChests ---
  const OLD2 = `    chestGroup.add(group)
    chests.push({ x, z, group, opened, type })
  }
}`
  const NEW2 = `    chestGroup.add(group)
    chests.push({ x, z, group, opened, type })
  }
  buildGlowPoints()
  fillGlowData()
}`
  s = replaceOrSkip(s, OLD2, NEW2, 'chests.js / initChests → buildGlowPoints')

  // --- 2c. resyncChests — обновляем и aOpened ---
  const OLD3 = `export function resyncChests() {
  for (const c of chests) {
    c.opened = G.openedChests.has(c.x)
    c.group.visible = !c.opened
  }
}`
  const NEW3 = `export function resyncChests() {
  for (const c of chests) {
    c.opened = G.openedChests.has(c.x)
    c.group.visible = !c.opened
  }
  if (_glowPoints) {
    const opnAttr = _glowPoints.geometry.getAttribute('aOpened')
    for (let i = 0; i < chests.length; i++) {
      opnAttr.array[i] = chests[i].opened ? 1 : 0
    }
    opnAttr.needsUpdate = true
  }
}`
  s = replaceOrSkip(s, OLD3, NEW3, 'chests.js / resyncChests → aOpened')

  // --- 2d. updateChests — обновляем uniforms ---
  const OLD4 = `export function updateChests(dt, rx, rz) {
  _beamTimeSec += dt
  updateBeams(rx, rz)
  updateChestLights(dt, rx, rz)
}`
  const NEW4 = `export function updateChests(dt, rx, rz) {
  _beamTimeSec += dt
  updateBeams(rx, rz)
  updateChestLights(dt, rx, rz)
  updateGlowUniforms()
}`
  s = replaceOrSkip(s, OLD4, NEW4, 'chests.js / updateChests → updateGlowUniforms')

  write('scripts/views/entities/chests.js', s, isCRLF)
}

// ============================================================
// 3) entities/index.js — экспорт markChestGlowOpened
// ============================================================
{
  const { text, isCRLF } = read('scripts/views/entities/index.js')
  let s = text

  const OLD = `export { chestGroup, chests, initChests, resyncChests, updateChests } from './chests.js'`
  const NEW = `export {
  chestGroup,
  chests,
  initChests,
  resyncChests,
  updateChests,
  markChestGlowOpened,
} from './chests.js'`
  s = replaceOrSkip(s, OLD, NEW, 'entities/index.js / export markChestGlowOpened')
  write('scripts/views/entities/index.js', s, isCRLF)
}

// ============================================================
// 4) game.js — вызов при открытии сундука
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/game.js')
  let s = text

  // --- 4a. Импорт ---
  const OLD = `import {
  rocket,
  chests,
  updateChests as updateChestsFX,
  updateGems as updateGemsFX,
  updateGhostRocket,
} from '../views/entities/index.js'`
  const NEW = `import {
  rocket,
  chests,
  updateChests as updateChestsFX,
  updateGems as updateGemsFX,
  updateGhostRocket,
  markChestGlowOpened,
} from '../views/entities/index.js'`
  s = replaceOrSkip(s, OLD, NEW, 'game.js / import markChestGlowOpened')

  // --- 4b. Вызов в openChest ---
  const OLD2 = `function openChest(chest) {
  chest.opened = true
  G.openedChests.add(chest.x)
  chest.group.visible = false
  Achievements.onChestOpen(G.openedChests.size)`
  const NEW2 = `function openChest(chest) {
  chest.opened = true
  G.openedChests.add(chest.x)
  chest.group.visible = false
  markChestGlowOpened(chest)
  Achievements.onChestOpen(G.openedChests.size)`
  s = replaceOrSkip(s, OLD2, NEW2, 'game.js / openChest → markChestGlowOpened')

  write('scripts/core/game.js', s, isCRLF)
}

console.log('\n🎉 Готово. Перезапусти npm run dev и проверь.')