/* ================================================================
   _config_core.ts — настройки ядра игры.
   Секции: RENDERER, CAMERA, SAVE, GAME_CORE, UI, SOUNDS, GPU_HINT,
           QUALITY_PRESETS, FPS.

   ФАЙЛ СОДЕРЖИТ ТОЛЬКО ДАННЫЕ. Никаких формул.
   Всё, что требует вычислений, собирается в config.ts.

   Правило as const:
   • Применяется к секциям, которые не мутируются в рантайме.
   • RENDERER мутируется в applyQualityPreset(), поэтому БЕЗ as const.
================================================================ */

/* ================================================================
   RENDERER — настройки WebGL-рендерера
================================================================ */

export const RENDERER = {
  /** Сглаживание (MSAA). */
  antialias: 'По умолчанию: false — устанавливается в пресетах',

  /**Ограничение pixel ratio (плотности пикселей).
   *  [типично] 1 (экономно), 1.5 (баланс), 2 (качество).   */
  pixelRatioCap: 'По умолчанию: 2 — устанавливается в пресетах',

  /**
   * Экспозиция ACES-тонмаппинга.
   * [влияет] >1 — ярче (сцена «пересвечена»), <1 — темнее, более «киношно».
   * [типично] 0.9–1.3. 1.15 — сбалансированно для яркого дня.
   */
  toneMappingExposure: 1.15,

  /**
   * Сколько готовых чанков (от воркеров) максимально добавлять в сцену за ОДИН кадр.*/
  maxChunksPerFrame: 'По умолчанию: 2 — устанавливается в пресетах',
} as const

/* ================================================================
   КАМЕРА — следование за ракетой с адаптацией к скорости и высоте
================================================================ */

export const CAMERA = {
  fov: 55,
  near: 0.1,
  /** Дальность отрисовки м*/
  far: 15000,
  initial: [6, 8, 26],

  /** Высота (м), на которой камера полностью «переворачивается» вниз. */
  maxViewHeight: 1700,

  /** Базовый угол наклона камеры к горизонту (градусы, вид сбоку). */
  baseAngle: 20,

  /** Максимальный угол наклона (градусы, вид сверху вниз). */
  maxAngle: 60,

  /** Плавный переход в «вид сверху» при крутом пикировании.*/
  dive: {
    /** Целевой угол к горизонту при активном пикировании (°). */
    elevation: 70,

    /**
     * Порог входа: vx / |vy| ≤ enterRatio → dive = 1 (полный вид сверху).
     * 0.8 соответствует углу снижения ≈ 51° (чуть круче 45°).
     */
    enterRatio: 0.85,

    /**
     * Порог выхода: vx / |vy| ≥ exitRatio → dive = 0 (обычная формула).
     * 1.2 соответствует углу снижения ≈ 40° (уже положе 45°).
     * Зазор enter/exit даёт гистерезис — без дрожания на границе.
     */
    exitRatio: 1.3,

    /** Скорость сглаживания перехода (1/с). 4 ≈ 0.25 с на 63% пути. */
    blendSpeed: 0.6,

    /**Дополнительный сдвиг камеры НАЗАД по мировому X (в метрах)*/
    backShiftX: 10,
  },

  /** Базовый радиус сферы камеры вокруг ракеты (м). */
  baseRadius: 22,

  /** Прирост радиуса на каждую единицу скорости. */
  speedRadiusK: 0.12,

  /** Максимальная добавка радиуса от скорости (м). */
  maxSpeedRadius: 80,

  /** Lead-time для feed-forward (сек). Отрицательное = «смотрим в прошлое». */
  leadTime: -0.02,
  /** Базовый коэффициент сглаживания (1/с). Это «пол» скорости, с которой камера догоняет цель — не зависит от скорости ракеты.
   * Меньше - плавнее
   */
  followBase: 2,
  /** Скорость добавки к followBase на каждую единицу скорости ракеты (1/с на 1 м/с).
   * При скорости speed м/с: добавка = speed * followSpeedK.
   * followBase + min(followMaxSpeed, speed * followSpeedK)
   */
  followSpeedK: 0.08,
  followMaxSpeed: 25,

  /** Скорость перехода «сбоку → сзади» (в полёте). */
  blendIn: 0.4,

  /** Скорость перехода «сзади → сбоку» (после посадки). */
  blendOut: 1.4,

  lookAheadBase: 2,
  lookAheadBehind: 10,
  lookAheadAltK: 0.8,

  shakeDecayK: 2.2,
  shakeOnLand: 0.9,
  shakeAmpK: 0.5,
} as const

