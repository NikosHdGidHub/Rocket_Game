/* ================================================================
   cardPopup.js — попап выбора карточки.
================================================================ */
import { G } from '../state.js'
import * as CardsModal from './cardsModal.js'

let _currentCardCloseHandler = null

export function showCardChoices(cards, onPick, opts = {}) {
  CardsModal.close()

  const $popup = document.getElementById('cardPopup')
  const $container = document.getElementById('cardChoices')
  if (!$popup || !$container) return

  if (_currentCardCloseHandler) {
    $popup.removeEventListener('click', _currentCardCloseHandler)
    _currentCardCloseHandler = null
  }

  $container.innerHTML = ''
  const single = cards.length === 1

  for (const card of cards) {
    const el = createCardElement(card, single, opts)
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      closeCardPopup()
      onPick(card)
    })
    $container.appendChild(el)
  }

  $popup.classList.add('on')

  if (single) {
    _currentCardCloseHandler = () => {
      closeCardPopup()
      onPick(cards[0])
    }
    $popup.addEventListener('click', _currentCardCloseHandler)
  }
}

function closeCardPopup() {
  const $popup = document.getElementById('cardPopup')
  if ($popup) $popup.classList.remove('on')
  if (_currentCardCloseHandler && $popup) {
    $popup.removeEventListener('click', _currentCardCloseHandler)
    _currentCardCloseHandler = null
  }
}

function createCardElement(card, isSingle, opts = {}) {
  const isUpgrade =
    opts.isUpgradeOverride !== undefined ? opts.isUpgradeOverride : (G.cards[card.id] || 0) >= 1

  const el = document.createElement('div')
  el.className = 'card'
  if (card.color != null) {
    el.style.borderColor = '#' + card.color.toString(16).padStart(6, '0')
  }

  let label
  if (isSingle) label = isUpgrade ? 'УЛУЧШЕНИЕ' : 'РЕДКАЯ НАХОДКА'
  else label = 'ВЫБЕРИ КАРТУ'

  let effectsHtml = ''
  if (card.special) {
    const descText = isUpgrade && card.desc_upgrade ? card.desc_upgrade : card.desc_buff
    if (descText) effectsHtml = `<div class="card-buff">${descText}</div>`
  } else {
    if (card.desc_buff) effectsHtml += `<div class="card-buff">▲ ${card.desc_buff}</div>`
    if (card.desc_debuff) effectsHtml += `<div class="card-debuff">▼ ${card.desc_debuff}</div>`
  }

  const hint = isSingle ? 'тап — закрыть' : 'тап — выбрать'

  el.innerHTML = `
    <div class="card-glow"></div>
    <div class="card-label">${label}</div>
    <div class="card-icon">${card.icon}</div>
    <div class="card-name">${card.name}</div>
    ${card.variant ? `<div class="card-variant">${card.variant}</div>` : ''}
    <div class="card-effects">${effectsHtml}</div>
    <div class="card-hint">${hint}</div>
  `
  return el
}
