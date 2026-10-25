/* ================================================================
   angles.js — угол отклонения → цвет пламени / HUD.

   Значения = чистая ЛИНЕЙНАЯ интерполяция между стопами
   CFG.ROCKET.anglesCourse. Никакого сглаживания по времени —
   только градиент по углу: чем больше отклонение, тем «дальше»
   по стопам уходит цвет. Каждый кадр возвращаем ровно то,
   что соответствует текущему углу.

   Огонь и HUD берут данные отсюда — единый источник правды.
================================================================ */
import * as THREE from 'three'
import * as CFG from '../config.js'

const AC = CFG.ROCKET.anglesCourse

/* ---------- Стопы, отсортированные по возрастанию угла ---------- */
const STOPS = [
  AC.forward,
  AC.almostForward,
  AC.adjustment,
  AC.change,
  AC.deviation,
  AC.side,
  AC.back,
]
  .filter(Boolean)
  .sort((a, b) => a.angle - b.angle)

// Предсоздаём Color-объекты один раз, чтобы не аллоцировать в кадре.
for (const s of STOPS) {
  s._flame = new THREE.Color(s.flameColor)
  s._text = new THREE.Color(s.textColor)
}

/* ---------- Рабочие объекты ---------- */
const _flame = new THREE.Color(STOPS[0].flameColor)
const _text = new THREE.Color(STOPS[0].textColor)

/* ---------- Локатор пары стопов для заданного угла ---------- */
function locate(deg) {
  const n = STOPS.length
  if (deg <= STOPS[0].angle) return [STOPS[0], STOPS[0], 0]
  if (deg >= STOPS[n - 1].angle) return [STOPS[n - 1], STOPS[n - 1], 0]
  for (let i = 0; i < n - 1; i++) {
    const a = STOPS[i]
    const b = STOPS[i + 1]
    if (deg >= a.angle && deg <= b.angle) {
      const span = b.angle - a.angle
      return [a, b, span > 0 ? (deg - a.angle) / span : 0]
    }
  }
  return [STOPS[n - 1], STOPS[n - 1], 0]
}

/* ---------- Обновление по кадру ----------
   Возвращает объект:
     { flameColor, flameIntensity, textColor, aligned }
   Где flameColor — ссылка на внутренний THREE.Color (только для чтения!).
   textColor — строка вида "rgb(125,255,160)" для CSS.
------------------------------------------------------------------ */
export function update(deg) {
  const [a, b, t] = locate(deg)

  // Градиент: цвет пламени, цвет текста, интенсивность — всё линейно по t.
  _flame.copy(a._flame).lerp(b._flame, t)
  _text.copy(a._text).lerp(b._text, t)

  const flameIntensity = a.flameIntensity + (b.flameIntensity - a.flameIntensity) * t

  const r = (_text.r * 255) | 0
  const g = (_text.g * 255) | 0
  const bl = (_text.b * 255) | 0

  return {
    flameColor: _flame,
    flameIntensity,
    textColor: `rgb(${r},${g},${bl})`,
    aligned: deg <= STOPS[0].angle,
  }
}
