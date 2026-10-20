/* ================================================================
   game.js — игровая логика: физика полёта, камера, босс,
   сохранения, старт/посадка, апгрейды.
================================================================ */
import * as THREE from 'three'
import * as CFG from './config.js'
import * as Achievements from './achievements.js'
import * as DayNight from './daynight.js'
import { camera } from './scene.js'
import { terrainHeight } from './world/world.js'
import { G, rocketState, cam, input, lod, time, ghostRecorder, bestFlight } from './state.js'
import * as Abilities from './abilities.js'
import {
  rocket,
  flame,
  flameInner,
  flameMat,
  exhaustLight,
  boss,
  torso,
  head,
  legKick,
  legBack,
  chests,
  updateChests as updateChestsFX,
  updateGhostRocket,
} from './entities.js'
import * as UI from './ui.js'

/* ---------- Физические константы ---------- */
const GRAVITY = CFG.GAME.gravity
const REST_Y = CFG.GAME.restY
const LAUNCH_ANGLE = CFG.GAME.launchAngle
const ANG_ACC = CFG.GAME.angAcc
const ANG_DAMP = CFG.GAME.angDamp
const ANG_MAX = CFG.GAME.angMax

let boosting = false

/* ================================================================
   Формулы с учётом карточек
================================================================ */
export const UPGRADES = CFG.UPGRADES
export const costOf = (u) => CFG.RULES.upgradeCost(u, G.upgrades[u.key])

export const cardMul = (key) => {
  const n = G.cards[key] || 0
  if (n === 0) return 1
  const card = CFG.CARDS.find((c) => c.key === key)
  return card && typeof card.buff === 'number' ? Math.pow(card.buff, n) : 1
}

export const launchSpeed = () => CFG.RULES.launchSpeed(G.upgrades) * cardMul('power2x')
export const maxFuel = () => CFG.RULES.maxFuel(G.upgrades) * cardMul('fuel2x')
export const thrustAcc = () => CFG.RULES.thrustAcc(G.upgrades) * cardMul('thrust2x')
export const dragCoefAtAngle = (a) => CFG.RULES.dragCoefAtAngle(G.upgrades, a) * cardMul('aero2x')
export const airDensity = (y) => CFG.RULES.airDensity(y)
export const gravityMul = () => cardMul('airtime')

/* ================================================================
   SAVE / LOAD
================================================================ */
export function saveProgress() {
  if (!CFG.SAVE.autoSave) return
  try {
    const data = {
      v: CFG.SAVE.version,
      coins: G.coins,
      best: G.best,
      upgrades: { ...G.upgrades },
      cards: { ...G.cards },
      openedChests: [...G.openedChests],
      achievements: Achievements.serialize(),
      totalPlaytime: time.totalPlaytime + time.gameTime,
    }
    localStorage.setItem(CFG.SAVE.key, JSON.stringify(data))
  } catch (e) {
    console.warn('saveProgress failed:', e)
  }
}

export function loadProgress() {
  try {
    const raw = localStorage.getItem(CFG.SAVE.key)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return

    if (typeof data.coins === 'number' && isFinite(data.coins) && data.coins >= 0) {
      G.coins = Math.floor(data.coins)
    }
    if (typeof data.best === 'number' && isFinite(data.best) && data.best >= 0) {
      G.best = data.best
    }
    if (
      typeof data.totalPlaytime === 'number' &&
      isFinite(data.totalPlaytime) &&
      data.totalPlaytime >= 0
    ) {
      time.totalPlaytime = data.totalPlaytime
    }
    if (data.upgrades && typeof data.upgrades === 'object') {
      for (const key of Object.keys(CFG.GAME.initialUpgrades)) {
        const v = data.upgrades[key]
        if (typeof v === 'number' && isFinite(v) && v >= 1) {
          const uCfg = CFG.UPGRADES.find((u) => u.key === key)
          const max = uCfg?.maxLevel ?? Infinity
          G.upgrades[key] = Math.min(Math.floor(v), max) // ← clamp
        }
      }
    }
    if (data.cards && typeof data.cards === 'object') {
      for (const c of CFG.CARDS) {
        const v = data.cards[c.key]
        if (typeof v === 'number' && isFinite(v) && v >= 0) {
          G.cards[c.key] = Math.floor(v)
        }
      }
    }
    if (Array.isArray(data.openedChests)) {
      for (const x of data.openedChests) {
        if (typeof x === 'number' && isFinite(x)) G.openedChests.add(x)
      }
    }
    Achievements.deserialize(data.achievements)
  } catch (e) {
    console.warn('loadProgress failed:', e)
  }
}

