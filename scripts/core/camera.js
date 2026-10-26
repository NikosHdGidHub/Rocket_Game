/* ================================================================
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
