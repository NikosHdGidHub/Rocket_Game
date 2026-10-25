/* ================================================================
   ui.js — сборка форм, чтение состояния, рендер результатов
   и загрузка текущего билда из сохранения игры.
================================================================ */
import * as CFG from '../scripts/config.js'
import { getOptPool } from './optPool.js'
import { simulateAdaptive, findOptimumAsync, BOOST_LABELS, BOOST_STRATEGIES } from './simulation.js'
import { renderTrajectoryChart, renderAngleChart } from './charts.js'

/* ---------- Хелперы ---------- */
export const fmtCost = (c) => (c >= 1000 ? Math.round(c / 10) / 100 + 'k' : String(c))
export const fmtSpentShort = (n) => {
  if (n <= 0) return ''
  if (n < 1000) return String(Math.floor(n))
  if (n < 10000) return (n / 1000).toFixed(1) + 'k'
  if (n < 1e6) return Math.round(n / 1000) + 'k'
  return (n / 1e6).toFixed(2) + 'M'
}
export const fmtSpentExact = (n) => Math.floor(n).toLocaleString('ru-RU')
export const fmtM = (m) => {
  if (m < 1000) return Math.round(m) + ' м'
  if (m < 10000) return (m / 1000).toFixed(2) + ' км'
  return Math.round(m / 1000) + ' км'
}

export function totalSpent(u, level) {
  let total = 0
  for (let L = 1; L < level; L++) total += CFG.RULES.upgradeCost(u, L)
  return total
}

function updateUpgradesTotal(prefix) {
  const $el = document.getElementById(`${prefix}upgrades-total`)
  if (!$el) return
  let sum = 0
  for (const u of CFG.UPGRADES) {
    const inp = document.getElementById(`${prefix}${u.key}`)
    if (!inp) continue
    sum += totalSpent(u, +inp.value)
  }
  $el.textContent = sum > 0 ? fmtSpentExact(sum) + ' 💰' : '—'
}

/* ---------- Построение форм ---------- */
export function buildUpgradeInputs(containerId, prefix = '') {
  const $c = document.getElementById(containerId)
  $c.innerHTML = ''
  const updaters = []

  for (const u of CFG.UPGRADES) {
    const row = document.createElement('div')
    row.className = 'row'
    const maxLvl = u.maxLevel ?? 12
    const initLvl = CFG.GAME.initialUpgrades[u.key] ?? 1
    row.innerHTML = `
      <label>${u.icon} ${u.name}</label>
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <input type="range" id="${prefix}${u.key}" min="1" max="${maxLvl}" value="${initLvl}" style="flex:1;min-width:120px">
        <span class="value" id="${prefix}${u.key}-val">${initLvl}</span>
        <span class="next-cost" id="${prefix}${u.key}-next" title="Стоимость следующего уровня"></span>
        <span class="spent" id="${prefix}${u.key}-spent" title="Всего вложено в этот апгрейд"></span>
      </div>`
    $c.appendChild(row)

    const input = row.querySelector('input')
    const val = row.querySelector('.value')
    const nextEl = row.querySelector('.next-cost')
    const spentEl = row.querySelector('.spent')

    const update = () => {
      const lvl = +input.value
      val.textContent = lvl

      if (lvl >= maxLvl) {
        nextEl.textContent = 'MAX'
        nextEl.classList.add('maxed')
        nextEl.title = 'Максимальный уровень'
      } else {
        const nextCost = CFG.RULES.upgradeCost(u, lvl)
        nextEl.textContent = '→ ' + fmtCost(nextCost)
        nextEl.classList.remove('maxed')
        nextEl.title = `Стоимость уровня ${lvl + 1}: ${fmtSpentExact(nextCost)}`
      }

      const total = totalSpent(u, lvl)
      spentEl.textContent = total > 0 ? 'Σ ' + fmtSpentShort(total) : ''
      spentEl.title = `Всего вложено: ${fmtSpentExact(total)}`

      updateUpgradesTotal(prefix)
    }
    input.addEventListener('input', update)
    updaters.push(update)
  }

  const totalRow = document.createElement('div')
  totalRow.className = 'row total-row'
  totalRow.innerHTML = `
    <label>💎 Итого вложено</label>
    <div style="text-align:right">
      <span class="total-val" id="${prefix}upgrades-total">—</span>
    </div>`
  $c.appendChild(totalRow)

  for (const upd of updaters) upd()
}

