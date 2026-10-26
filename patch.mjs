// patch3.mjs — fixed-step camera smoothing + render interpolation
// Запуск: node patch3.mjs
import fs from 'node:fs'

const read = (p) => {
  const raw = fs.readFileSync(p, 'utf-8')
  const isCRLF = raw.includes('\r\n')
  return { text: raw.replace(/\r\n/g, '\n'), isCRLF }
}
const write = (p, text, isCRLF) =>
  fs.writeFileSync(p, isCRLF ? text.replace(/\n/g, '\r\n') : text, 'utf-8')

function replaceOrSkip(s, oldStr, newStr, label) {
  if (s.includes(newStr)) {
    console.log(`⏭️  ${label} — уже применено`)
    return s
  }
  if (!s.includes(oldStr)) {
    console.error(`\n❌ Не найден блок: ${label}`)
    console.error('Искали (первые 400):')
    console.error(oldStr.slice(0, 400))
    process.exit(1)
  }
  console.log(`✅ ${label}`)
  return s.replace(oldStr, newStr)
}

// ============================================================
// 1) state.js — добавляем поля для fixed-step камеры
// ============================================================
{
  const { text, isCRLF } = read('scripts/state.js')
  let s = text

  const OLD = `/** Камера (сглаженные значения + цель). */
export const cam = {
  blend: 0, // 0 = сбоку, 1 = сзади
  shake: 0, // амплитуда тряски
  look: new THREE.Vector3(0, 3, 0),
  target: new THREE.Vector3(), // куда стремится (для prekick-детекта)
}`

  const NEW = `/** Камера (сглаженные значения + цель). */
export const cam = {
  blend: 0, // 0 = сбоку, 1 = сзади
  shake: 0, // амплитуда тряски
  look: new THREE.Vector3(0, 3, 0), // текущий сглаженный look (последний physics-тик)
  target: new THREE.Vector3(), // куда стремится (для prekick-детекта)

  // --- FIX: fixed-step smoothing + render interpolation ---
  // Сглаживание камеры выполняется в физическом шаге (120 Гц),
  // а на рендере позиция интерполируется по тому же alpha, что и ракета.
  // Старое поведение (углы, скорости, blend, shake) сохранено полностью.
  pos: new THREE.Vector3(), // сглаженная позиция камеры (текущий physics-тик)
  prevPos: new THREE.Vector3(), // позиция на предыдущем physics-тике
  prevLook: new THREE.Vector3(0, 3, 0), // look на предыдущем physics-тике
  inited: false,
}`

  s = replaceOrSkip(s, OLD, NEW, 'state.js / cam fixed-step fields')
  write('scripts/state.js', s, isCRLF)
}

