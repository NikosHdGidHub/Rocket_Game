/* ================================================================
   cardsModal.js — модалка карточек с их влиянием.

   Показывает:
   - итоговые множители по всем статам (сводка сверху);
   - список всех карточек с текущим счётчиком (×1, ×2, —);
   - отдельно по каждой карте: «▲ Топливо ×2 → ×4» для текущего count.

   Табы: Все / Полученные / Доступные.
   На открытии всегда перерисовывается — это простой и надёжный путь.
================================================================ */
import * as CFG from './config.js'
import { G } from './state.js'

let _callbacks = {}
let _initialized = false
let _currentTab = 'all'
let _isOpen = false

/* ---------- Подписи статов для UI ---------- */
const STAT_LABELS = {
  maxFuel: { icon: '⛽', name: 'Топливо' },
  thrustAcc: { icon: '🔥', name: 'Тяга' },
  drag: { icon: '💨', name: 'Сопротивление' },
  launchSpeed: { icon: '🦵', name: 'Сила пинка' },
  forsageThrust: { icon: '🚀', name: 'Тяга в форсаже' },
  gravity: { icon: '🌍', name: 'Гравитация' },
}

/* ================================================================
   INIT / OPEN / CLOSE / REFRESH
================================================================ */
export function init(callbacks = {}) {
  if (_initialized) return
  _initialized = true
  _callbacks = callbacks

  const $panel = document.getElementById('cardsPanel')
  const $close = document.getElementById('cardsClose')
  const $btn = document.getElementById('cardsBtn')
  const $tabs = document.querySelectorAll('.cards-tab')

  if ($btn) {
    $btn.addEventListener('click', (e) => {
      e.stopPropagation()
      open()
    })
  }
  if ($close) {
    $close.addEventListener('click', (e) => {
      e.stopPropagation()
      close()
    })
  }
  if ($panel) {
    $panel.addEventListener('click', (e) => {
      if (e.target === $panel) close()
    })
  }
  $tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      $tabs.forEach((t) => t.classList.remove('active'))
      tab.classList.add('active')
      _currentTab = tab.dataset.tab
      render()
    })
  })
}

export function open() {
  const $panel = document.getElementById('cardsPanel')
  if (!$panel) return
  $panel.classList.add('on')
  _isOpen = true
  render()
}

export function close() {
  const $panel = document.getElementById('cardsPanel')
  if ($panel) $panel.classList.remove('on')
  _isOpen = false
}

/** Вызвать после изменения G.cards, чтобы обновить открытую модалку. */
export function refresh() {
  if (_isOpen) render()
}

/* ================================================================
   ХЕЛПЕРЫ
================================================================ */
function formatMult(v) {
  if (Math.abs(v - Math.round(v)) < 0.01) return '×' + Math.round(v)
  if (v >= 10) return '×' + v.toFixed(1)
  return '×' + v.toFixed(2)
}

function isNeutral(v) {
  return Math.abs(v - 1) < 0.001
}

/** Для drag: меньше = лучше. Для остальных: больше = лучше. */
function statColor(stat, v) {
  if (isNeutral(v)) return 'neutral'
  const better = stat === 'drag' ? v < 1 : v > 1
  return better ? 'good' : 'bad'
}

function collectAllStats() {
  const stats = new Set()
  for (const card of CFG.CARDS) {
    if (!card.effects) continue
    for (const eff of card.effects) stats.add(eff.stat)
  }
  return [...stats]
}

function totalMultiplier(stat) {
  let m = 1
  for (const [id, count] of Object.entries(G.cards)) {
    if (!count) continue
    const card = CFG.CARDS.find((c) => c.id === id)
    if (!card || !card.effects) continue
    for (const eff of card.effects) {
      if (eff.stat === stat) m *= Math.pow(eff.mult, count)
    }
  }
  return m
}

function getFamilyCount(family) {
  return CFG.CARDS.filter((c) => c.family === family).reduce((s, c) => s + (G.cards[c.id] || 0), 0)
}

function cardIsAvailable(card) {
  if (card.special) return false
  if (card.once && (G.cards[card.id] || 0) >= 1) return false
  if (card.condition === 'forsage' && (G.cards.forsage || 0) < 1) return false
  if (getFamilyCount(card.family) >= CFG.CHESTS.cardTypeLimit) return false
  return true
}

