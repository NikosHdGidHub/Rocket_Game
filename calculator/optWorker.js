/* ================================================================
   optWorker.js — module worker: гоняет findOptimumAsync в фоне.
================================================================ */
import { findOptimumAsync } from './simulation.js'

self.onmessage = async (e) => {
  const { type, requestId, upgrades, cards, opts } = e.data || {}
  if (type !== 'findOptimum') return
  try {
    const data = await findOptimumAsync(upgrades, cards, opts, (done, total, msg) => {
      self.postMessage({ type: 'progress', requestId, done, total, msg })
    })
    self.postMessage({
      type: 'result',
      requestId,
      bestDistance: data.best.distance,
      bestStrategy: data.best.strategy,
      bestAngle: data.best.angle,
    })
  } catch (err) {
    self.postMessage({
      type: 'error',
      requestId,
      message: String((err && err.message) || err),
    })
  }
}