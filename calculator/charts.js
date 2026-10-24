/* ================================================================
   charts.js — SVG-графики траектории и «дальность vs угол».
   Ничего кроме стринговой SVG-разметки не возвращает.
================================================================ */

const fmtAxis = (v) => {
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return Math.round(v / 1e3) + 'к'
  return Math.round(v)
}

const fmtM = (m) => {
  if (m < 1000) return Math.round(m) + ' м'
  if (m < 10000) return (m / 1000).toFixed(2) + ' км'
  return Math.round(m / 1000) + ' км'
}

export function renderTrajectoryChart(trajectory) {
  const W = 440, H = 280
  const padL = 55, padR = 20, padT = 20, padB = 40
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  let maxX = 0, maxY = 0, peakIdx = 0
  for (let i = 0; i < trajectory.length; i++) {
    const [tx, ty] = trajectory[i]
    if (tx > maxX) maxX = tx
    if (ty > maxY) { maxY = ty; peakIdx = i }
  }
  if (maxX <= 0) maxX = 1
  if (maxY <= 0) maxY = 1
  maxX *= 1.05
  maxY *= 1.08

  const toX = (v) => padL + (v / maxX) * plotW
  const toY = (v) => padT + (1 - v / maxY) * plotH

  const pts = trajectory.map(([tx, ty]) => `${toX(tx).toFixed(1)},${toY(ty).toFixed(1)}`).join(' ')

  const xTicks = []
  for (let i = 0; i <= 4; i++) {
    const v = (maxX * i) / 4
    const px = toX(v)
    xTicks.push(`<line x1="${px}" y1="${padT}" x2="${px}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.06)"/>
      <text x="${px}" y="${padT + plotH + 15}" fill="rgba(255,255,255,0.45)" font-size="10" text-anchor="middle">${fmtAxis(v)}</text>`)
  }
  const yTicks = []
  for (let i = 0; i <= 4; i++) {
    const v = (maxY * i) / 4
    const px = toY(v)
    yTicks.push(`<line x1="${padL}" y1="${px}" x2="${padL + plotW}" y2="${px}" stroke="rgba(255,255,255,0.06)"/>
      <text x="${padL - 6}" y="${px + 3}" fill="rgba(255,255,255,0.45)" font-size="10" text-anchor="end">${fmtAxis(v)}</text>`)
  }

  const startPt = trajectory[0]
  const endPt = trajectory[trajectory.length - 1]
  const peakPt = trajectory[peakIdx]

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg">
    ${xTicks.join('')}
    ${yTicks.join('')}
    <polyline points="${pts}" fill="none" stroke="#ffd75e" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${toX(startPt[0])}" cy="${toY(startPt[1])}" r="4" fill="#7dffa0"/>
    <circle cx="${toX(endPt[0])}" cy="${toY(endPt[1])}" r="4" fill="#ff7a7a"/>
    <circle cx="${toX(peakPt[0])}" cy="${toY(peakPt[1])}" r="4" fill="#ffd75e"/>
    <text x="${toX(peakPt[0])}" y="${toY(peakPt[1]) - 8}" fill="#ffd75e" font-size="10" font-weight="700" text-anchor="middle">${fmtAxis(peakPt[1])}</text>
    <text x="${padL + plotW / 2}" y="${H - 8}" fill="rgba(255,255,255,0.55)" font-size="11" text-anchor="middle">Дальность, м</text>
    <text x="14" y="${padT + plotH / 2}" fill="rgba(255,255,255,0.55)" font-size="11" text-anchor="middle" transform="rotate(-90 14 ${padT + plotH / 2})">Высота, м</text>
  </svg>`
}

export function renderAngleChart(results, best) {
  const W = 440, H = 280
  const padL = 55, padR = 20, padT = 20, padB = 40
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  let maxY = 0
  for (const r of results) if (r.distance > maxY) maxY = r.distance
  if (maxY <= 0) maxY = 1
  maxY *= 1.08

  const toX = (angle) => padL + (angle / 90) * plotW
  const toY = (dist) => padT + (1 - dist / maxY) * plotH
  const pts = results.map((r) => `${toX(r.angle).toFixed(1)},${toY(r.distance).toFixed(1)}`).join(' ')

  const xTicks = []
  for (let a = 0; a <= 90; a += 15) {
    const px = toX(a)
    xTicks.push(`<line x1="${px}" y1="${padT}" x2="${px}" y2="${padT + plotH}" stroke="rgba(255,255,255,0.06)"/>
      <text x="${px}" y="${padT + plotH + 15}" fill="rgba(255,255,255,0.45)" font-size="10" text-anchor="middle">${a}°</text>`)
  }
  const yTicks = []
  for (let i = 0; i <= 4; i++) {
    const v = (maxY * i) / 4
    const px = toY(v)
    yTicks.push(`<line x1="${padL}" y1="${px}" x2="${padL + plotW}" y2="${px}" stroke="rgba(255,255,255,0.06)"/>
      <text x="${padL - 6}" y="${px + 3}" fill="rgba(255,255,255,0.45)" font-size="10" text-anchor="end">${fmtAxis(v)}</text>`)
  }

  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg">
    ${xTicks.join('')}
    ${yTicks.join('')}
    <polyline points="${pts}" fill="none" stroke="#c38bff" stroke-width="2" stroke-linejoin="round"/>
    <circle cx="${toX(best.angle)}" cy="${toY(best.distance)}" r="5" fill="#ffd75e"/>
    <text x="${toX(best.angle)}" y="${toY(best.distance) - 10}" fill="#ffd75e" font-size="10" font-weight="700" text-anchor="middle">${best.angle}° · ${fmtM(best.distance)}</text>
    <text x="${padL + plotW / 2}" y="${H - 8}" fill="rgba(255,255,255,0.55)" font-size="11" text-anchor="middle">Угол подъёма носа, °</text>
    <text x="14" y="${padT + plotH / 2}" fill="rgba(255,255,255,0.55)" font-size="11" text-anchor="middle" transform="rotate(-90 14 ${padT + plotH / 2})">Дальность, м</text>
  </svg>`
}