/* ================================================================
   RENDER — сводка сверху + список карт
================================================================ */
function render() {
  renderGemsCounter()
  renderSummary()
  renderList()
}

function renderGemsCounter() {
  const $c = document.getElementById('cardsGemsCount')
  if ($c) $c.textContent = G.gems
}

/* ---------- Итоговые множители ---------- */
function renderSummary() {
  const $summary = document.getElementById('cardsSummary')
  if (!$summary) return

  const stats = collectAllStats()
  if (stats.length === 0) {
    $summary.innerHTML = ''
    $summary.style.display = 'none'
    return
  }

  const hasAnyCard = Object.values(G.cards).some((n) => n > 0)
  if (!hasAnyCard) {
    $summary.style.display = 'block'
    $summary.innerHTML =
      '<div class="cards-summary-empty">Пока нет карточек — соберите первый сундук!</div>'
    return
  }

  $summary.style.display = 'block'
  let html = '<div class="cards-summary-title">Итоговые множители</div>'
  html += '<div class="cards-summary-grid">'

  for (const stat of stats) {
    const label = STAT_LABELS[stat] || { icon: '❓', name: stat }
    const total = totalMultiplier(stat)
    const cls = statColor(stat, total)
    const valStr = isNeutral(total) ? '×1' : formatMult(total)
    html += `
      <div class="cards-summary-item ${cls}">
        <div class="cards-summary-stat">${label.icon} ${label.name}</div>
        <div class="cards-summary-val">${valStr}</div>
      </div>`
  }
  html += '</div>'
  $summary.innerHTML = html
}

/* ---------- Список карточек ---------- */
function filterCards() {
  if (_currentTab === 'received') {
    return CFG.CARDS.filter((c) => (G.cards[c.id] || 0) > 0)
  }
  if (_currentTab === 'available') {
    return CFG.CARDS.filter(cardIsAvailable)
  }
  return CFG.CARDS
}

function renderList() {
  const $list = document.getElementById('cardsList')
  if (!$list) return

  const cards = filterCards()
  const scrollTop = $list.scrollTop

  if (cards.length === 0) {
    let msg = 'Здесь пусто'
    if (_currentTab === 'received') msg = 'Пока ни одной карточки не собрано'
    else if (_currentTab === 'available') msg = 'Все карточки получены (или заблокированы)'
    $list.innerHTML = `<div class="cards-empty">${msg}</div>`
    return
  }

  $list.innerHTML = ''
  for (const card of cards) $list.appendChild(renderCard(card))
  $list.scrollTop = scrollTop
}

function renderCard(card) {
  const count = G.cards[card.id] || 0
  const isReceived = count > 0
  const row = document.createElement('div')
  row.className = 'card-row ' + (isReceived ? 'received' : 'not-received')

  if (card.color != null) {
    const hex = card.color.toString(16).padStart(6, '0')
    row.style.borderColor = '#' + hex + '55'
  }

  const badge = count > 0 ? `<span class="card-row-count">(×${count})</span>` : ''

  let bodyHtml = ''
  if (card.special) {
    const descText = isReceived ? card.desc_upgrade || card.desc_buff : card.desc_buff
    bodyHtml = `<div class="card-row-desc">${descText}</div>`
    if (isReceived) {
      const maxLv = CFG.ABILITIES.forsage.levels.length
      bodyHtml += `<div class="card-row-effect buff">▲ Уровень ${count}/${maxLv}</div>`
    }
  } else if (card.effects) {
    for (const eff of card.effects) {
      const label = STAT_LABELS[eff.stat] || { icon: '❓', name: eff.stat }
      const cls = eff.isBuff ? 'buff' : 'debuff'
      const arrow = eff.isBuff ? '▲' : '▼'
      const baseStr = formatMult(eff.mult)
      let totalPart = ''
      if (count > 1) {
        const total = Math.pow(eff.mult, count)
        totalPart = ` → ${formatMult(total)}`
      }
      bodyHtml += `<div class="card-row-effect ${cls}">${arrow} ${label.icon} ${label.name} ${baseStr}${totalPart}</div>`
    }
  }

  // NEW: кнопки покупки/продажи
  const actionsHtml = buildActionsHtml(card, count)

  row.innerHTML = `
    <div class="card-row-icon">${card.icon}</div>
    <div class="card-row-main">
      <div class="card-row-name">
        ${badge}
        <span>${card.name}${card.variant ? ' · ' + card.variant : ''}</span>
      </div>
      ${bodyHtml}
    </div>
    ${actionsHtml ? `<div class="card-row-actions">${actionsHtml}</div>` : ''}
  `

  wireTradeButtons(row, card)

  return row
}