export function buildCardInputs(containerId, prefix = '') {
  const $c = document.getElementById(containerId)
  $c.innerHTML = ''
  for (const card of CFG.CARDS) {
    if (card.special) continue
    const row = document.createElement('div')
    row.className = 'row'
    const displayName = card.variant ? `${card.name} · ${card.variant}` : card.name
    row.innerHTML = `
      <label>${card.icon} ${displayName}</label>
      <div style="display:flex;align-items:center;gap:12px">
        <input type="number" class="input-num" id="${prefix}card-${card.id}" min="0" max="${CFG.CHESTS.cardTypeLimit}" value="0">
        <span class="hint">${card.desc_buff || ''}${card.desc_debuff ? ' / ' + card.desc_debuff : ''}</span>
      </div>`
    $c.appendChild(row)
  }
}

export function buildOptsInputs(containerId, prefix = '') {
  const $c = document.getElementById(containerId)
  $c.innerHTML = ''

  // Форсаж
  const r1 = document.createElement('div')
  r1.className = 'row'
  r1.innerHTML = `
    <label>🚀 Форсаж (уровень)</label>
    <select id="${prefix}forsage-lvl">
      <option value="0">0 — нет способности</option>
      <option value="1">1 — ×2 тяга, 3с, КД 60</option>
      <option value="2">2 — ×3 тяга, 4с, КД 45</option>
    </select>`
  $c.appendChild(r1)

  // Стратегия PUSH — селект со всеми режимами
  const r2 = document.createElement('div')
  r2.className = 'row'
  const optionsHtml = BOOST_STRATEGIES.map(
    (key) => `<option value="${key}">${BOOST_LABELS[key] || key}</option>`
  ).join('')
  r2.innerHTML = `
    <label>Стратегия PUSH</label>
    <select id="${prefix}throttle-select">${optionsHtml}</select>`
  $c.appendChild(r2)

  // Авто-подъём носа
  const r3 = document.createElement('div')
  r3.className = 'row'
  r3.innerHTML = `
    <label>Авто-подъём носа</label>
    <label class="check-label">
      <input type="checkbox" id="${prefix}nose-lift-enabled" checked>
      <span class="hint">Пока есть тяга — держать нос на угле N</span>
    </label>`
  $c.appendChild(r3)

  // Угол
  const r4 = document.createElement('div')
  r4.className = 'row'
  r4.innerHTML = `
    <label>Угол подъёма</label>
    <div style="display:flex;align-items:center;gap:12px">
      <input type="range" id="${prefix}nose-angle" min="0" max="90" step="1" value="45" style="flex:1">
      <span class="value" id="${prefix}nose-angle-val">45°</span>
    </div>`
  $c.appendChild(r4)

  const $angleSlider = document.getElementById(`${prefix}nose-angle`)
  const $angleVal = document.getElementById(`${prefix}nose-angle-val`)
  const $liftCheckbox = document.getElementById(`${prefix}nose-lift-enabled`)
  $angleSlider.addEventListener('input', () => {
    $angleVal.textContent = $angleSlider.value + '°'
  })
  $liftCheckbox.addEventListener('change', () => {
    $angleSlider.disabled = !$liftCheckbox.checked
    $angleVal.style.opacity = $liftCheckbox.checked ? '1' : '0.3'
  })
}

export function readState(prefix = '') {
  const upgrades = {}
  for (const u of CFG.UPGRADES)
    upgrades[u.key] = +document.getElementById(`${prefix}${u.key}`).value
  const cards = {}
  for (const card of CFG.CARDS) {
    if (card.special) continue
    const el = document.getElementById(`${prefix}card-${card.id}`)
    cards[card.id] = el ? +el.value : 0
  }
  const forsageLevel = +document.getElementById(`${prefix}forsage-lvl`).value
  const throttle = document.getElementById(`${prefix}throttle-select`).value
  const noseLiftEnabled = document.getElementById(`${prefix}nose-lift-enabled`).checked
  const noseLiftAngle = +document.getElementById(`${prefix}nose-angle`).value
  return {
    upgrades,
    cards,
    opts: { forsageLevel, boostThrottle: throttle, noseLiftEnabled, noseLiftAngle },
  }
}

