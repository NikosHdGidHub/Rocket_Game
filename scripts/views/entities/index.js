/* ================================================================
   entities/index.js — публичный API модуля сущностей.
   Экспортирует ссылки на меши и init(), чтобы game.js / lod.js /
   main.js работали как раньше.
================================================================ */
export { boss, torso, head, legKick, legBack } from './boss.js'
export { rocket, flame, flameInner, flameMat, exhaustLight } from './rocket.js'
export {
  chestGroup,
  chests,
  initChests,
  resyncChests,
  updateChests,
  markChestGlowOpened,
} from './chests.js'
export { gemGroup, gems, initGems, resyncGems, markGemCollected, updateGems } from './gems.js'
export { ghostRocket, updateGhostRocket } from './ghost.js'

import { initChests } from './chests.js'
import { initGems } from './gems.js'

export function init() {
  initChests()
  initGems()
}
