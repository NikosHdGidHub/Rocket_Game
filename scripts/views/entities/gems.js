/* ================================================================
   gems.js — гемы: октаэдры + glow на Points + пул PointLight.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../../config.js'
import { scene } from '../scene.js'
import { G, rocketState } from '../../state.js'
import { terrainHeight, hash2i } from '../../world/world.js'

export const gemGroup = new THREE.Group()
scene.add(gemGroup)

/** @type {{ id:number, index:number, x:number, z:number, baseY:number, group:THREE.Group, mesh:any, collected:boolean }[]} */
export const gems = []

/* ---------- Кристалл ---------- */
const _gemCoreGeo = new THREE.OctahedronGeometry(CFG.GEMS.size, 0)
const _gemCoreMat = new THREE.MeshStandardMaterial({
  color: CFG.GEMS.colors.core,
  emissive: CFG.GEMS.colors.emissive,
  emissiveIntensity: 1.5,
  roughness: 0.2,
  metalness: 0.6,
  flatShading: true,
})

/* ---------- Glow (Points, как у звёзд) ---------- */
let _glowPoints = null
let _glowMat = null

function buildGlowPoints() {
  const N = CFG.GEMS.xPositions.length
  const geo = new THREE.BufferGeometry()
  const pos = new Float32Array(N * 3)
  const phase = new Float32Array(N)
  const collected = new Float32Array(N)
  for (let i = 0; i < N; i++) phase[i] = (i * 1.37) % 6.28

  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
  geo.setAttribute('aCollected', new THREE.BufferAttribute(collected, 1))

  _glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(CFG.GEMS.glow.color) },
      uSize: { value: CFG.GEMS.glow.size },
      uOpacity: { value: CFG.GEMS.glow.opacity },
      uFalloff: { value: CFG.GEMS.glow.falloff },
      uPixelRatio: { value: Math.min(devicePixelRatio, CFG.RENDERER.pixelRatioCap) },
      uTime: { value: 0 },
      uBobHeight: { value: CFG.GEMS.bobHeight },
      uBobSpeed: { value: CFG.GEMS.bobSpeed },
      uPulseSpeed: { value: CFG.GEMS.pulseSpeed },
      fogColor: { value: new THREE.Color() },
      fogNear: { value: 0 },
      fogFar: { value: 1 },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aCollected;
      uniform float uSize;
      uniform float uPixelRatio;
      uniform float uTime;
      uniform float uBobHeight;
      uniform float uBobSpeed;
      uniform float uPulseSpeed;
      varying float vAlpha;
      varying float vFogDepth;
      varying float vPulse;
      void main() {
        vec3 p = position;
        p.y += sin(uTime * uBobSpeed + aPhase) * uBobHeight;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aCollected > 0.5 ? 0.0
          : uSize * uPixelRatio * (300.0 / max(1.0, -mv.z));
        vFogDepth = -mv.z;
        vAlpha = aCollected > 0.5 ? 0.0 : 1.0;
        vPulse = 0.85 + sin(uTime * uPulseSpeed + aPhase) * 0.15;
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uFalloff;
      uniform float fogNear;
      uniform float fogFar;
      varying float vAlpha;
      varying float vFogDepth;
      varying float vPulse;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float d = length(uv);
        if (d > 0.5) discard;
        float falloff = 1.0 - smoothstep(0.0, 0.5, d);
        falloff = pow(falloff, uFalloff);
        float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
        float a = uOpacity * falloff * vPulse * vAlpha * (1.0 - fogFactor);
        if (a < 0.005) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
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

/* ---------- Пул PointLight'ов ---------- */
const _gemLightPool = []

function initGemLights() {
  const L = CFG.GEMS.lights
  for (let i = 0; i < L.count; i++) {
    const light = new THREE.PointLight(L.color, 0, L.range, 1)
    scene.add(light)
    _gemLightPool.push(light)
  }
}

/* ---------- Детерминированные позиции от seed ---------- */
function gemX(x) {
  const r = (hash2i(x, 0x9c1f) & 0xffff) / 0xffff
  return x + (r * 2 - 1) * CFG.GEMS.xPosDif
}
function gemZ(x) {
  const yaw = CFG.GAME.flightYaw || 0
  const r = (hash2i(x, 0x4e2d) & 0xffff) / 0xffff
  return x * Math.tan(yaw) + r * 2.0 * CFG.GEMS.zOffset - CFG.GEMS.zOffset
}
function gemYOffset(x) {
  const r = (hash2i(x, 0x2b8e) & 0xffff) / 0xffff
  return (r * 2 - 1) * CFG.GEMS.yPosDif
}

function buildGemMesh(x, y, z) {
  const g = new THREE.Group()
  const mesh = new THREE.Mesh(_gemCoreGeo, _gemCoreMat)
  g.add(mesh)
  g.position.set(x, y, z)
  return { group: g, mesh }
}

export function initGems() {
  buildGlowPoints()
  initGemLights()

  const posAttr = _glowPoints.geometry.getAttribute('position')
  const colAttr = _glowPoints.geometry.getAttribute('aCollected')
  const posArr = posAttr.array
  const colArr = colAttr.array

  let i = 0
  for (const x of CFG.GEMS.xPositions) {
    const gx = gemX(x)
    const gz = gemZ(x)
    const gy = terrainHeight(gx, gz) + CFG.GEMS.yOffset + gemYOffset(x)
    const collected = G.collectedGems.has(x)

    const { group, mesh } = buildGemMesh(gx, gy, gz)
    group.visible = !collected
    gemGroup.add(group)

    gems.push({ id: x, index: i, x: gx, z: gz, baseY: gy, group, mesh, collected })

    posArr[i * 3] = gx
    posArr[i * 3 + 1] = gy
    posArr[i * 3 + 2] = gz
    colArr[i] = collected ? 1 : 0
    i++
  }

  posAttr.needsUpdate = true
  colAttr.needsUpdate = true
}

export function resyncGems() {
  if (!_glowPoints) return
  const colAttr = _glowPoints.geometry.getAttribute('aCollected')
  const colArr = colAttr.array
  for (const gem of gems) {
    gem.collected = G.collectedGems.has(gem.id)
    gem.group.visible = !gem.collected
    colArr[gem.index] = gem.collected ? 1 : 0
  }
  colAttr.needsUpdate = true
}

export function markGemCollected(gem) {
  if (!_glowPoints) return
  const colAttr = _glowPoints.geometry.getAttribute('aCollected')
  colAttr.array[gem.index] = 1
  colAttr.needsUpdate = true
}

export function updateGems(dt) {
  const t = performance.now() * 0.001
  const G_CFG = CFG.GEMS

  for (const gem of gems) {
    if (gem.collected) continue
    gem.mesh.rotation.y = t * G_CFG.rotateSpeed
    gem.mesh.rotation.x = t * G_CFG.rotateSpeed * 0.3
    const bob = Math.sin(t * G_CFG.bobSpeed + gem.id * 0.7) * G_CFG.bobHeight
    gem.group.position.y = gem.baseY + bob
  }

  if (_glowMat) {
    _glowMat.uniforms.uTime.value = t
    _glowMat.uniforms.fogColor.value.copy(scene.fog.color)
    _glowMat.uniforms.fogNear.value = scene.fog.near
    _glowMat.uniforms.fogFar.value = scene.fog.far
  }

  if (_gemLightPool.length > 0) updateGemLights(dt)
}

function updateGemLights(dt) {
  const L = CFG.GEMS.lights
  const rx = rocketState.pos.x
  const ry = rocketState.pos.y
  const rz = rocketState.pos.z

  const candidates = []
  for (const gem of gems) {
    if (gem.collected) continue
    const dx = rx - gem.x
    const dy = ry - gem.baseY
    const dz = rz - gem.z
    candidates.push({ gem, d2: dx * dx + dy * dy + dz * dz })
  }
  candidates.sort((a, b) => a.d2 - b.d2)

  const k = 1 - Math.exp(-L.fadeSpeed * dt)

  for (let i = 0; i < _gemLightPool.length; i++) {
    const light = _gemLightPool[i]
    const cand = candidates[i]

    if (!cand) {
      light.intensity += (0 - light.intensity) * k
      continue
    }

    const gem = cand.gem
    light.position.set(gem.x, gem.baseY, gem.z)
    light.intensity += (L.intensity - light.intensity) * k
  }
}
