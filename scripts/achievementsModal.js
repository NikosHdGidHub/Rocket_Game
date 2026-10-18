/* ================================================================
   achievementsModal.js — модалка достижений с табами.
================================================================ */
import { ACHIEVEMENTS, A, isTimeLimitedFailed, timeLimitedRemainingSec } from './achievements.js'
import { time } from './state.js'

let _initialized = false
let _currentTab = 'all' // 'all' | 'progress' | 'done'
let _isOpen = false
let _refreshTimer = null

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
  _isOpen = true
  render()
  startRefreshTimer()
}

export function close() {
  document.getElementById('achievementsPanel').classList.remove('on')
  _isOpen = false
  stopRefreshTimer()
}

/* Раз в секунду — перерисовка, пока модалка открыта.
   Нужно, чтобы тикали живые таймеры (например, Спринтер). */
function startRefreshTimer() {
  if (_refreshTimer) return
  _refreshTimer = setInterval(() => {
    if (!_isOpen) return
    render()
  }, 1000)
}

function stopRefreshTimer() {
  if (_refreshTimer) {
    clearInterval(_refreshTimer)
    _refreshTimer = null
  }
}

/* ================================================================
   RENDER
================================================================ */
function buildItems() {
  return ACHIEVEMENTS.map((a) => {
    const unlocked = A.unlocked.has(a.key)
    const failed = a.timeLimit != null && !unlocked && isTimeLimitedFailed(a.key)

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

  // Обновляем таймер сессии
  const $timer = document.getElementById('achSessionTimer')
  if ($timer) {
    const total = time.totalPlaytime + time.gameTime
    $timer.textContent = `Времени от начала забега: ${formatTimeLong(total)}`
  }

  const scrollTop = $list.scrollTop
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

  $list.scrollTop = scrollTop // ← возвращаем
}

function renderRow(item) {
  const { def: a, unlocked, failed } = item
  const row = document.createElement('div')
  const cls = ['ach-row', 'tier-' + a.tier]
  if (unlocked) cls.push('unlocked')
  if (failed) cls.push('failed')
  row.className = cls.join(' ')

  /* ---------- Прогрессивные по этапам ---------- */
  if (a.steps) {
    row.innerHTML = `
      <div class="ach-icon">${a.icon}</div>
      <div class="ach-main">
        <div class="ach-name">
          ${a.name}
          <span class="ach-count">${item.doneCount}/${item.total}</span>
        </div>
        <div class="ach-desc">${a.desc}</div>
        ${unlocked ? renderAllStepsDone(a) : renderCurrentStep(a)}
      </div>`
    return row
  }

  /* ---------- Обычные (одиночная цель или без цели) ---------- */
  const hasProgress = item.target > 0
  const pct = hasProgress ? Math.min(100, (item.cur / item.target) * 100) : unlocked ? 100 : 0

  let progressLine = ''
  if (unlocked && hasProgress) {
    // 5 / 5 · ✓ Выполнено
    progressLine = `${Math.floor(item.cur)} / ${Math.floor(item.target)} - ✓ Выполнено`
  } else if (hasProgress) {
    progressLine = formatProgress(a, item.cur, item.target)
  } else if (unlocked) {
    progressLine = '✓ Выполнено'
  }

  let extra = ''
  if (a.timeLimit != null && !unlocked) {
    if (failed) extra = 'Время истекло'
    else if (A.startTimes[a.key]) extra = formatTime(timeLimitedRemainingSec(a.key))
  }

  row.innerHTML = `
    <div class="ach-icon">${a.icon}</div>
    <div class="ach-main">
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${a.desc}</div>
      ${
        hasProgress && !unlocked
          ? `<div class="ach-track"><div class="ach-fill" style="width:${pct.toFixed(1)}%"></div></div>`
          : ''
      }
      ${
        progressLine || extra
          ? `<div class="ach-progress${unlocked ? ' done' : ''}">${progressLine}${progressLine && extra ? ' · ' : ''}${extra}</div>`
          : ''
      }
    </div>`
  return row
}

/* Показываем ТОЛЬКО текущий (первый невыполненный) этап.
   Прогрессбар считается ОТ предыдущего этапа:
     1 км → 0%,  3 км → 100% (для этапа «3 км», если «1 км» уже взят). */
function renderCurrentStep(a) {
  const progress = A.progress[a.key] || 0
  let idx = a.steps.findIndex((_, i) => !A.stepUnlocked.has(a.key + ':' + i))
  if (idx === -1) idx = a.steps.length - 1

  const s = a.steps[idx]
  const done = A.stepUnlocked.has(a.key + ':' + idx)

  const prevTarget = idx > 0 ? a.steps[idx - 1].target : 0
  const range = Math.max(1, s.target - prevTarget)
  const localProgress = done ? 1 : Math.max(0, Math.min(1, (progress - prevTarget) / range))
  const pct = localProgress * 100

  const displayCur = Math.min(progress, s.target)
  const valueText = formatStepProgress(a, displayCur, s.target)

  return `
    <div class="ach-steps">
      <div class="ach-step${done ? ' done' : ''}">
        <div class="ach-step-head">
          <span class="ach-step-label">${s.label}</span>
          <span class="ach-step-value">${done ? '✓ ' : ''}${valueText}</span>
        </div>
        <div class="ach-step-track">
          <div class="ach-step-fill" style="width:${pct.toFixed(1)}%"></div>
        </div>
      </div>
    </div>`
}

/* Показываем ВСЕ этапы как «<label>  ✓ Выполнено». */
function renderAllStepsDone(a) {
  let html = ''
  for (let i = 0; i < a.steps.length; i++) {
    html += `
      <div class="ach-step-done">
        <span class="ach-step-done-label">${a.steps[i].label}</span>
        <span class="ach-step-done-mark">✓ Выполнено</span>
      </div>`
  }
  return `<div class="ach-steps-done">${html}</div>`
}

/* ================================================================
   ХЕЛПЕРЫ
================================================================ */
/* Формат строки прогресса для многоэтапных ачивок. */
function formatStepProgress(a, cur, target) {
  if (a.unit === 'm') {
    return `${fmtMetersLocal(cur)} / ${fmtMetersLocal(target)}`
  }
  return `${Math.floor(cur)} / ${Math.floor(target)} раз`
}

/* Компактный формат метров: 950 м, 1 км, 1.3 км, 200 км */
function fmtMetersLocal(m) {
  if (m < 1000) return Math.round(m) + ' м'
  const v = m / 1000
  return (v % 1 === 0 ? v.toFixed(0) : v.toFixed(1)) + ' км'
}

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

/** Формат M:SS, а для длинных сессий — H:MM:SS. */
function formatTimeLong(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}