export function resetProgress() {
  const ok = confirm(
    'Сбросить весь прогресс? Монеты, рекорд и апгрейды будут потеряны.\n' + 'Игра перезапустится.'
  )
  if (!ok) return

  // 1) Чистим сохранение в localStorage.
  try {
    localStorage.removeItem(CFG.SAVE.key)
    // Призрак — отдельный ключ, чистим явно.
    localStorage.removeItem(CFG.ROCKET.ghost.storageKey)
  } catch (e) {
    console.warn('resetProgress: не удалось очистить localStorage:', e)
  }
  // DayNight.reset() сам ставит _suppressSave — иначе pagehide
  // перед reload тут же запишет ключ обратно.
  DayNight.reset()

  // 2) Короткий фидбэк — пользователь видит, что кнопка сработала.
  UI.showToast('Прогресс сброшен 🗑️', '#ff7a7a')

  // 3) Перезагружаем страницу. Весь стейт (G, чанки, сундуки, камера, LOD)
  //    пересоздастся с нуля тем же путём, что и при первом запуске —
  //    никаких «залипших» флагов после сброса.
  setTimeout(() => location.reload(), 500)
}

/* ================================================================
   Апгрейды
================================================================ */
export function buy(u) {
  const lvl = G.upgrades[u.key]
  const max = u.maxLevel ?? Infinity
  if (lvl >= max) return // ← потолок
  const cost = costOf(u)
  if (G.coins < cost) return
  G.coins -= cost
  G.upgrades[u.key]++
  UI.updateHUD()
  UI.renderShop()
  UI.showToast(`${u.icon} Lv.${G.upgrades[u.key]}`, CFG.UI.toastColors.upgrade)
  saveProgress()
  Achievements.onBuy()
}

/* ================================================================
   Старт / посадка
================================================================ */
export function startKick() {
  if (G.phase !== 'ready' && G.phase !== 'landed') return
  resetRocket()
  G.phase = 'prekick'
  G.timer = 0
  cam.blend = 0 // мгновенно сбрасываем — камера быстро поедет к старту
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
  Abilities.reset() // сброс способности
}

function launch() {
  const speed = launchSpeed()
  const yaw = CFG.GAME.flightYaw || 0
  const horiz = Math.cos(LAUNCH_ANGLE) * speed
  rocketState.vel.set(Math.cos(yaw) * horiz, Math.sin(LAUNCH_ANGLE) * speed, Math.sin(yaw) * horiz)
  rocket.rotation.z = LAUNCH_ANGLE
  rocket.rotation.y = -yaw
  rocketState.angVel = 0
  G.phase = 'fly'
  G.timer = 0
  boosting = false
  startGhostRecording() // ← запись
  UI.showToast('ПОЛЕТЕЛИ! 🚀', CFG.UI.toastColors.upgrade)
  Achievements.onLaunch()
  saveProgress()
}