export function loadSave(prefix = '') {
  let raw
  try {
    raw = localStorage.getItem(CFG.SAVE.key)
  } catch (e) {
    alert('Не удалось прочитать localStorage')
    return false
  }
  if (!raw) {
    alert(
      `Сохранение не найдено (ключ "${CFG.SAVE.key}").\n` +
        'Запустите игру хотя бы раз, чтобы оно появилось.'
    )
    return false
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    alert('Сохранение повреждено (не JSON)')
    return false
  }
  if (!data || typeof data !== 'object') {
    alert('Сохранение повреждено (пустой объект)')
    return false
  }

  if (data.upgrades && typeof data.upgrades === 'object') {
    for (const u of CFG.UPGRADES) {
      const v = data.upgrades[u.key]
      if (typeof v !== 'number' || !isFinite(v)) continue
      const maxLvl = u.maxLevel ?? 12
      const clamped = Math.max(1, Math.min(maxLvl, Math.floor(v)))
      const input = document.getElementById(`${prefix}${u.key}`)
      if (!input) continue
      input.value = String(clamped)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }

  const cardLimit = CFG.CHESTS.cardTypeLimit
  const saveCards = data.cards && typeof data.cards === 'object' ? data.cards : {}
  for (const card of CFG.CARDS) {
    if (card.special) continue
    const input = document.getElementById(`${prefix}card-${card.id}`)
    if (!input) continue
    const v = saveCards[card.id]
    const clamped =
      typeof v === 'number' && isFinite(v) && v > 0 ? Math.min(cardLimit, Math.floor(v)) : 0
    input.value = String(clamped)
  }

  const forsageSelect = document.getElementById(`${prefix}forsage-lvl`)
  if (forsageSelect) {
    const v = saveCards.forsage
    const maxLvl = CFG.ABILITIES.forsage.levels.length
    const clamped =
      typeof v === 'number' && isFinite(v) && v > 0 ? Math.min(maxLvl, Math.floor(v)) : 0
    forsageSelect.value = String(clamped)
  }

  return true
}

/* ================================================================
   «Найти прирост» для карточек — сравнение ОПТИМУМОВ.
   Базовый оптимум кэшируется между кликами по разным карточкам.
================================================================ */

let baseOptCache = { key: null, distance: 0 }
let _gainBusy = false
let _gainDelegationAttached = false

let _calcAllToken = 0

function setAllGainButtonsDisabled(disabled) {
  document.querySelectorAll('.card-gain-btn, .calc-all-btn').forEach((b) => {
    b.disabled = disabled
  })
}

/** Ключ кэша: всё, что реально влияет на оптимум.
 *  boostThrottle / noseLift* переопределяются внутри findOptimumAsync,
 *  поэтому в ключ не входят. */
function cardStateKey(upgrades, cards, opts) {
  return JSON.stringify({ upgrades, cards, forsageLevel: opts.forsageLevel || 0 })
}

async function findBestDistance(upgrades, cards, opts, onProgress) {
  const pool = getOptPool()
  const res = await pool.findOptimum(upgrades, cards, opts, onProgress)
  return res.bestDistance
}

/** Делегирование кликов по кнопкам «Найти прирост» — вешаем один раз. */
function setupGainDelegation() {
  if (_gainDelegationAttached) return
  const $out = document.getElementById('single-results')
  if (!$out) return
  _gainDelegationAttached = true
  $out.addEventListener('click', (e) => {
    const gainBtn = e.target.closest('.card-gain-btn')
    if (gainBtn) {
      handleCardGainClick(gainBtn)
      return
    }
    const allBtn = e.target.closest('.calc-all-btn')
    if (allBtn) handleCalcAllClick(allBtn)
  })
}

async function handleCardGainClick(btn) {
  if (_gainBusy) return
  _gainBusy = true

  const origText = btn.textContent
  setAllGainButtonsDisabled(true)

  try {
    // Свежее состояние из формы: пользователь мог подвигать слайдеры
    // после отрисовки таблицы.
    const { upgrades, cards, opts } = readState('')

    const isForsage = btn.dataset.forsage === '1'
    const cardId = btn.dataset.cardId

    let nextCards = cards
    let nextOpts = opts
    if (isForsage) {
      nextOpts = { ...opts, forsageLevel: (opts.forsageLevel || 0) + 1 }
    } else {
      nextCards = { ...cards, [cardId]: (cards[cardId] || 0) + 1 }
    }

    const t0 = performance.now()

    // ─── 1. Оптимум базового билда (кэш) ───
    const baseKey = cardStateKey(upgrades, cards, opts)
    let baseDist
    if (baseOptCache.key === baseKey) {
      baseDist = baseOptCache.distance
    } else {
      btn.textContent = '⏳ База…'
      baseDist = await findBestDistance(upgrades, cards, opts, (d) => {
        const sec = Math.round((performance.now() - t0) / 1000)
        btn.textContent = `⏳ База · ${d} · ${sec}с`
      })
      baseOptCache = { key: baseKey, distance: baseDist }
    }

    // ─── 2. Оптимум с +1 карточкой ───
    const t1 = performance.now()
    btn.textContent = '⏳ С картой…'
    const nextDist = await findBestDistance(upgrades, nextCards, nextOpts, (d) => {
      const sec = Math.round((performance.now() - t1) / 1000)
      btn.textContent = `⏳ С картой · ${d} · ${sec}с`
    })

    const gain = nextDist - baseDist
    const pct = baseDist > 0 ? (gain / baseDist) * 100 : 0
    const cls = gain > 0 ? 'good' : gain < 0 ? 'bad' : 'neutral'
    const sign = gain >= 0 ? '+' : ''

    const cell = btn.closest('td')
    if (cell && btn.isConnected) {
      cell.innerHTML = `
        <span class="${cls}" style="font-weight:700">${sign}${fmtM(gain)}</span>
        <span class="${cls}" style="font-weight:700;margin-left:6px">(${sign}${pct.toFixed(1)}%)</span>`
      cell.title = `Оптимум базы: ${fmtM(baseDist)} → с картой: ${fmtM(nextDist)}`
    }
  } catch (err) {
    console.error('Не удалось посчитать прирост:', err)
    if (btn.isConnected) {
      btn.textContent = origText
      btn.disabled = false
    }
  } finally {
    _gainBusy = false
    // Кликнутая кнопка могла исчезнуть — остальные вернём в строй.
    setAllGainButtonsDisabled(false)
  }
}

//Просчитать всё
async function handleCalcAllClick(btn) {
  if (_gainBusy) return
  _gainBusy = true
  const token = ++_calcAllToken

  const origText = btn.textContent
  setAllGainButtonsDisabled(true)

  try {
    const { upgrades, cards, opts } = readState('')
    const pool = getOptPool()

    // ─── База (в фоне, параллельно с карточками) ───
    const baseKey = cardStateKey(upgrades, cards, opts)
    const basePromise = (async () => {
      if (baseOptCache.key === baseKey) return baseOptCache.distance
      btn.textContent = '⏳ База…'
      const d = await findBestDistance(upgrades, cards, opts, null)
      baseOptCache = { key: baseKey, distance: d }
      return d
    })()

    // ─── Собираем задачи ───
    const familyCounts = {}
    for (const card of CFG.CARDS) {
      if (card.special) continue
      familyCounts[card.family] = (familyCounts[card.family] || 0) + (cards[card.id] || 0)
    }
    const tasks = []
    for (const card of CFG.CARDS) {
      if (card.special) continue
      const cur = cards[card.id] || 0
      if ((familyCounts[card.family] || 0) >= CFG.CHESTS.cardTypeLimit) continue
      if (card.once && cur >= 1) continue
      tasks.push({
        type: 'card',
        cardId: card.id,
        nextCards: { ...cards, [card.id]: cur + 1 },
        nextOpts: opts,
      })
    }
    const fLvl = opts.forsageLevel || 0
    const fMax = CFG.ABILITIES.forsage.levels.length
    if (fLvl < fMax) {
      tasks.push({
        type: 'forsage',
        nextCards: cards,
        nextOpts: { ...opts, forsageLevel: fLvl + 1 },
      })
    }

    if (tasks.length === 0) {
      btn.textContent = '— нечего считать —'
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = origText
          btn.disabled = false
        }
      }, 1200)
      return
    }

    // ─── Запускаем всё в пул сразу ───
    let done = 0
    const total = tasks.length
    btn.textContent = `⏳ 0/${total}`

    const promises = tasks.map((task) =>
      pool
        .findOptimum(upgrades, task.nextCards, task.nextOpts, null)
        .then(async (res) => {
          const baseDist = await basePromise
          if (token !== _calcAllToken) return // таблицу уже перерисовали — не трогаем
          done++
          btn.textContent = `⏳ ${done}/${total}`
          updateCardCell(task, res.bestDistance, baseDist)
        })
        .catch((err) => {
          console.error('[calcAll] task failed', task, err)
          if (token !== _calcAllToken) return
          done++
          btn.textContent = `⏳ ${done}/${total} (ошибка)`
        })
    )

    // Дожидаемся базы (даже если tasks пусты — там уже может быть reject)
    let baseDist
    try {
      baseDist = await basePromise
    } catch (err) {
      console.error('[calcAll] base failed', err)
      if (btn.isConnected) btn.textContent = '❌ Ошибка базового расчёта'
      return
    }
    void baseDist

    await Promise.all(promises)

    if (token === _calcAllToken && btn.isConnected) {
      btn.textContent = `✅ Готово (${total})`
      setTimeout(() => {
        if (btn.isConnected) {
          btn.textContent = origText
          btn.disabled = false
        }
      }, 1500)
    }
  } catch (err) {
    console.error('[calcAll]', err)
    if (btn.isConnected) {
      btn.textContent = origText
      btn.disabled = false
    }
  } finally {
    _gainBusy = false
    setAllGainButtonsDisabled(false)
  }
}

