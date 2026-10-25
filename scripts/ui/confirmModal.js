/* ================================================================
   confirmModal.js — универсальная модалка подтверждения.

   Использование:
     const ok = await confirm({ title, body, confirmText, cancelText, danger })
     if (ok) { ... }

   body — строка (HTML) или DOM-элемент. Один экземпляр — один
   pending-promise; повторный вызов, пока открыта — вернёт false.
================================================================ */
let _resolveFn = null

export function confirm(options = {}) {
  const {
    title = 'Подтверждение',
    body = '',
    confirmText = 'OK',
    cancelText = 'Отмена',
    danger = false,
  } = options

  return new Promise((resolve) => {
    if (_resolveFn) {
      // Уже открыта другая модалка — не даём открыть вторую.
      resolve(false)
      return
    }

    const $modal = document.getElementById('confirmModal')
    if (!$modal) {
      resolve(false)
      return
    }

    const $title = $modal.querySelector('.confirm-title')
    const $body = $modal.querySelector('.confirm-body')
    const $ok = $modal.querySelector('.confirm-ok')
    const $cancel = $modal.querySelector('.confirm-cancel')

    if ($title) $title.textContent = title
    if ($body) {
      if (typeof body === 'string') $body.innerHTML = body
      else if (body instanceof Node) {
        $body.innerHTML = ''
        $body.appendChild(body)
      } else $body.innerHTML = ''
    }
    if ($ok) {
      $ok.textContent = confirmText
      $ok.classList.toggle('danger', !!danger)
    }
    if ($cancel) $cancel.textContent = cancelText

    const cleanup = (result) => {
      _resolveFn = null
      $modal.classList.remove('on')
      $ok.onclick = null
      $cancel.onclick = null
      $modal.onclick = null
      resolve(result)
    }

    _resolveFn = cleanup

    $ok.onclick = (e) => {
      e.stopPropagation()
      cleanup(true)
    }
    $cancel.onclick = (e) => {
      e.stopPropagation()
      cleanup(false)
    }
    $modal.onclick = (e) => {
      if (e.target === $modal) cleanup(false)
    }

    $modal.classList.add('on')
  })
}