function land() {
  G.phase = 'landed'

  // Снимок состояния ДО обнуления — для достижений
  const speedAtTouchdown = rocketState.vel.length()
  const landedX = rocketState.pos.x
  const landedZ = rocketState.pos.z
  const groundY = terrainHeight(landedX, landedZ)

  // Сундуки: ближайший + открытие в радиусе
  let nearestChestDist = Infinity
  for (const c of chests) {
    if (c.opened) continue // ← не учитываем уже взятые
    const dx = landedX - c.x
    const dz = landedZ - c.z
    const d2 = dx * dx + dz * dz
    const d = Math.sqrt(d2)
    if (d < nearestChestDist) nearestChestDist = d
    if (!c.opened && d2 <= CFG.CHESTS.pickupRadius * CFG.CHESTS.pickupRadius) {
      openChest(c)
    }
  }
  if (!isFinite(nearestChestDist)) nearestChestDist = null

  G.timer = 0
  rocketState.angVel = 0
  rocketState.pos.y = groundY + REST_Y
  rocketState.vel.set(0, 0, 0)

  const dist = Math.max(0, rocketState.pos.x)
  const earned = Math.max(1, Math.floor(dist))
  G.lastDist = dist
  G.coins += earned
  const isRecord = dist > G.best // ← снимок ДО мутации
  if (isRecord) G.best = dist

  if (isRecord && ghostRecorder.samples.length >= CFG.ROCKET.minSamplesLimit) {
    saveGhostFlight()
  }
  ghostRecorder.recording = false

  UI.updateHUD()
  UI.renderShop()
  saveProgress()

  UI.showLandToast(dist, isRecord)

  cam.shake = CFG.CAMERA.shakeOnLand

  // Достижения — после обновления состояния
  Achievements.onLand({
    dist,
    altitude: groundY,
    speed: speedAtTouchdown,
    nearestChestDist,
  })

  // после посадки способность снова готова
  Abilities.reset()
}

function pickCard() {
  const limit = CFG.CHESTS.cardTypeLimit
  // Обычные карточки. forsage выдаётся ТОЛЬКО из специальных сундуков
  // (specialChests), поэтому из рандомного пула её исключаем.
  const allowed = CFG.CARDS.filter((c) => c.key !== 'forsage' && (G.cards[c.key] || 0) < limit)
  if (allowed.length === 0) return null
  return allowed[Math.floor(Math.random() * allowed.length)]
}

function pickForsageCard() {
  const card = CFG.CARDS.find((c) => c.key === 'forsage')
  if (!card) return pickCard() // страховка
  const maxLv = CFG.ABILITIES.forsage.levels.length
  if ((G.cards.forsage || 0) >= maxLv) return pickCard() // fallback — уже прокачано
  return card
}

function openChest(chest) {
  chest.opened = true
  G.openedChests.add(chest.x)
  chest.group.visible = false

  const card = chest.type === 'forsage' ? pickForsageCard() : pickCard()
  if (card) {
    // «Апгрейд» = у игрока уже была хотя бы одна такая карточка.
    const isUpgrade = (G.cards[card.key] || 0) >= 1
    G.cards[card.key] = (G.cards[card.key] || 0) + 1
    UI.showCardPopup(card, isUpgrade)
    Abilities.onCardObtained(card.key)
  } else {
    UI.showToast('Все карточки собраны! 🎉', CFG.UI.toastColors.upgrade)
  }

  saveProgress()
  Achievements.onChestOpen(G.openedChests.size)
}

/* ================================================================
   GHOST RECORDER — запись текущего полёта.
================================================================ */
function startGhostRecording() {
  ghostRecorder.samples.length = 0
  ghostRecorder.recording = true
  ghostRecorder.startTime = time.gameTime
  ghostRecorder.nextSampleTime = 0
}

function recordGhostSample() {
  const rec = ghostRecorder
  if (!rec.recording) return

  const elapsed = time.gameTime - rec.startTime
  if (elapsed >= CFG.ROCKET.recordingTimeLimit) {
    rec.recording = false
    return
  }
  if (elapsed < rec.nextSampleTime) return

  rec.nextSampleTime += 1 / CFG.ROCKET.recordingFPS

  // Формат: [t, x, y, z, rotZ, boost]
  // rotation.y НЕ сохраняем — это константа -CFG.GAME.flightYaw.
  rec.samples.push(
    elapsed,
    rocketState.pos.x,
    rocketState.pos.y,
    rocketState.pos.z,
    rocket.rotation.z,
    boosting || Abilities.isActive('forsage') ? 1 : 0
  )
}

/* ================================================================
   GHOST PERSISTENCE — base64-кодирование Float32Array.
   ~432 КБ raw → ~560 КБ в localStorage для 10-минутного полёта.
================================================================ */
function u8ToBase64(u8) {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64ToU8(b64) {
  const binary = atob(b64)
  const u8 = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) u8[i] = binary.charCodeAt(i)
  return u8
}