function updateCardCell(task, nextDist, baseDist) {
  const selector =
    task.type === 'forsage'
      ? '.card-gain-btn[data-forsage="1"]'
      : `.card-gain-btn[data-card-id="${task.cardId}"]`
  const btn = document.querySelector(`#single-results ${selector}`)
  if (!btn) return

  const gain = nextDist - baseDist
  const pct = baseDist > 0 ? (gain / baseDist) * 100 : 0
  const cls = gain > 0 ? 'good' : gain < 0 ? 'bad' : 'neutral'
  const sign = gain >= 0 ? '+' : ''

  const cell = btn.closest('td')
  if (!cell) return
  cell.innerHTML = `
    <span class="${cls}" style="font-weight:700">${sign}${fmtM(gain)}</span>
    <span class="${cls}" style="font-weight:700;margin-left:6px">(${sign}${pct.toFixed(1)}%)</span>`
  cell.title = `Оптимум базы: ${fmtM(baseDist)} → с картой: ${fmtM(nextDist)}`
}

setupGainDelegation()

/* ---------- Рендер результатов ---------- */

function boostEndLabel(result) {
  if (!result.thrustUsed) return 'Тяга не использовалась'
  if (result.boostEndAngle === null) return 'Тяга не отключалась'
  return `Угол в конце тяги: <b>${result.boostEndAngle.toFixed(0)}°</b>`
}