// ============================================================
// 2) camera.js — полностью переписываем под fixed-step + interpolate
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/camera.js')

  const NEW_CAMERA = `/* ================================================================
   camera.js — следование камеры за ракетой.

   FIX джиттера при просадках FPS:
   — Сглаживание камеры вынесено в ФИКСИРОВАННЫЙ шаг физики (120 Гц).
     Раньше s = 1 - exp(-follow * realDt) зависел от времени кадра:
     при просадке FPS realDt «гулял» → камера то отставала, то догоняла
     по-разному на каждом кадре → ракета дёргалась ОТНОСИТЕЛЬНО камеры.
   — На рендере позиция/look камеры интерполируются по тому же alpha,
     что и ракета. Камера и ракета теперь всегда идут синхронно.

   Старое поведение камеры (углы от высоты, отъезд по скорости,
   leadTime, followBase/followSpeedK/followMaxSpeed, blend, shake)
   сохранено полностью — изменилось только ВРЕМЯ применения.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import { G, cam, rocketState } from '../state.js'
import { camera } from '../views/scene.js'
import { terrainHeight } from '../world/world.js'

const _tmpLook = new THREE.Vector3()

/* ================================================================
   PHYSICS STEP — вызывать из Game.updatePhysics (фикс. dt)
================================================================ */
export function updateCameraPhysics(dt) {
  if (!cam.inited) {
    cam.pos.copy(camera.position)
    cam.prevPos.copy(camera.position)
    cam.inited = true
  }

  const pos = rocketState.pos
  const vel = rocketState.vel

  const gY = terrainHeight(pos.x, 0)
  const speed = vel.length()

  const wantBehind = G.phase === 'fly' ? 1 : 0
  const blendSpeed = wantBehind > cam.blend ? CFG.CAMERA.blendIn : CFG.CAMERA.blendOut
  cam.blend += (wantBehind - cam.blend) * Math.min(1, dt * blendSpeed)
  if (cam.blend < 0.001) cam.blend = 0
  if (cam.blend > 0.999) cam.blend = 1

  const alt = Math.max(0, pos.y - gY)
  const altT = Math.min(1, alt / CFG.CAMERA.maxViewHeight)
  const range = CFG.CAMERA.maxAngle - CFG.CAMERA.baseAngle
  const elev = ((CFG.CAMERA.baseAngle + range * altT) * Math.PI) / 180

  const R =
    CFG.CAMERA.baseRadius + Math.min(CFG.CAMERA.maxSpeedRadius, speed * CFG.CAMERA.speedRadiusK)
  const hDist = R * Math.cos(elev)
  const vDist = R * Math.sin(elev)

  const lead = CFG.CAMERA.leadTime
  const px = pos.x + vel.x * lead
  const py = pos.y + vel.y * lead
  const pz = pos.z + vel.z * lead

  const camX = px - hDist * cam.blend
  const camY = py + vDist
  const camZ = pz + hDist * (1 - cam.blend)

  cam.target.set(camX, camY, camZ)

  const follow =
    CFG.CAMERA.followBase + Math.min(CFG.CAMERA.followMaxSpeed, speed * CFG.CAMERA.followSpeedK)
  // dt здесь ФИКСИРОВАННЫЙ (= FIXED_DT физики) — коэффициент сглаживания
  // больше не зависит от времени кадра. Именно это убирает джиттер.
  const s = 1 - Math.exp(-follow * dt)

  // Сохраняем предыдущее состояние для интерполяции на рендере
  cam.prevPos.copy(cam.pos)
  cam.pos.x += (camX - cam.pos.x) * s
  cam.pos.y += (camY - cam.pos.y) * s
  cam.pos.z += (camZ - cam.pos.z) * s

  const lookAhead =
    (CFG.CAMERA.lookAheadBase + CFG.CAMERA.lookAheadBehind * cam.blend) *
    (1 - altT * CFG.CAMERA.lookAheadAltK)
  const lookX = px + lookAhead
  const lookY = py

  cam.prevLook.copy(cam.look)
  cam.look.x += (lookX - cam.look.x) * s
  cam.look.y += (lookY - cam.look.y) * s
  cam.look.z += (pz - cam.look.z) * s

  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * CFG.CAMERA.shakeDecayK)
  }
}

/* ================================================================
   VISUAL — вызывать из Game.updateVisuals (раз в кадр, с alpha)
================================================================ */
export function updateCameraVisual(alpha) {
  camera.position.lerpVectors(cam.prevPos, cam.pos, alpha)
  _tmpLook.lerpVectors(cam.prevLook, cam.look, alpha)

  if (cam.shake > 0) {
    const a = cam.shake * cam.shake * CFG.CAMERA.shakeAmpK
    camera.position.x += (Math.random() - 0.5) * a
    camera.position.y += (Math.random() - 0.5) * a
  }

  camera.lookAt(_tmpLook)
}
`

  if (text === NEW_CAMERA) {
    console.log('⏭️  camera.js — уже применено')
  } else {
    write('scripts/core/camera.js', NEW_CAMERA, isCRLF)
    console.log('✅ camera.js / fixed-step + interpolation')
  }
}

// ============================================================
// 3) game.js — переключаем вызовы
// ============================================================
{
  const { text, isCRLF } = read('scripts/core/game.js')
  let s = text

  s = replaceOrSkip(
    s,
    `import { updateCamera } from './camera.js'`,
    `import { updateCameraPhysics, updateCameraVisual } from './camera.js'`,
    'game.js / import camera'
  )

  s = replaceOrSkip(
    s,
    `export function updatePhysics(dt) {
  Abilities.update(dt)
  updateBossPhase(dt)
  updateRocketPhysics(dt)
  checkGemPickup()
}`,
    `export function updatePhysics(dt) {
  Abilities.update(dt)
  updateBossPhase(dt)
  updateRocketPhysics(dt)
  // FIX: камера сглаживается в ФИКСИРОВАННОМ шаге — теперь не зависит от FPS.
  updateCameraPhysics(dt)
  checkGemPickup()
}`,
    'game.js / updatePhysics + camera physics'
  )

  s = replaceOrSkip(
    s,
    `  updateRocketVisuals(dt, _irotZ, _ipos, _ivel)
  updateCamera(dt, _ipos, _ivel)`,
    `  updateRocketVisuals(dt, _irotZ, _ipos, _ivel)
  // FIX: интерполируем позицию/look камеры по тому же alpha, что и ракету.
  updateCameraVisual(alpha)`,
    'game.js / updateVisuals + camera visual'
  )

  write('scripts/core/game.js', s, isCRLF)
}

console.log('\\n🎉 Готово.')
console.log('   Что изменилось:')
console.log('   • Сглаживание камеры теперь идёт в фиксированном шаге 120 Гц')
console.log('   • На рендере камера интерполируется по alpha (как ракета)')
console.log('   • Все старые параметры (leadTime, followBase, followSpeedK,')
console.log('     followMaxSpeed, blend, shake) сохранены — изменилось')
console.log('     только ВРЕМЯ применения.')
console.log('   Проверь:')
console.log('   1. Просадка до 20–30 FPS → ракета плавно в центре кадра.')
console.log('   2. Посадка → тряска работает как раньше.')
console.log('   3. Прекик → камера подъезжает сбоку и ждёт 0.3 с (как было).')