/* ================================================================
   SAVE — сохранение прогресса в localStorage

   Сохраняются: монеты, рекорд, уровни апгрейдов.
   Загружаются при старте. Сбрасываются кнопкой 🗑️.
================================================================ */

export const SAVE = {
  /** Ключ в localStorage.*/
  key: 'rocket_game_save_v2',

  version: 2,

  /** Автосохранение.*/
  autoSave: true,
} as const

/* ================================================================
   GAME_CORE — ядро игрового цикла: частота физики, коллизии,
   параметры покоя и старта полёта.
================================================================ */
export const GAME_CORE = {
  /** Частота шага физики (Гц). */
  physicsHz: 120,

  /** Максимальный dt кадра (сек). */
  maxFrameDt: 0.1,

  /** Потолок шагов физики за кадр. 0 = авто. */
  maxPhysicsSteps: 0,

  /** Swept-коллизия. */
  collision: {
    swept: true,
    sweptSamples: 4,
  },

  /** Высота ракеты над землёй в состоянии покоя (м). */
  restY: 0.95,

  /** Пауза (с) перед стартом. */
  prekickDelay: 0.3,

  /** Порог «камера вернулась» (м). */
  prekickCamTolerance: 2.0,

  /** Отношение 1 м по Z на flightYawRatio м по X. */
  flightYawRatio: 100,
} as const

/* ================================================================
   UI — всплывающие подсказки (toast)
================================================================ */

export const UI = {
  /** Сколько миллисекунд toast висит на экране. */
  toastDuration: 900,

  /** Цвета текста в разных ситуациях. */
  toastColors: {
    default: '#fff', // по умолчанию
    upgrade: '#ffd75e', // при апгрейде, старте полёта, приветствии
    land: '#7dffa0', // при удачной посадке (зелёный)
  },
} as const

/* ================================================================
   ЗВУКИ — Web Audio API.
   Каждый звук: src (путь), volume (0..1, множитель к мастеру).

   Итоговая громкость = masterVolume × volume × (настройка игрока).
   Если enabled === false — движок вообще не инициализируется.
================================================================ */
export const SOUNDS = {
  enabled: true,

  /**Мастер-громкость (0..1). Это «дефолт» — если игрок ещё не крутил ползунок в настройках. */
  masterVolume: 0.5,

  /** Список звуков. Ключ — используется в Sounds.play('ключ').*/
  list: {
    /** Разовое достижение (полное выполнение). */
    ach: {
      src: './data/sounds/achievementDone.mp3',
      volume: 0.2,
      delayMs: 120, // ← задержка перед play, мс
    },
    /** Этапное достижение (шаг прогресса, milestone). */
    achStage: {
      src: './data/sounds/achievementDoneStage.mp3',
      volume: 0.15,
      delayMs: 120, // ← задержка перед play, мс
    },
  },
} as const