export function renderSingleResult(result, upgrades, cards, opts) {
  _calcAllToken++ //  инвалидирует in-flight «Просчитать всё»
  const $out = document.getElementById('single-results')

  const angleInfo = boostEndLabel(result)
  const timeWarn = result.maxTimeReached
    ? `<br><span style="color:#ffb84d">⚠️ Полёт не завершился за ${result.time.toFixed(
        0
      )} с — результат обрезан</span>`
    : ''

  const strategyLabel = BOOST_LABELS[opts.boostThrottle] || opts.boostThrottle

  $out.innerHTML = `
    <div class="result-box">
      <div class="result-item">
        <div class="result-value">${fmtM(result.distance)}</div>
        <div class="result-label">Дальность</div>
      </div>
      <div class="result-item">
        <div class="result-value">${fmtM(result.maxAltitude)}</div>
        <div class="result-label">Макс. высота</div>
      </div>
      <div class="result-item">
        <div class="result-value">${result.time.toFixed(1)} с</div>
        <div class="result-label">Время полёта</div>
      </div>
    </div>
    <div style="opacity:0.6;font-size:12px;margin-top:8px;text-align:center;line-height:1.6">
      PUSH: <b>${strategyLabel}</b> ·
      Монет: <b style="color:#ffd75e">${Math.floor(result.distance)}</b> ·
      Макс. скорость: <b>${Math.round(result.maxSpeed)} м/с</b> ·
      Топливо сожжено: <b>${result.fuelUsed.toFixed(1)} с</b><br>
      ${angleInfo}${timeWarn}
    </div>`

  const upgradeRows = []
  for (const u of CFG.UPGRADES) {
    const lvl = upgrades[u.key]
    const maxLvl = u.maxLevel ?? 12
    if (lvl >= maxLvl) {
      upgradeRows.push(`<tr>
        <td>${u.icon} ${u.name}</td>
        <td class="num">${lvl}</td>
        <td class="num neutral">MAX</td>
        <td class="num neutral">—</td>
        <td class="num neutral">—</td>
      </tr>`)
      continue
    }
    const cost = CFG.RULES.upgradeCost(u, lvl)
    const nextResult = simulateAdaptive({ ...upgrades, [u.key]: lvl + 1 }, cards, opts)
    const gain = nextResult.distance - result.distance
    const roi = cost > 0 ? (gain / cost) * 1000 : 0
    const cls = roi > 30 ? 'good' : roi > 5 ? '' : 'bad'
    upgradeRows.push(`<tr>
      <td>${u.icon} ${u.name}</td>
      <td class="num">${lvl}</td>
      <td class="num">${fmtCost(cost)}</td>
      <td class="num ${cls}">${gain >= 0 ? '+' : ''}${fmtM(gain)}</td>
      <td class="num ${cls}">${roi.toFixed(1)}</td>
    </tr>`)
  }

  $out.innerHTML += `
    <div class="section-title">Что купить дальше? (следующий уровень)</div>
    <table>
      <thead><tr>
        <th>Апгрейд</th>
        <th style="text-align:right">Ур.</th>
        <th style="text-align:right">Цена</th>
        <th style="text-align:right">Прирост</th>
        <th style="text-align:right">м / 1000💰</th>
      </tr></thead>
      <tbody>${upgradeRows.join('')}</tbody>
    </table>`

  $out.innerHTML += renderCardInfluence(result, upgrades, cards, opts)
  setupGainDelegation() //нужно на случай, если модуль загрузился раньше появления #single-results

  const $charts = document.getElementById('charts-row')
  $charts.style.display = 'grid'
  $charts.innerHTML = `
    <div class="chart-container">
      <div class="chart-title">✈️ Траектория полёта</div>
      ${renderTrajectoryChart(result.trajectory)}
    </div>`
}

