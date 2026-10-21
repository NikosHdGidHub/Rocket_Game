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
export function init() {
  if (_initialized) return
  _initialized = true

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
  return CFG.CARDS.filter((c) => c.family === family).reduce(
    (s, c) => s + (G.cards[c.id] || 0),
    0
  )
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
  renderSummary()
  renderList()
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

  // Бейдж «(×N)» перед именем — только когда получена
  const badge = count > 0 ? `<span class="card-row-count">(×${count})</span>` : ''

  // Тело: описание или эффекты
  let bodyHtml = ''
  if (card.special) {
    // Форсаж — способность, не числовые effects
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
      // «→ ×4» — только если текущее число копий > 1
      let totalPart = ''
      if (count > 1) {
        const total = Math.pow(eff.mult, count)
        totalPart = ` → ${formatMult(total)}`
      }
      bodyHtml += `<div class="card-row-effect ${cls}">${arrow} ${label.icon} ${label.name} ${baseStr}${totalPart}</div>`
    }
  }

  row.innerHTML = `
    <div class="card-row-icon">${card.icon}</div>
    <div class="card-row-main">
      <div class="card-row-name">
        ${badge}
        <span>${card.name}${card.variant ? ' · ' + card.variant : ''}</span>
      </div>
      ${bodyHtml}
    </div>
  `
  return row
}