function escAttr(s) {
  return String(s).replace(/"/g, '&quot;')
}

function buildActionsHtml(card, count) {
  const showBuy = card.buyFlag !== false && card.buyPrice > 0
  const showSell = card.sellFlag !== false && card.sellPrice > 0 && count > 0
  if (!showBuy && !showSell) return ''

  let html = ''

  if (showBuy) {
    const reason = _callbacks.canBuy?.(card.id)
    const dis = reason ? 'disabled' : ''
    const tip = reason ? `title="${escAttr(reason)}"` : ''
    html += `<button class="card-trade-btn buy" data-action="buy" ${dis} ${tip}>Купить ${card.buyPrice} 💎</button>`
  }
  if (showSell) {
    const reason = _callbacks.canSell?.(card.id)
    const dis = reason ? 'disabled' : ''
    const tip = reason ? `title="${escAttr(reason)}"` : ''
    html += `<button class="card-trade-btn sell" data-action="sell" ${dis} ${tip}>Продать ${card.sellPrice} 💎</button>`
  }
  return html
}

function wireTradeButtons(row, card) {
  const buyBtn = row.querySelector('.card-trade-btn.buy')
  const sellBtn = row.querySelector('.card-trade-btn.sell')

  if (buyBtn && !buyBtn.disabled) {
    buyBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleBuy(card)
    })
  }
  if (sellBtn && !sellBtn.disabled) {
    sellBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      handleSell(card)
    })
  }
}

/* ================================================================
   TRADE: покупка / продажа
================================================================ */
function getTradePreview(card, delta) {
  if (!_callbacks.getTradePreview) return null
  return _callbacks.getTradePreview(card.id, delta)
}

function buildTradeConfirm(card, delta) {
  const price = delta > 0 ? card.buyPrice : card.sellPrice
  const preview = getTradePreview(card, delta) || {
    curCount: 0,
    newCount: 0,
    effects: [],
  }
  const name = card.variant ? `${card.name} · ${card.variant}` : card.name

  const title = delta > 0 ? `Купить «${name}» за ${price} 💎?` : `Продать «${name}» за ${price} 💎?`

  const lines = [title, '']

  if (preview.effects.length > 0) {
    lines.push(`Количество: ×${preview.curCount} → ×${preview.newCount}`)
    for (const e of preview.effects) {
      const label = STAT_LABELS[e.stat] || { icon: '❓', name: e.stat }
      lines.push(`${label.icon} ${label.name}: ${formatMult(e.before)} → ${formatMult(e.after)}`)
    }
    lines.push('')
  }

  const gemsBefore = G.gems
  const gemsAfter = delta > 0 ? G.gems - price : G.gems + price
  lines.push(`Гемов: ${gemsBefore} → ${gemsAfter}`)

  return lines.join('\n')
}

function handleBuy(card) {
  const reason = _callbacks.canBuy?.(card.id)
  if (reason) {
    alert(reason)
    return
  }

  const msg = buildTradeConfirm(card, +1)
  if (!confirm(msg)) return

  const res = _callbacks.onBuy?.(card.id)
  if (!res?.ok) alert(res?.reason || 'Не удалось купить')
}

function handleSell(card) {
  const reason = _callbacks.canSell?.(card.id)
  if (reason) {
    alert(reason)
    return
  }

  const msg = buildTradeConfirm(card, -1)
  if (!confirm(msg)) return

  const res = _callbacks.onSell?.(card.id)
  if (!res?.ok) alert(res?.reason || 'Не удалось продать')
}