export function renderCardInfluence(baseResult, upgrades, cards, opts) {
  const limit = CFG.CHESTS.cardTypeLimit
  const rows = []

  const familyCounts = {}
  for (const card of CFG.CARDS) {
    if (card.special) continue
    familyCounts[card.family] = (familyCounts[card.family] || 0) + (cards[card.id] || 0)
  }

  for (const card of CFG.CARDS) {
    if (card.special) continue
    const cur = cards[card.id] || 0
    const familyAtLimit = (familyCounts[card.family] || 0) >= limit
    const onceBlocked = card.once && cur >= 1
    const displayName = card.variant ? `${card.name} · ${card.variant}` : card.name

    if (familyAtLimit || onceBlocked) {
      rows.push(`<tr>
        <td>${card.icon} ${displayName}</td>
        <td class="num">${cur}</td>
        <td class="num neutral" style="text-align:right">MAX</td>
      </tr>`)
      continue
    }

    rows.push(`<tr>
      <td>${card.icon} ${displayName}</td>
      <td class="num">${cur}</td>
      <td class="num" style="text-align:right">
        <button class="mini-btn card-gain-btn" data-card-id="${card.id}"
          title="Сравнить оптимум текущего билда и билда с +1 этой карточкой. ~1–3 с.">
          🔍 Найти прирост
        </button>
      </td>
    </tr>`)
  }

  const fLvl = opts.forsageLevel || 0
  const fMax = CFG.ABILITIES.forsage.levels.length

  if (fLvl >= fMax) {
    rows.push(`<tr>
      <td>🚀 Форсаж</td>
      <td class="num">${fLvl}/${fMax}</td>
      <td class="num neutral" style="text-align:right">MAX</td>
    </tr>`)
  } else {
    rows.push(`<tr>
      <td>🚀 Форсаж</td>
      <td class="num">${fLvl}/${fMax}</td>
      <td class="num" style="text-align:right">
        <button class="mini-btn card-gain-btn" data-forsage="1"
          title="Сравнить оптимум текущего билда и билда со следующим уровнем форсажа.">
          🔍 Найти прирост
        </button>
      </td>
    </tr>`)
  }

  return `
  <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin:20px 0 10px">
    <div class="section-title" style="margin:0">Влияние карточек (+1 копия · прирост по оптимуму)</div>
    <button class="mini-btn calc-all-btn"
      title="Прогнать все карточки через оптимизацию в фоновом режиме (Web Workers). Займёт несколько секунд.">
      🚀 Просчитать всё
    </button>
  </div>
  <table>
    <thead><tr>
      <th>Карточка</th>
      <th style="text-align:right">Копий</th>
      <th style="text-align:right">Прирост (оптимум)</th>
    </tr></thead>
    <tbody>${rows.join('')}</tbody>
  </table>`
}

