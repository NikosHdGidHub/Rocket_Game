/* ================================================================
   scene.js — рендерер, сцена, камера, небо, свет, туман,
   материал земли.

   Экспортирует applySkyFog() — его навешивают все «земные»
   и «лесные» материалы, чтобы туман совпадал с небом.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import { rocketState } from '../state.js'
import { makeGroundTexture, GROUND_TILE } from '../world/world.js'

/* ---------- Мутабельные экспорты (заполняются в init) ---------- */
export let renderer
export let camera
export let sun
export let skyDome
export let groundTex
export let groundMat
export let hemiLight

/* ---------- Создаём сразу на этапе загрузки модуля ----------
   Эти объекты используют в top-level коде другие модули
   (entities.js → scene.add, lod.js → map/applySkyFog).
   Если их создавать в init() — top-level код упадёт с undefined. */
export const SKY_ZENITH = new THREE.Color(CFG.SKY.zenith)
export const SKY_HORIZON = new THREE.Color(CFG.SKY.horizon)
export const SUN_COLOR = new THREE.Color(CFG.SKY.sun)
export const HAZE_COLOR = new THREE.Vector3(...CFG.SKY.hazeColor)
export const SUN_DIR = new THREE.Vector3(...CFG.SKY.sunDir).normalize()

export const scene = new THREE.Scene()
scene.fog = new THREE.Fog(CFG.SKY.horizon, CFG.FOG.initialNear, CFG.FOG.initialFar)

/** Метров на один повтор текстуры земли. */
export const TILE = GROUND_TILE

/* ---------- Elliptical fog uniforms ----------
   Один набор uniform-объектов, разделяемый всеми материалами через
   applySkyFog. Обновляется каждый кадр в lod.update().
*/
export const fogU = {
  center: { value: new THREE.Vector2(0, 0) },
  dir: { value: new THREE.Vector2(1, 0) },
  shapeSide: { value: CFG.FOG.ellipseSide },
  shapeBack: { value: CFG.FOG.ellipseBack },
}

/* ================================================================
   applySkyFog — навешивает на материал:
     1) sky-matching цвет тумана (совпадает с шейдером неба),
     2) эллиптическую форму тумана (вытянут вдоль полёта).
================================================================ */
export function applySkyFog(mat, customPreInject = null) {
  mat.onBeforeCompile = (shader) => {
    if (customPreInject) customPreInject(shader)

    // --- Sky-matching ---
    shader.uniforms.skyTop = { value: SKY_ZENITH }
    shader.uniforms.skyBottom = { value: SKY_HORIZON }
    shader.uniforms.skyExponent = { value: CFG.SKY.exponent }
    shader.uniforms.sunColorF = { value: SUN_COLOR }
    shader.uniforms.sunDirF = { value: SUN_DIR }
    shader.uniforms.hazeColorF = { value: HAZE_COLOR }
    shader.uniforms.hazePowF = { value: CFG.SKY.hazePow }
    shader.uniforms.glowPowF = { value: CFG.SKY.glowPow }
    shader.uniforms.glowAmtF = { value: CFG.SKY.glowAmt }
    shader.uniforms.corePowF = { value: CFG.SKY.corePow }
    shader.uniforms.coreAmtF = { value: CFG.SKY.coreAmt }

    // --- Elliptical fog — общие uniform-объекты ---
    shader.uniforms.fogCenter = fogU.center
    shader.uniforms.fogDirU = fogU.dir
    shader.uniforms.fogShapeSide = fogU.shapeSide
    shader.uniforms.fogShapeBack = fogU.shapeBack

    // --- Вершинный: мировая позиция ---
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

    // --- Фрагментный: функция неба + новые uniform-ы ---
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

    // --- Фрагментный: эллиптический туман ---
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      `#ifdef USE_FOG
         vec2  toFrag = vSkyWorldPos.xz - fogCenter;
         float along  = dot(toFrag, fogDirU);
         float across = abs(dot(toFrag, vec2(-fogDirU.y, fogDirU.x)));
         float rAlong = along >= 0.0 ? 1.0 : fogShapeBack;
         vec2  p      = vec2(along / rAlong, across / fogShapeSide);
         float eDist  = length(p);

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
   init — создаёт всё, что нужно для рендера.
   Вызывается первым, ДО чанков/сущностей.
================================================================ */
export function init() {
  /* ---------- Renderer ---------- */
  renderer = new THREE.WebGLRenderer({ antialias: CFG.RENDERER.antialias })
  renderer.setPixelRatio(Math.min(devicePixelRatio, CFG.RENDERER.pixelRatioCap))
  renderer.setSize(innerWidth, innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = CFG.RENDERER.toneMappingExposure
  renderer.shadowMap.enabled = CFG.LIGHTS.shadow.enabled
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  document.body.appendChild(renderer.domElement)

  /* ---------- Camera ---------- */
  camera = new THREE.PerspectiveCamera(
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

  /* ---------- Sky-dome (шейдер) ---------- */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: SKY_ZENITH },
      bottomColor: { value: SKY_HORIZON },
      sunColor: { value: SUN_COLOR },
      sunDir: { value: SUN_DIR },
      exponent: { value: CFG.SKY.exponent },
      hazeColor: { value: HAZE_COLOR },
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

  skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(CFG.SKY.domeRadius, CFG.SKY.domeSegW, CFG.SKY.domeSegH),
    skyMat
  )
  skyDome.frustumCulled = false
  skyDome.renderOrder = -1
  scene.add(skyDome)

  /* ---------- Lights ---------- */
  hemiLight = new THREE.HemisphereLight(
    CFG.LIGHTS.hemiSky,
    CFG.LIGHTS.hemiGround,
    CFG.LIGHTS.hemiIntensity
  )
  scene.add(hemiLight)

  sun = new THREE.DirectionalLight(CFG.LIGHTS.sunColor, CFG.LIGHTS.sunIntensity)
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
  sun.shadow.normalBias = CFG.LIGHTS.shadow.normalBias
  scene.add(sun)
  scene.add(sun.target)

  /* ---------- Ground ---------- */
  groundTex = makeGroundTexture(renderer.capabilities.getMaxAnisotropy())
  groundMat = new THREE.MeshStandardMaterial({
    map: groundTex,
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  })
  applySkyFog(groundMat)
}

/* ================================================================
   updateScenery — солнце и купол следуют за камерой.
================================================================ */
export function updateScenery() {
  const tx = rocketState.pos.x
  const ty = rocketState.pos.y
  const tz = rocketState.pos.z
  const R = 60
  const yDir = Math.max(SUN_DIR.y, 0.2)
  sun.position.set(tx + SUN_DIR.x * R, ty + yDir * R, tz + SUN_DIR.z * R)
  sun.target.position.set(tx, ty, tz)
  sun.target.updateMatrixWorld()
  skyDome.position.copy(camera.position)
}

/* ================================================================
   render — один кадр.
================================================================ */
export function render() {
  renderer.render(scene, camera)
}
