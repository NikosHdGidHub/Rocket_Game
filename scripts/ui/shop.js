/* ================================================================
   shop.js — магазин апгрейдов в нижней панели.
================================================================ */
import { G } from '../state.js'

const $shop = document.getElementById('shop')

let _onBuy = null
let _upgrades = []
let _costOf = () => 0

export function init({ onBuy, upgrades, costOf }) {
  _onBuy = onBuy
  _upgrades = upgrades
  _costOf = costOf
}

export function renderShop() {
  $shop.innerHTML = ''
  for (const u of _upgrades) {
    const lvl = G.upgrades[u.key]
    const max = u.maxLevel ?? Infinity
    const isMax = lvl >= max
    const cost = isMax ? 0 : _costOf(u)
    const can = !isMax && G.coins >= cost

    const btn = document.createElement('button')
    btn.className = 'upg' + (can ? '' : ' disabled') + (isMax ? ' maxed' : '')
    btn.disabled = isMax
    btn.innerHTML = `
      <div class="u-main">
        <div class="u-name">
          <span class="u-lvl">${lvl}</span>
          <span class="u-icon">${u.icon}</span>
          <span class="u-title">${u.name}</span>
        </div>
        <div class="u-desc">${isMax ? 'Максимум' : u.desc}</div>
      </div>
      <div class="u-cost">${isMax ? 'MAX' : cost + ' 💲'}</div>`
    btn.addEventListener('click', () => _onBuy && _onBuy(u))
    $shop.appendChild(btn)
  }
}