export function renderOptimum(optData) {
  const { best, coarseResults, fineResults, noLift } = optData
  const $out = document.getElementById('single-results')

  const gain = best.distance - noLift.distance
  const gainPct = noLift.distance > 0 ? (gain / noLift.distance) * 100 : 0

  // Лучшее по каждой стратегии (coarse + уточнённый для winner)
  const bestByStrategy = {}
  for (const r of coarseResults) {
    if (!bestByStrategy[r.strategy] || r.distance > bestByStrategy[r.strategy].distance) {
      bestByStrategy[r.strategy] = r
    }
  }
  // Уточнение победителя: если fineResult лучше — заменяем
  for (const r of fineResults) {
    if (!bestByStrategy[r.strategy] || r.distance > bestByStrategy[r.strategy].distance) {
      bestByStrategy[r.strategy] = r
    }
  }

  const strategyRows = Object.entries(bestByStrategy)
    .map(([s, r]) => ({ strategy: s, ...r }))
    .sort((a, b) => b.distance - a.distance)

  const strategyRowsHtml = strategyRows
    .map((r, idx) => {
      const isWinner = r.strategy === best.strategy
      return `<tr class="${isWinner ? 'winner' : ''}">
        <td>${isWinner ? '🥇' : ''} ${BOOST_LABELS[r.strategy] || r.strategy}</td>
        <td class="num">${r.angle}°</td>
        <td class="num ${isWinner ? 'good' : ''}">${fmtM(r.distance)}</td>
      </tr>`
    })
    .join('')

  const truncCount = [...coarseResults, ...fineResults].filter((r) => r.truncated).length
  const timeWarn =
    truncCount > 0
      ? `<div style="color:#ffb84d;font-size:11px;margin-top:6px">⚠️ ${truncCount} симуляций обрезаны по времени</div>`
      : ''

  const bestStrategyLabel = BOOST_LABELS[best.strategy] || best.strategy

  $out.innerHTML = `
    <div class="opt-summary">
      <div class="big">🎯 Оптимум: ${best.angle}°</div>
      <div class="sub">
        Самое эффективное управление:
        <b style="color:#ffd75e">${bestStrategyLabel}</b>
      </div>
      <div class="sub">Дальность: <b style="color:#c38bff">${fmtM(best.distance)}</b></div>
      <div class="sub">
        Без подъёма: ${fmtM(noLift.distance)}
        · <span class="gain">${gain >= 0 ? '+' : ''}${fmtM(gain)} (${gainPct > 0 ? '+' : ''}${gainPct.toFixed(1)}%)</span>
      </div>
      ${timeWarn}
    </div>

    <div class="result-box" style="margin-top:12px">
      <div class="result-item">
        <div class="result-value purple">${fmtM(best.distance)}</div>
        <div class="result-label">Дальность (оптимум)</div>
      </div>
      <div class="result-item">
        <div class="result-value">${fmtM(best.result.maxAltitude)}</div>
        <div class="result-label">Макс. высота</div>
      </div>
      <div class="result-item">
        <div class="result-value">${best.result.time.toFixed(1)} с</div>
        <div class="result-label">Время полёта</div>
      </div>
    </div>

    <div style="opacity:0.6;font-size:12px;margin-top:8px;text-align:center;line-height:1.6">
      Монет: <b style="color:#ffd75e">${Math.floor(best.distance)}</b> ·
      Макс. скорость: <b>${Math.round(best.result.maxSpeed)} м/с</b> ·
      Топливо сожжено: <b>${best.result.fuelUsed.toFixed(1)} с</b><br>
      ${boostEndLabel(best.result)}
    </div>

    <div class="section-title">Сравнение стратегий (лучший угол для каждой)</div>
    <table>
      <thead><tr>
        <th>Стратегия</th>
        <th style="text-align:right">Лучший угол</th>
        <th style="text-align:right">Дальность</th>
      </tr></thead>
      <tbody>${strategyRowsHtml}</tbody>
    </table>`

  // ── Графики ──
  // Траектория оптимума + кривая «дальность vs угол» для победившей стратегии.
  const chartPoints = [...coarseResults.filter((r) => r.strategy === best.strategy), ...fineResults]
    .sort((a, b) => a.angle - b.angle)
    .map((r) => ({ angle: r.angle, distance: r.distance }))

  const $charts = document.getElementById('charts-row')
  $charts.style.display = 'grid'
  $charts.innerHTML = `
    <div class="chart-container">
      <div class="chart-title">✈️ Траектория (оптимум ${best.angle}°, ${bestStrategyLabel})</div>
      ${renderTrajectoryChart(best.result.trajectory)}
    </div>
    <div class="chart-container">
      <div class="chart-title">📈 Дальность vs угол (${bestStrategyLabel})</div>
      ${renderAngleChart(chartPoints, best)}
    </div>`
}