/* ================================================================
   GPU_HINT — инструкция «если лагает на мощном ПК».
   Отображается в настройках ⚙️ под кнопкой поддержки.

   Автодетект WebGL-renderer через WEBGL_debug_renderer_info:
     • Если строка содержит UHD/HD Graphics/Iris — это ВСТРОЕННАЯ графика,
       типичная причина лагов на ноутбуках с дискретной видеокартой.
     • Если NVIDIA/AMD/Radeon/Apple M — ДИСКРЕТНАЯ, всё хорошо.
   Если браузер не отдаёт renderer — блок просто не показывает статус.
================================================================ */
export const GPU_HINT = {
  enabled: true,

  /** Регэксп «встроенной» графики в UNMASKED_RENDERER_WEBGL. */
  integratedPattern: /ANGLE \(Intel.*(UHD|Iris|HD Graphics)/i,

  /** Регэксп «дискретной» — для зелёной галочки. */
  discretePattern: /ANGLE \((NVIDIA|AMD|Radeon|Apple M)/i,
}

/* ================================================================
   QUALITY_PRESETS — четыре пресета качества графики.

   Применяются в settings.js → Quality.apply() ДО того, как модули
   прочитают RENDERER / PROPS / CHUNKS / LIGHTS / FAR_TILES /
   OVERLAY / SPACE. Изменение требует перезагрузки страницы.

   high — базовый, совпадает с дефолтными значениями в этом файле,
   поэтому установка high = «ничего не меняется».
   ================================================================ */
export const QUALITY_PRESETS = {
  low: {
    label: 'Низкое',
    desc: 'Максимум FPS',
    renderer: { antialias: false, pixelRatioCap: 0.8, maxChunksPerFrame: 1 },
    props: { density: 1000, maxRenderDistance: 1000 },
    lights: { shadow: { enabled: false } },
    chunks: { segments: 40 },
    farTiles: { segments: 100, segmentsHigh: 40 },
    overlay: { enabled: false, canvasSize: 512 },
    space: { stars: { count: 800 }, spheres: { maxCount: 1024 } },
    chestBeam: { style: 'cylinder' },
    lod: { changeAltitude: 750, changeBack: 650 },
    fog: { far3D: 1400 },
  },
  medium: {
    label: 'Среднее',
    desc: 'Баланс качества и производительности',
    renderer: { antialias: false, pixelRatioCap: 1.5, maxChunksPerFrame: 2 },
    props: { density: 2000, maxRenderDistance: 1900 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 48 },
    farTiles: { segments: 140, segmentsHigh: 48 },
    overlay: { enabled: true, canvasSize: 1024 },
    space: { stars: { count: 1500 }, spheres: { maxCount: 2560 } },
    chestBeam: { style: 'spiral', quality: 'simple' },
    lod: { changeAltitude: 1050, changeBack: 950 },
    fog: { far3D: 2000 },
  },
  high: {
    label: 'Высокое',
    desc: 'Рекомендуется для мощных устройств',
    renderer: { antialias: true, pixelRatioCap: 1, maxChunksPerFrame: 2 },
    props: { density: 2800, maxRenderDistance: 1850 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 53 },
    farTiles: { segments: 190, segmentsHigh: 53 },
    overlay: { enabled: true, canvasSize: 1024 },
    space: { stars: { count: 2500 }, spheres: { maxCount: 4096 } },
    chestBeam: { style: 'spiral', quality: 'full' },
    // Совпадает с дефолтами в CFG.LOD / CFG.FOG (эталон).
    lod: { changeAltitude: 850, changeBack: 750 },
    fog: { far3D: 1850 },
  },
  ultra: {
    label: 'Ультра',
    desc: 'Максимум качества (сильный GPU)',
    renderer: { antialias: true, pixelRatioCap: 2, maxChunksPerFrame: 3 },
    props: { density: 3800, maxRenderDistance: 2000 },
    lights: { shadow: { enabled: true } },
    chunks: { segments: 64 },
    farTiles: { segments: 220, segmentsHigh: 64 },
    overlay: { enabled: true, canvasSize: 1536 },
    space: { stars: { count: 2500 }, spheres: { maxCount: 4096 } },
    chestBeam: { style: 'spiral', quality: 'full' },

    lod: { changeAltitude: 1050, changeBack: 950 },
    fog: { far3D: 2000 },
  },
} as const

/* ================================================================
   FPS — пороги, окно усреднения и текст уведомления
   о низком FPS. Два уровня: warn и critical.
================================================================ */
export const FPS = {
  /** Порог «предупреждение» (FPS < warnThreshold → warn). */
  warnThreshold: 53,

  /** Порог «критично» (FPS < criticalThreshold → critical). */
  criticalThreshold: 40,

  /** Сколько миллисекунд после старта не проверять FPS
      (прогрев: компиляция шейдеров, стрим чанков, пр.). */
  warmupMs: 4000,

  /** Размер скользящего окна для усреднения (мс). */
  windowMs: 5000,

  /** Как часто запускать проверку внутри окна (мс). */
  checkIntervalMs: 1000,

  /** Минимум кадров в окне, чтобы проверка имела смысл. */
  minSamples: 10,

  /** Уведомление (toast-small при первом срабатывании). */
  notification: {
    warnText: '⚠️ Низкий FPS — проверьте настройки',
    criticalText: '⚠️ Очень низкий FPS — снизьте качество',
    durationMs: 3500,
    color: '#ff9f1a',
  },
} as const
