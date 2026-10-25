/* ================================================================
   boss.js — анимация босса по фазе игры (только визуал).
   State-machine (updateBossPhase) живёт в game.js — она вызывает
   launch() и должна знать про flow.
================================================================ */
import { G } from '../state.js'
import { boss, torso, head, legKick, legBack } from '../views/entities/index.js'

export function updateBossAnim(dt) {
  const idle = performance.now() * 0.0022

  if (G.phase === 'ready' || G.phase === 'landed') {
    legKick.rotation.z += (0 - legKick.rotation.z) * Math.min(1, dt * 12)
    boss.position.y = Math.sin(idle) * 0.08
    torso.rotation.z = Math.sin(idle * 0.7) * 0.03
    head.rotation.z = Math.sin(idle * 0.7) * 0.05
    legBack.rotation.z = Math.sin(idle) * 0.03
  } else if (G.phase === 'windup') {
    const t = Math.min(1, G.timer / 0.3)
    const e = 1 - Math.pow(1 - t, 3)
    legKick.rotation.z = -0.85 * e
    torso.rotation.z = 0.12 * e
    boss.position.y = -0.12 * e
  } else if (G.phase === 'strike') {
    const t = Math.min(1, G.timer / 0.11)
    const e = t * t * (3 - 2 * t)
    legKick.rotation.z = -0.85 + (2.05 + 0.85) * e
    torso.rotation.z = 0.12 - 0.28 * e
    boss.position.y = -0.12 + 0.2 * e
  } else if (G.phase === 'fly') {
    legKick.rotation.z += (0 - legKick.rotation.z) * Math.min(1, dt * 6)
    torso.rotation.z += (0 - torso.rotation.z) * Math.min(1, dt * 6)
    boss.position.y += (0 - boss.position.y) * Math.min(1, dt * 6)
  }
}
