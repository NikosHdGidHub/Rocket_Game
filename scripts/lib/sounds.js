/* ================================================================
   sounds.js — движок звуков на Web Audio API.

   — Автозагрузка всех файлов из CFG.SOUNDS.list при init().
   — Autoplay-policy: AudioContext стартует suspended; unlock по
     первому pointerdown / keydown / touchstart.
   — play(key) — воспроизводит звук (можно накладывать друг на друга).
   — setMasterVolume(0..1) — плавно меняет мастер-громкость.
   — Громкость конкретного звука берётся из CFG.SOUNDS.list[key].volume.
   — Пользовательская настройка из settings.js действует как множитель.
================================================================ */
import * as CFG from '../config.js'
import { settings } from './settings.js'

const S = CFG.SOUNDS
const buffers = new Map() // key → AudioBuffer (декодированный звук)
let audioCtx = null
let masterGain = null
let initialized = false

/* ================================================================
   INIT
================================================================ */
export function init() {
  if (!S.enabled) return
  if (initialized) return
  initialized = true

  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) throw new Error('AudioContext не поддерживается')
    audioCtx = new Ctx()

    masterGain = audioCtx.createGain()
    masterGain.gain.value = getEffectiveMasterVolume()
    masterGain.connect(audioCtx.destination)
  } catch (e) {
    console.warn('sounds: init failed:', e)
    audioCtx = null
    return
  }

  preloadAll()
  attachUnlockListeners()
}

/* ================================================================
   PRELOAD — fetch + decodeAudioData всех звуков параллельно.
================================================================ */
async function preloadAll() {
  const entries = Object.entries(S.list)
  await Promise.all(
    entries.map(async ([key, def]) => {
      if (!def || !def.src) return
      try {
        const res = await fetch(def.src)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const arr = await res.arrayBuffer()
        const buf = await audioCtx.decodeAudioData(arr)
        buffers.set(key, buf)
      } catch (e) {
        console.warn(`sounds: не удалось загрузить "${key}" (${def.src}):`, e)
      }
    })
  )
}

/* ================================================================
   UNLOCK — браузеры запускают AudioContext только по жесту.
   Вешаем одноразовые слушатели на первый интерактив.
================================================================ */
function attachUnlockListeners() {
  const unlock = () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx
        .resume()
        .then(() => {
          // После resume применяем актуальное значение —
          // на случай, если ползунок двигали в suspended.
          if (masterGain) masterGain.gain.value = getEffectiveMasterVolume()
        })
        .catch(() => {})
    }
    document.removeEventListener('pointerdown', unlock)
    document.removeEventListener('keydown', unlock)
    document.removeEventListener('touchstart', unlock)
  }
  document.addEventListener('pointerdown', unlock, { passive: true })
  document.addEventListener('keydown', unlock, { passive: true })
  document.addEventListener('touchstart', unlock, { passive: true })
}

/* ================================================================
   PLAY — воспроизведение. Безопасно вызывать когда угодно:
     — если контекст ещё suspended → resume() и попытка (может быть
       беззвучно, если браузер всё ещё требует жест);
     — если буфер не загружен → no-op;
     — если звук выключен в настройках → no-op.
================================================================ */
export function play(key) {
  if (!audioCtx || !masterGain) return
  if (!settings.soundEnabled) return

  const def = S.list[key]
  const buf = buffers.get(key)
  if (!def || !buf) return

  const doPlay = () => {
    // Контекст мог быть suspended — resume перед запуском.
    // Для отложенного вызова это важно: пока ждали 120 мс,
    // юзер мог ничего не трогать и контекст остался в suspended.
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {})
    }
    const src = audioCtx.createBufferSource()
    src.buffer = buf
    const gain = audioCtx.createGain()
    gain.gain.value = typeof def.volume === 'number' ? def.volume : 1.0
    src.connect(gain).connect(masterGain)
    src.start()
  }

  const delay = typeof def.delayMs === 'number' ? def.delayMs : 0
  if (delay > 0) setTimeout(doPlay, delay)
  else doPlay()
}

/* ================================================================
   MASTER VOLUME — плавное изменение, чтобы не было «щёлчка».
================================================================ */
export function setMasterVolume(v) {
  if (!masterGain) return
  const clamped = Math.max(0, Math.min(1, Number(v) || 0))
  // Мгновенное применение — работает в любом состоянии AudioContext,
  // в том числе suspended. Без ramp: громкость меняется редко,
  // плавность не нужна, а вот «не применяется до resume» — критично.
  masterGain.gain.value = clamped
  //console.log(`[sounds] masterVolume = ${clamped}, ctx = ${audioCtx.state}`)
}

/* ================================================================
   ВНУТРЕННЕЕ — эффективная мастер-громкость.
   = CFG.SOUNDS.masterVolume (дефолт) × настройка игрока.
   Но если игрок уже крутил настройку, то работает ТОЛЬКО она.
================================================================ */
function getEffectiveMasterVolume() {
  const user = settings.soundVolume
  if (typeof user === 'number' && user >= 0 && user <= 1) return user
  return S.masterVolume
}
