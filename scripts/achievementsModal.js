/* ================================================================
   achievementsModal.js — модалка достижений с табами.
================================================================ */
import { ACHIEVEMENTS, A, isSprintFailed, sprintRemainingSec } from './achievements.js'

let _initialized = false
let _currentTab = 'all' // 'all' | 'progress' | 'done'

export function init() {
  if (_initialized) return
  _initialized = true

  const $panel = document.getElementById('achievementsPanel')
  const $close = document.getElementById('achievementsClose')
  const $tabs = document.querySelectorAll('.ach-tab')

  $close.addEventListener('click', (e) => {
    e.stopPropagation()
    close()
  })
  $panel.addEventListener('click', (e) => {
    if (e.target === $panel) close()
  })

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
  document.getElementById('achievementsPanel').classList.add('on')
  render()
}

export function close() {
  document.getElementById('achievementsPanel').classList.remove('on')
}

/* ================================================================
   RENDER
================================================================ */
function buildItems() {
  return ACHIEVEMENTS.map((a) => {
    const unlocked = A.unlocked.has(a.key)
    const failed = a.key === 'sprinter' && !unlocked && isSprintFailed()

    if (a.steps) {
      const doneCount = a.steps.filter((_, i) => A.stepUnlocked.has(a.key + ':' + i)).length
      return {
        def: a,
        unlocked,
        failed,
        steps: a.steps,
        doneCount,
        total: a.steps.length,
        // Для сортировки: доля выполненных этапов
        ratio: doneCount / a.steps.length,
      }
    }

    const target = a.target || 0
    const raw = A.progress[a.key] || 0
    const cur = target > 0 ? Math.min(raw, target) : raw
    return {
      def: a,
      unlocked,
      failed,
      cur,
      target,
      ratio: target > 0 ? cur / target : unlocked ? 1 : 0,
    }
  })
}

function render() {
  const $list = document.getElementById('achList')
  if (!$list) return

  const items = buildItems()

  let shown
  if (_currentTab === 'done') shown = items.filter((a) => a.unlocked)
  else if (_currentTab === 'progress') shown = items.filter((a) => !a.unlocked && !a.failed)
  else shown = items

  const rank = (a) => {
    if (a.unlocked) return 2
    if (a.failed) return 3
    return a.ratio > 0 ? 0 : 1
  }
  shown.sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    return b.ratio - a.ratio
  })

  $list.innerHTML = ''
  for (const a of shown) $list.appendChild(renderRow(a))
}

function renderRow(item) {
  const { def: a, unlocked, failed } = item
  const row = document.createElement('div')
  const cls = ['ach-row', 'tier-' + a.tier]
  if (unlocked) cls.push('unlocked')
  if (failed) cls.push('failed')
  row.className = cls.join(' ')

  if (a.steps) {
    row.innerHTML = `
      <div class="ach-icon">${a.icon}</div>
      <div class="ach-main">
        <div class="ach-name">
          ${a.name}
          <span class="ach-count">${item.doneCount}/${item.total}</span>
        </div>
        <div class="ach-desc">${a.desc}</div>
        <div class="ach-steps">${renderSteps(a, item)}</div>
      </div>`
    return row
  }

  const hasProgress = item.target > 0
  const pct = hasProgress ? Math.min(100, (item.cur / item.target) * 100) : unlocked ? 100 : 0

  let progressLine = ''
  if (hasProgress) {
    progressLine = formatProgress(a, item.cur, item.target)
  } else if (unlocked) {
    progressLine = '✓ Выполнено'
  }

  let extra = ''
  if (a.key === 'sprinter' && !unlocked) {
    if (failed) extra = 'Время истекло'
    else if (A.sprintStart) extra = formatTime(sprintRemainingSec())
  }

  row.innerHTML = `
    <div class="ach-icon">${a.icon}</div>
    <div class="ach-main">
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${a.desc}</div>
      ${
        hasProgress
          ? `<div class="ach-track"><div class="ach-fill" style="width:${pct.toFixed(1)}%"></div></div>`
          : ''
      }
      ${
        progressLine || extra
          ? `<div class="ach-progress">${progressLine}${progressLine && extra ? ' · ' : ''}${extra}</div>`
          : ''
      }
    </div>`
  return row
}

function renderSteps(a, item) {
  const progress = A.progress[a.key] || 0
  let html = ''
  for (let i = 0; i < a.steps.length; i++) {
    const s = a.steps[i]
    const done = A.stepUnlocked.has(a.key + ':' + i)
    const pct = done ? 100 : Math.min(100, (progress / s.target) * 100)
    html += `
      <div class="ach-step${done ? ' done' : ''}">
        <div class="ach-step-label">${s.label}</div>
        <div class="ach-step-track">
          <div class="ach-step-fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
        <div class="ach-step-mark">${done ? '✓' : ''}</div>
      </div>`
  }
  return html
}

/* ================================================================
   ХЕЛПЕРЫ
================================================================ */
function formatProgress(a, cur, next) {
  if (a.unit === 'm') return `${fmtMeters(cur)} / ${fmtMeters(next)}`
  return `${Math.floor(cur)} / ${Math.floor(next)}`
}

function fmtMeters(m) {
  if (m < 1000) return Math.round(m) + ' м'
  return (m / 1000).toFixed(0) + ' км'
}

function formatTime(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