export function renderCompare(resA, resB) {
  const $out = document.getElementById('cmp-results')
  const diff = resB.distance - resA.distance
  const diffPct = resA.distance > 0 ? (diff / resA.distance) * 100 : 0
  const diffCls = Math.abs(diffPct) < 0.5 ? 'neutral' : diff > 0 ? 'good' : 'bad'

  $out.innerHTML = `
    <div class="result-box" style="grid-template-columns: repeat(3, 1fr)">
      <div class="result-item">
        <div class="result-value">${fmtM(resA.distance)}</div>
        <div class="result-label">A</div>
      </div>
      <div class="result-item">
        <div class="result-value">${fmtM(resB.distance)}</div>
        <div class="result-label">B</div>
      </div>
      <div class="result-item">
        <div class="result-value ${diffCls}">${diff > 0 ? '+' : ''}${fmtM(diff)}<br>
          <span style="font-size:18px">${diffPct > 0 ? '+' : ''}${diffPct.toFixed(1)}%</span>
        </div>
        <div class="result-label">B относительно A</div>
      </div>
    </div>
    <table style="margin-top:16px">
      <thead><tr><th></th><th style="text-align:right">A</th><th style="text-align:right">B</th></tr></thead>
      <tbody>
        <tr><td>Дальность</td><td class="num">${fmtM(resA.distance)}</td><td class="num">${fmtM(resB.distance)}</td></tr>
        <tr><td>Макс. высота</td><td class="num">${fmtM(resA.maxAltitude)}</td><td class="num">${fmtM(resB.maxAltitude)}</td></tr>
        <tr><td>Время полёта</td><td class="num">${resA.time.toFixed(1)} с</td><td class="num">${resB.time.toFixed(1)} с</td></tr>
        <tr><td>Макс. скорость</td><td class="num">${Math.round(resA.maxSpeed)} м/с</td><td class="num">${Math.round(resB.maxSpeed)} м/с</td></tr>
      </tbody>
    </table>`
}

export function buildCompareColumn(containerId, prefix) {
  const $c = document.getElementById(containerId)
  $c.innerHTML = ''

  const $upg = document.createElement('div')
  $upg.id = `${containerId}-upg`
  $c.appendChild($upg)
  buildUpgradeInputs(`${containerId}-upg`, prefix)

  const $cards = document.createElement('div')
  $cards.id = `${containerId}-cards`
  $cards.style.marginTop = '12px'
  $c.appendChild($cards)
  buildCardInputs(`${containerId}-cards`, prefix)

  const $opts = document.createElement('div')
  $opts.id = `${containerId}-opts`
  $opts.style.marginTop = '12px'
  $c.appendChild($opts)
  buildOptsInputs(`${containerId}-opts`, prefix)
}
