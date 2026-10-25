/* ================================================================
   game.js — игровая логика: init, старт/посадка, апгрейды, карточки,
   оркестрация updatePhysics/updateVisuals.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'
import * as Achievements from '../achievements.js'
import * as CardsModal from '../ui/cardsModal.js'
import { G, rocketState, cam, input, time, ghostRecorder, bestFlight } from '../state.js'
import * as Abilities from '../abilities.js'
import {
  rocket,
  chests,
  updateChests as updateChestsFX,
  updateGems as updateGemsFX,
  updateGhostRocket,
} from '../views/entities/index.js'
import * as UI from '../ui/index.js'
import { camera } from '../views/scene.js'
import { terrainHeight } from '../world/world.js'

import { UPGRADES, costOf, launchSpeed, maxFuel } from './formulas.js'
import {
  updateRocketPhysics,
  updateRocketVisuals,
  updateChestTracker,
  checkGemPickup,
  setLandCallback,
} from './physics.js'
import { updateCamera } from './camera.js'
import { updateBossAnim } from './boss.js'
import { startGhostRecording } from './ghostRecorder.js'
import {
  saveProgress,
  loadProgress,
  resetProgress,
  saveGhostFlight,
  loadGhostFlight,
} from '../services/save.js'

const LAUNCH_ANGLE = CFG.GAME.launchAngle
const REST_Y = CFG.GAME.restY

const _ipos = new THREE.Vector3()
const _ivel = new THREE.Vector3()
let _irotZ = 0

/* ---------- Re-exports для main.js ---------- */
export { UPGRADES, costOf, saveProgress, loadProgress, resetProgress, loadGhostFlight }

/* ================================================================
   Апгрейды
================================================================ */
export function buy(u) {
  const lvl = G.upgrades[u.key]
  const max = u.maxLevel ?? Infinity
  if (lvl >= max) return
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
  cam.blend = 0
}

function resetRocket() {
  const gY = terrainHeight(0, 0)
  rocketState.pos.set(0, gY + REST_Y, 0)
  rocketState.prevPos.copy(rocketState.pos)
  rocketState.rotZ = 0
  rocketState.prevRotZ = 0
  rocketState.vel.set(0, 0, 0)
  rocketState.prevVel.set(0, 0, 0)
  rocketState.angVel = 0
  rocket.position.copy(rocketState.pos)
  rocket.rotation.z = 0
  rocket.rotation.y = 0
  G.fuel = maxFuel()
  input.boost = false
  Abilities.reset()
  UI.setHUDDist(0)
}

function launch() {
  const speed = launchSpeed()
  const yaw = CFG.GAME.flightYaw || 0
  const horiz = Math.cos(LAUNCH_ANGLE) * speed
  rocketState.vel.set(Math.cos(yaw) * horiz, Math.sin(LAUNCH_ANGLE) * speed, Math.sin(yaw) * horiz)
  rocketState.prevVel.set(rocketState.vel.x, rocketState.vel.y, rocketState.vel.z)
  rocketState.rotZ = LAUNCH_ANGLE
  rocketState.prevRotZ = LAUNCH_ANGLE
  rocketState.prevPos.copy(rocketState.pos)
  rocket.rotation.z = LAUNCH_ANGLE
  rocket.rotation.y = -yaw
  rocketState.angVel = 0
  G.phase = 'fly'
  G.timer = 0
  startGhostRecording()
  UI.showToast('ПОЛЕТЕЛИ! 🚀', CFG.UI.toastColors.upgrade)
  Achievements.onLaunch()
  saveProgress()
}

