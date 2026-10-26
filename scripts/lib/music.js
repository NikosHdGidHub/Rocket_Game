// НАБРОСОК
import * as CFG from '../config.js'
import { G, time, rocketState } from '../state.js'

let ctx = null
let master = null
const layers = new Map() // name -> { buffer, gain, source }
let started = false
let flightStartTime = 0

export function init(audioCtx, masterGainNode) {
  ctx = audioCtx
  master = masterGainNode
}

export async function preload() {
  for (const [name, def] of Object.entries(CFG.MUSIC.layers)) {
    try {
      const res = await fetch(def.src)
      const arr = await res.arrayBuffer()
      const buffer = await ctx.decodeAudioData(arr)
      const gain = ctx.createGain()
      gain.gain.value = 0
      gain.connect(master)
      layers.set(name, { buffer, gain, source: null })
    } catch (e) {
      console.warn(`music: не удалось загрузить "${name}":`, e)
    }
  }
}

function startLayer(name) {
  const layer = layers.get(name)
  if (!layer || layer.source) return
  const src = ctx.createBufferSource()
  src.buffer = layer.buffer
  src.loop = true
  src.connect(layer.gain)
  src.start(ctx.currentTime + 0.05) // чуть в будущее — все стартуют синхронно
  layer.source = src
}

export function onLaunch() {
  if (!ctx || started) return
  started = true
  flightStartTime = time.gameTime
  // Стартуем ВСЕ полётные слои одновременно, но с громкостью 0.
  // Первый слой (ambient_flight) сразу делаем слышимым.
  for (const name of CFG.MUSIC.flightLayers) startLayer(name)
  setVolume('ambient_flight', 1, 0.5)
}

export function onLand() {
  if (!ctx) return
  started = false
  for (const [name, layer] of layers) {
    if (!layer.source) continue
    layer.source.stop()
    layer.source.disconnect()
    layer.source = null
    layer.gain.gain.value = 0
  }
}

function setVolume(name, target, fadeSec = 2) {
  const layer = layers.get(name)
  if (!layer) return
  layer.gain.gain.setTargetAtTime(target, ctx.currentTime, fadeSec / 3)
}

export function update() {
  if (!started) return
  const t = time.gameTime - flightStartTime

  // 1) Барабаны: через 30 с полёта, плавный fade-in 10 с.
  setVolume('drums', Math.min(1, Math.max(0, (t - 30) / 10)))

  // 2) Бас: по высоте или дистанции (пример — 400 м).
  setVolume('bass', Math.min(1, Math.max(0, (rocketState.pos.x - 400) / 800)))

  // 3) Мелодия: дальше (пример — 1500 м).
  setVolume('melody', Math.min(1, Math.max(0, (rocketState.pos.x - 1500) / 1500)))

  // 4) Космос: плавно поверх всего, от 10 км.
  const spaceT = Math.min(1, Math.max(0, (rocketState.pos.y - 10000) / 5000))
  setVolume('space', spaceT, 4)
  // И гасим земные слои, чтобы не мешали.
  if (spaceT > 0.5) {
    setVolume('drums', 0, 4)
    setVolume('bass', 0, 4)
    setVolume('melody', 0, 4)
  }
}