function saveGhostFlight() {
  if (ghostRecorder.samples.length < CFG.ROCKET.minSamplesLimit) return // меньше 2 сэмплов — не сохраняем
  try {
    const float32 = new Float32Array(ghostRecorder.samples)
    bestFlight.samples = float32
    bestFlight.best = G.best

    const bytes = new Uint8Array(float32.buffer)
    const b64 = u8ToBase64(bytes)
    localStorage.setItem(
      CFG.ROCKET.ghost.storageKey,
      JSON.stringify({ v: 1, best: G.best, samples: b64 })
    )
  } catch (e) {
    console.warn('saveGhostFlight failed:', e)
  }
}

export function loadGhostFlight() {
  try {
    const raw = localStorage.getItem(CFG.ROCKET.ghost.storageKey)
    if (!raw) return
    const data = JSON.parse(raw)
    if (!data || typeof data.samples !== 'string') return

    const bytes = base64ToU8(data.samples)
    if (bytes.length % 4 !== 0) return
    const float32 = new Float32Array(bytes.buffer)
    if (float32.length < 12) return

    bestFlight.samples = float32
    bestFlight.best = typeof data.best === 'number' ? data.best : 0
  } catch (e) {
    console.warn('loadGhostFlight failed:', e)
  }
}

/* ================================================================
   updateBoss — state-machine босса.
================================================================ */
function updateBoss(dt) {
  const idle = performance.now() * 0.0022

  if (G.phase === 'ready' || G.phase === 'landed') {
    legKick.rotation.z += (0 - legKick.rotation.z) * Math.min(1, dt * 12)
    boss.position.y = Math.sin(idle) * 0.08
    torso.rotation.z = Math.sin(idle * 0.7) * 0.03
    head.rotation.z = Math.sin(idle * 0.7) * 0.05
    legBack.rotation.z = Math.sin(idle) * 0.03
  } else if (G.phase === 'prekick') {
    const dist = camera.position.distanceTo(cam.target)
    if (dist <= CFG.GAME.prekickCamTolerance) {
      G.timer += dt
      if (G.timer >= CFG.GAME.prekickDelay) {
        G.phase = 'windup'
        G.timer = 0
      }
    } else {
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

/* ================================================================
   updateRocket — физика полёта.
================================================================ */
function updateRocket(dt) {
  const p = rocketState
  const restY = terrainHeight(p.pos.x, p.pos.z) + REST_Y

  // Форсаж проверяем каждый кадр — понадобится и в блоке пламени.
  const forsageActive = Abilities.isActive('forsage')

  if (G.phase === 'fly') {
    const ang = rocket.rotation.z
    const yaw = CFG.GAME.flightYaw || 0

    // Форсаж отключает обычный буст (Вариант Б):
    // PUSH не действует и НЕ тратит топливо, чтобы не суммировать тяги.
    boosting = input.boost && G.fuel > 0 && !forsageActive

    let appliedThrust = 0
    if (boosting) {
      appliedThrust += thrustAcc()
      G.fuel = Math.max(0, G.fuel - dt)
    }
    if (forsageActive) {
      appliedThrust += thrustAcc() * Abilities.thrustMultiplier('forsage')
    }

    if (appliedThrust > 0) {
      const c = Math.cos(ang)
      p.vel.x += c * Math.cos(yaw) * appliedThrust * dt
      p.vel.y += Math.sin(ang) * appliedThrust * dt
      p.vel.z += c * Math.sin(yaw) * appliedThrust * dt
    }

    p.vel.y -= GRAVITY * gravityMul() * dt

    const speed = p.vel.length()
    if (speed > 0.01) {
      const noseX = Math.cos(ang) * Math.cos(yaw)
      const noseY = Math.sin(ang)
      const noseZ = Math.cos(ang) * Math.sin(yaw)
      const dot = (noseX * p.vel.x + noseY * p.vel.y + noseZ * p.vel.z) / speed
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
    recordGhostSample() // ← пишем сэмпл
  } else if (G.phase === 'landed') {
    p.pos.y += (restY - p.pos.y) * Math.min(1, dt * 8)
    rocket.rotation.z += (0 - rocket.rotation.z) * Math.min(1, dt * 6)
  }

  rocket.position.copy(p.pos)

  if (G.phase === 'fly') {
    const rotInput =
      (input.keys.W || input.touch.W ? 1 : 0) - (input.keys.S || input.touch.S ? 1 : 0)

    p.angVel += rotInput * ANG_ACC * dt
    p.angVel -= p.angVel * ANG_DAMP * dt
    p.angVel = Math.max(-ANG_MAX, Math.min(ANG_MAX, p.angVel))

    rocket.rotation.z += p.angVel * dt

    // Аэродинамическая стабилизация
    const ALIGN_RATE = CFG.GAME.aeroAlign
    const MIN_SPEED = CFG.GAME.aeroAlignMinSpeed
    const spd = p.vel.length()
    if (ALIGN_RATE > 0 && spd > MIN_SPEED) {
      const desired = Math.atan2(p.vel.y, Math.hypot(p.vel.x, p.vel.z))
      let diff = desired - rocket.rotation.z
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      const maxStep = ALIGN_RATE * dt
      const step = Math.sign(diff) * Math.min(Math.abs(diff), maxStep)
      rocket.rotation.z += step
    }
  }

  // Индикатор выравнивания + цвет пламени
  if (G.phase === 'fly') {
    let diff = rocket.rotation.z - Math.atan2(p.vel.y, p.vel.x)
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    const deg = (Math.abs(diff) * 180) / Math.PI

    UI.setAlignText(deg)

    if (forsageActive) {
      flameMat.color.setHex(CFG.ROCKET.flame.forsage)
    } else if (boosting) {
      flameMat.color.setHex(deg < 15 ? CFG.ROCKET.flame.aligned : CFG.ROCKET.flame.misaligned)
    } else {
      flameMat.color.setHex(CFG.ROCKET.flame.outer) // idle-огонёк — сбрасываем
    }
  }

  const boostAmt = boosting || forsageActive ? 1 : G.phase === 'fly' ? 0.35 : 0
  const flick = 0.85 + Math.random() * 0.3
  const flameScale = forsageActive ? 1.35 : 1.0 // форсаж — пламя заметно крупнее
  flame.scale.set(
    boostAmt * flick * flameScale,
    boostAmt * flick * flameScale,
    boostAmt * flick * flameScale
  )
  flameInner.scale.set(
    boostAmt * flick * 1.1 * flameScale,
    boostAmt * flick * flameScale,
    boostAmt * flick * flameScale
  )
  flame.visible = boostAmt > 0.05
  flameInner.visible = flame.visible
  flameMat.opacity = boosting || forsageActive ? 0.95 : 0.5
  exhaustLight.intensity = boostAmt * (boosting || forsageActive ? 45 : 8)
}

/* ================================================================
   updateCamera
================================================================ */
function updateCamera(dt) {
  const p = rocketState.pos
  const gY = terrainHeight(p.x, 0)
  const speed = rocketState.vel.length()

  const wantBehind = G.phase === 'fly' ? 1 : 0
  const blendSpeed = wantBehind > cam.blend ? CFG.CAMERA.blendIn : CFG.CAMERA.blendOut
  cam.blend += (wantBehind - cam.blend) * Math.min(1, dt * blendSpeed)
  if (cam.blend < 0.001) cam.blend = 0
  if (cam.blend > 0.999) cam.blend = 1

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

  const camX = px - hDist * cam.blend
  const camY = py + vDist
  const camZ = pz + hDist * (1 - cam.blend)

  cam.target.set(camX, camY, camZ)

  const follow =
    CFG.CAMERA.followBase + Math.min(CFG.CAMERA.followMaxSpeed, speed * CFG.CAMERA.followSpeedK)
  const s = 1 - Math.exp(-follow * dt)

  camera.position.x += (camX - camera.position.x) * s
  camera.position.y += (camY - camera.position.y) * s
  camera.position.z += (camZ - camera.position.z) * s

  const lookAhead =
    (CFG.CAMERA.lookAheadBase + CFG.CAMERA.lookAheadBehind * cam.blend) *
    (1 - altT * CFG.CAMERA.lookAheadAltK)
  const lookX = px + lookAhead
  const lookY = py

  cam.look.x += (lookX - cam.look.x) * s
  cam.look.y += (lookY - cam.look.y) * s
  cam.look.z += (pz - cam.look.z) * s

  if (cam.shake > 0) {
    cam.shake = Math.max(0, cam.shake - dt * CFG.CAMERA.shakeDecayK)
    const a = cam.shake * cam.shake * CFG.CAMERA.shakeAmpK
    camera.position.x += (Math.random() - 0.5) * a
    camera.position.y += (Math.random() - 0.5) * a
  }

  camera.lookAt(cam.look)
}

/* ================================================================
   Общий update.
================================================================ */
export function update(dt) {
  Abilities.update(dt)
  updateChestsFX(dt, rocketState.pos.x, rocketState.pos.z)
  updateBoss(dt)
  updateRocket(dt)
  updateCamera(dt)

  // Призрак — только в фазе полёта
  if (G.phase === 'fly' && bestFlight.samples) {
    const t = time.gameTime - ghostRecorder.startTime
    updateGhostRocket(bestFlight.samples, t)
  } else {
    updateGhostRocket(null, 0) // скрыть
  }

  // HUD и прогрессбар до следующего сундука
  updateChestTracker()

  if (G.phase === 'fly') {
    UI.updateHUD()
    UI.setHUDDist(rocketState.pos.x)
    UI.updateFuelBar(G.fuel, maxFuel())
  }
}

/**
 * Прогрессбар «сколько метров до следующего сундука».
 * Шкала — от самого старта (x = 0) до следующего неоткрытого сундука.
 */
function updateChestTracker() {
  const rx = rocketState.pos.x
  const rz = rocketState.pos.z

  // ближайший НЕоткрытый сундук по XZ
  let nearest = null
  let nearestD2 = Infinity
  for (const c of chests) {
    if (c.opened) continue
    const dx = c.x - rx
    const dz = c.z - rz
    const d2 = dx * dx + dz * dz
    if (d2 < nearestD2) {
      nearestD2 = d2
      nearest = c
    }
  }

  if (!nearest) {
    UI.updateChestProgress(null, 0, false, false)
    return
  }

  // Сундук впереди — обычный режим
  if (nearest.x >= rx) {
    const dist = nearest.x - rx
    const progress = Math.max(0, Math.min(1, rx / Math.max(1, nearest.x)))
    UI.updateChestProgress(dist, progress, dist < CFG.CHESTS.nearRadius, false)
    return
  }

  // Сундук позади — проверяем overRadius
  const dist = nearest.x - rx // отрицательное
  if (Math.abs(dist) <= CFG.CHESTS.overRadius) {
    UI.updateChestProgress(dist, 1, false, true) // missed = true
    return
  }

  // Ушли слишком далеко — ищем следующий впереди
  let nextX = null
  for (const c of chests) {
    if (c.opened) continue
    if (c.x >= rx) {
      nextX = c.x
      break
    }
  }
  if (nextX === null) {
    UI.updateChestProgress(null, 0, false, false)
  } else {
    const d = nextX - rx
    const progress = Math.max(0, Math.min(1, rx / Math.max(1, nextX)))
    UI.updateChestProgress(d, progress, d < CFG.CHESTS.nearRadius, false)
  }
}

/* ================================================================
   DEBUG: открыть сундук по X (для теста без полёта на 15000 м).
   Возвращает сундук в исходное состояние — можно тестировать повторно.
================================================================ */
/* export function debugOpenChestAt(x) {
  const chest = chests.find((c) => c.x === x)
  if (!chest) {
    console.warn(`[DEBUG] Сундук на X=${x} не найден`)
    return
  }
  chest.opened = false
  chest.group.visible = true
  G.openedChests.delete(x)
  openChest(chest)
  console.log(`[DEBUG] Открыт сундук X=${x}, type=${chest.type}`)
}*/

/* ================================================================
   init — вызвать после scene.init() и entities.init().
================================================================ */
export function init() {
  loadProgress()
  loadGhostFlight() // ← Призрак
  resetRocket()
  rocket.position.copy(rocketState.pos)
  G.fuel = maxFuel()
  UI.updateHUD()
  UI.renderShop()
}