function land() {
  G.phase = 'landed'

  const speedAtTouchdown = rocketState.vel.length()
  const landedX = rocketState.pos.x
  const landedZ = rocketState.pos.z
  const groundY = terrainHeight(landedX, landedZ)

  let nearestChestDist = Infinity
  for (const c of chests) {
    if (c.opened) continue
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
  const isRecord = dist > G.best
  if (isRecord) G.best = dist

  if (isRecord && ghostRecorder.samples.length >= CFG.ROCKET.minSamplesLimit) {
    saveGhostFlight()
  }
  ghostRecorder.recording = false

  UI.setHUDDist(dist)
  UI.updateHUD()
  UI.renderShop()
  saveProgress()

  UI.showLandToast(dist, isRecord)
  cam.shake = CFG.CAMERA.shakeOnLand

  Achievements.onLand({
    dist,
    altitude: groundY,
    speed: speedAtTouchdown,
    nearestChestDist,
  })
  Abilities.reset()
}

/* ================================================================
   updateBossPhase — state machine (launch() должен жить здесь)
================================================================ */
function updateBossPhase(dt) {
  if (G.phase === 'prekick') {
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
    if (G.timer >= 0.3) {
      G.phase = 'strike'
      G.timer = 0
    }
  } else if (G.phase === 'strike') {
    G.timer += dt
    if (G.timer >= 0.11 && G.phase === 'strike') launch()
  }
}

/* ================================================================
   Карточки: выбор из двух
================================================================ */
function isConditionMet(cond) {
  if (cond === 'forsage') return (G.cards.forsage || 0) >= 1
  return true
}

function getFamilyCount(family) {
  let total = 0
  for (const card of CFG.CARDS) {
    if (card.family === family) total += G.cards[card.id] || 0
  }
  return total
}

function isAvailable(card) {
  if (card.special) return false
  if (card.once && (G.cards[card.id] || 0) >= 1) return false
  if (card.condition && !isConditionMet(card.condition)) return false
  if (getFamilyCount(card.family) >= CFG.CHESTS.cardTypeLimit) return false
  return true
}

function pickTwoCards() {
  const available = CFG.CARDS.filter(isAvailable)
  if (available.length === 0) return []

  const card1 = available[Math.floor(Math.random() * available.length)]
  const rest = available.filter((c) => c.id !== card1.id)
  if (rest.length === 0) return [card1]

  const card2 = rest[Math.floor(Math.random() * rest.length)]
  return [card1, card2]
}

function openChest(chest) {
  chest.opened = true
  G.openedChests.add(chest.x)
  chest.group.visible = false
  Achievements.onChestOpen(G.openedChests.size)

  if (chest.type === 'forsage') {
    const maxLv = CFG.ABILITIES.forsage.levels.length
    const curLv = G.cards.forsage || 0

    if (curLv < maxLv) {
      const card = CFG.CARDS.find((c) => c.family === 'forsage')
      if (card) {
        const isUpgrade = curLv >= 1
        G.cards.forsage = curLv + 1
        UI.showCardChoices([card], () => {}, { isUpgradeOverride: isUpgrade })
        Abilities.onCardObtained('forsage')
        saveProgress()
        CardsModal.refresh()
        return
      }
    }
  }

  const options = pickTwoCards()
  if (options.length === 0) {
    UI.showToast('Все карточки собраны! 🎉', CFG.UI.toastColors.upgrade)
    saveProgress()
    return
  }

  UI.showCardChoices(options, (picked) => {
    G.cards[picked.id] = (G.cards[picked.id] || 0) + 1
    saveProgress()
    CardsModal.refresh()
  })
  saveProgress()
}

/* ================================================================
   Карточки: покупка / продажа
================================================================ */
export function canBuyCard(cardId) {
  const card = CFG.CARDS.find((c) => c.id === cardId)
  if (!card) return 'Карточка не найдена'
  if (card.buyFlag === false) return 'Покупка недоступна'
  if (!card.buyPrice || card.buyPrice <= 0) return 'Цена не указана'

  const reason = canGiveCardReason(cardId)
  if (reason) return reason

  if (G.gems < card.buyPrice) return `Нужно ${card.buyPrice} 💎 (у вас ${G.gems})`
  return null
}

export function canSellCard(cardId) {
  const card = CFG.CARDS.find((c) => c.id === cardId)
  if (!card) return 'Карточка не найдена'
  if (card.sellFlag === false) return 'Продажа недоступна'
  if (!card.sellPrice || card.sellPrice <= 0) return 'Цена не указана'
  const cur = G.cards[cardId] || 0
  if (cur <= 0) return 'Нет карточек для продажи'
  return null
}

export function buyCard(cardId) {
  const reason = canBuyCard(cardId)
  if (reason) return { ok: false, reason }

  const card = CFG.CARDS.find((c) => c.id === cardId)
  G.gems -= card.buyPrice
  G.cards[card.id] = (G.cards[card.id] || 0) + 1

  if (card.family === 'forsage') Abilities.onCardObtained('forsage')

  saveProgress()
  CardsModal.refresh()
  return { ok: true }
}

export function sellCard(cardId) {
  const reason = canSellCard(cardId)
  if (reason) return { ok: false, reason }

  const card = CFG.CARDS.find((c) => c.id === cardId)
  G.gems += card.sellPrice
  const cur = G.cards[cardId] || 0
  G.cards[cardId] = cur - 1
  if (G.cards[cardId] === 0) delete G.cards[cardId]

  if (card.family === 'forsage') {
    Abilities.syncFromCards()
    const a = G.abilities.forsage
    if (a) {
      a.active = false
      a.activeEnd = 0
      a.cooldownEnd = 0
    }
  }

  saveProgress()
  CardsModal.refresh()
  return { ok: true }
}

export function getCardTradePreview(cardId, delta) {
  const card = CFG.CARDS.find((c) => c.id === cardId)
  if (!card) return null

  const curCount = G.cards[cardId] || 0
  const newCount = Math.max(0, curCount + delta)

  const effects = []
  if (card.effects) {
    for (const eff of card.effects) {
      const before = Math.pow(eff.mult, curCount)
      const after = Math.pow(eff.mult, newCount)
      if (Math.abs(before - after) < 0.001) continue
      effects.push({ stat: eff.stat, before, after })
    }
  }
  return { curCount, newCount, effects }
}

/* ================================================================
   DEBUG: карточки
================================================================ */
export function canGiveCardReason(id) {
  const card = CFG.CARDS.find((c) => c.id === id)
  if (!card) return `Карточка "${id}" не найдена`
  if (card.special) return `"${id}" — special, выдаётся только через фиолетовый сундук`
  if (card.once && (G.cards[card.id] || 0) >= 1) return `"${id}" — once, уже получена`
  if (card.condition && !isConditionMet(card.condition))
    return `"${id}" — не выполнено условие "${card.condition}"`
  if (getFamilyCount(card.family) >= CFG.CHESTS.cardTypeLimit)
    return `Семейство "${card.family}" уже на лимите ${CFG.CHESTS.cardTypeLimit}`
  return null
}

export function giveCard(id, { silent = false } = {}) {
  const reason = canGiveCardReason(id)
  if (reason) {
    console.warn('[dbgGiveCard] ⛔', reason)
    return false
  }
  const card = CFG.CARDS.find((c) => c.id === id)
  const isUpgrade = (G.cards[card.id] || 0) >= 1
  G.cards[card.id] = (G.cards[card.id] || 0) + 1

  if (!silent) {
    UI.showCardChoices([card], () => {}, { isUpgradeOverride: isUpgrade })
  }
  CardsModal.refresh()
  saveProgress()
  console.log(`[dbgGiveCard] ✅ "${id}" выдан (теперь ×${G.cards[card.id]})`)
  return true
}

export function listCardsDebug() {
  console.table(
    CFG.CARDS.map((card) => {
      const count = G.cards[card.id] || 0
      const reason = canGiveCardReason(card.id)
      return {
        id: card.id,
        family: card.family,
        variant: card.variant || '',
        получено: count,
        статус: reason ? `⛔ ${reason}` : '✅ можно',
      }
    })
  )
}

export function removeCard(id, { silent = false } = {}) {
  const card = CFG.CARDS.find((c) => c.id === id)
  if (!card) {
    console.warn(`[dbgRemoveCard] ⛔ Карточка "${id}" не найдена`)
    return false
  }
  const cur = G.cards[card.id] || 0
  if (cur <= 0) {
    console.warn(`[dbgRemoveCard] ⛔ "${id}" уже 0 — нечего убирать`)
    return false
  }
  G.cards[card.id] = cur - 1
  if (G.cards[card.id] === 0) delete G.cards[card.id]

  if (card.family === 'forsage') {
    Abilities.syncFromCards()
    const a = G.abilities.forsage
    if (a) {
      a.active = false
      a.activeEnd = 0
      a.cooldownEnd = 0
    }
  }

  CardsModal.refresh()
  saveProgress()

  if (!silent) {
    const label = card.variant ? `${card.name} · ${card.variant}` : card.name
    UI.showToast(`🗑️ -1 ${card.icon} ${label}`, '#ff7a7a')
  }

  console.log(`[dbgRemoveCard] ✅ "${id}" убран (осталось ×${G.cards[card.id] || 0})`)
  return true
}

/* ================================================================
   DEBUG: сундук по X
================================================================ */
export function debugOpenChestAt(x) {
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
}

/* ================================================================
   Точки входа update
================================================================ */
export function updatePhysics(dt) {
  Abilities.update(dt)
  updateBossPhase(dt)
  updateRocketPhysics(dt)
  checkGemPickup()
}

export function updateVisuals(dt, alpha, visualTime = time.gameTime) {
  _ipos.lerpVectors(rocketState.prevPos, rocketState.pos, alpha)
  _ivel.lerpVectors(rocketState.prevVel, rocketState.vel, alpha)
  _irotZ = rocketState.prevRotZ + (rocketState.rotZ - rocketState.prevRotZ) * alpha

  updateBossAnim(dt)
  updateRocketVisuals(dt, _irotZ, _ipos, _ivel)
  updateCamera(dt, _ipos, _ivel)
  updateChestsFX(dt, _ipos.x, _ipos.z)
  updateGemsFX(dt)

  if (G.phase === 'fly' && bestFlight.samples) {
    const t = Math.max(0, visualTime - ghostRecorder.startTime)
    updateGhostRocket(bestFlight.samples, t)
  } else {
    updateGhostRocket(null, 0)
  }

  updateChestTracker(_ipos.x, _ipos.z)
  if (G.phase === 'fly') {
    UI.updateHUD()
    UI.setHUDDist(_ipos.x)
    UI.updateFuelBar(G.fuel, maxFuel())
  }
}

/* ================================================================
   init
================================================================ */
export function init() {
  setLandCallback(land)
  loadProgress()
  loadGhostFlight()
  resetRocket()
  rocket.position.copy(rocketState.pos)
  G.fuel = maxFuel()
  UI.updateHUD()
  UI.renderShop()
}
