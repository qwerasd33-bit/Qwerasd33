import {
  CATEGORY_LABELS,
  COMMODITIES_CATALOG,
  CORRELATION_LABELS,
  DEFAULT_SESSION_CONFIG,
  DEFAULT_TEAM_NAMES,
  GREGORIAN_MONTH_NAMES,
  NUMERIC_RULE_LABELS,
  PATTERN_DESCRIPTIONS,
  PATTERN_LABELS,
  PATTERN_SHORT_LABELS,
  SEASONAL_PEAK_LABELS,
  buildDefaultCustomMonthlyPrices,
  buildDefaultProductPatternConfigs,
} from '../constants';
import {
  anchorHijriStart,
  getDualCalendarForMonth,
  selectActiveCommodities,
} from '../engine/marketEngine';
import {
  ActivePatternsConfig,
  CorrelationDirection,
  HorizonMode,
  NumericMonthRule,
  PatternFamily,
  ProductPatternConfig,
  SeasonalPeak,
  SessionConfig,
} from '../types';
import { pwaInstallService } from '../services/PwaInstallService';
import { icons } from './icons';

export interface SetupViewCallbacks {
  onStartSession: (config: SessionConfig, teamNames: string[]) => void;
  onPreviewPlan: (config: SessionConfig, teamNames: string[]) => void;
  onResumeSaved?: () => void;
  onOpenSavedSessions: () => void;
  onImportJsonFile: (file: File) => void;
  onToggle3DPreview: () => void;
  onOpenApkInstall: () => void;
}

export class SetupView {
  private container: HTMLElement;
  private callbacks: SetupViewCallbacks;
  private config: SessionConfig;
  private teamNames: string[];
  private hasSavedSession: boolean;
  private savedSessionsCount: number;

  constructor(
    container: HTMLElement,
    callbacks: SetupViewCallbacks,
    hasSavedSession: boolean,
    savedSessionsCount = 0
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.hasSavedSession = hasSavedSession;
    this.savedSessionsCount = savedSessionsCount;
    this.config = {
      ...DEFAULT_SESSION_CONFIG,
      activePatterns: { ...DEFAULT_SESSION_CONFIG.activePatterns },
      productPatternConfigs: buildDefaultProductPatternConfigs(),
      customPlanOverrides: {},
    };
    this.teamNames = DEFAULT_TEAM_NAMES.slice(0, 4);
  }

  public setHasSavedSession(val: boolean) {
    this.hasSavedSession = val;
  }

  public setSavedSessionsCount(count: number) {
    this.savedSessionsCount = count;
  }

  public setDraftOverrides(
    overrides: Record<string, Record<number, number>>,
    updatedConfig?: SessionConfig,
    updatedTeams?: string[]
  ) {
    if (updatedConfig) {
      this.config = {
        ...updatedConfig,
        activePatterns: { ...updatedConfig.activePatterns },
        productPatternConfigs: { ...updatedConfig.productPatternConfigs },
        customPlanOverrides: JSON.parse(JSON.stringify(overrides)) as Record<
          string,
          Record<number, number>
        >,
      };
    } else {
      this.config.customPlanOverrides = JSON.parse(JSON.stringify(overrides)) as Record<
        string,
        Record<number, number>
      >;
    }
    if (updatedTeams && updatedTeams.length >= 2) {
      this.teamNames = [...updatedTeams];
    }
  }

  public render() {
    const prevPageScroll =
      this.container.querySelector<HTMLElement>('[data-testid="setup-view"]')?.scrollTop ?? 0;
    const prevListScroll =
      this.container.querySelector<HTMLElement>('[data-testid="product-pattern-list"]')?.scrollTop ??
      0;
    const maxProducts = COMMODITIES_CATALOG.length;
    const activePreview = selectActiveCommodities(
      this.config.productCount,
      this.config.activePatterns,
      this.config.productPatternConfigs
    );

    const patternKeys: Array<keyof ActivePatternsConfig> = [
      'seasonal_monthly',
      'numeric_month_rule',
      'linked_commodity',
    ];

    const volatilityLabel =
      this.config.volatilityMultiplier <= 0.75
        ? 'هادئ'
        : this.config.volatilityMultiplier <= 1.15
          ? 'متوازن'
          : this.config.volatilityMultiplier <= 1.55
            ? 'متقلب'
            : 'عاصف';

    const overridesCount = Object.values(this.config.customPlanOverrides ?? {}).reduce(
      (acc, mMap) => acc + Object.keys(mMap).length,
      0
    );

    const horizonLabel =
      this.config.horizonMode === 'unlimited'
        ? 'غير محدودة الأمد (إلى غير أمد)'
        : '36 شهراً (3 سنوات)';

    const startDual = getDualCalendarForMonth(this.config, 0);
    const firstYearCalendar = Array.from({ length: 12 }, (_, idx) =>
      getDualCalendarForMonth(this.config, idx)
    );
    const nextRamadan = firstYearCalendar.find((d) => d.hijriMonth === 9);
    const nextHijjah = firstYearCalendar.find((d) => d.hijriMonth === 12);

    const pwaState = pwaInstallService.getState();

    this.container.innerHTML = `
      <div class="h-full w-full overflow-y-auto bg-[#0d0f14]/88 text-[#f5f0e6]" data-testid="setup-view">
        ${
          !pwaState.isOnline
            ? `<div class="bg-[#b45309] text-white text-xs font-medium px-4 py-2 flex items-center justify-center gap-2" role="status" data-testid="offline-indicator">
                ${icons.wifiOff}
                <span>وضع عدم الاتصال — يعمل التطبيق بالبيانات المخزنة محلياً</span>
              </div>`
            : ''
        }
        <!-- 3-Zone Top Bar -->
        <header class="max-w-7xl mx-auto px-6 py-4 border-b border-[#d4a853]/20 flex flex-wrap items-center justify-between gap-4">
          <div class="font-display text-xl font-bold text-[#d4a853] whitespace-nowrap shrink-0">
            بورصة البر والفعاليات
          </div>
          <nav class="hidden md:flex items-center gap-6 text-sm text-[#9ca3af]">
            <span class="whitespace-nowrap shrink-0">تخصيص الجلسة</span>
            <span aria-hidden="true">·</span>
            <span class="whitespace-nowrap shrink-0">${horizonLabel}</span>
            <span aria-hidden="true">·</span>
            <span class="whitespace-nowrap shrink-0">${startDual.hijriLabel}</span>
            <span aria-hidden="true">·</span>
            <span class="whitespace-nowrap shrink-0">${maxProducts} منتجاً</span>
          </nav>
          <div class="flex flex-wrap items-center gap-2.5 shrink-0">
            ${
              pwaState.runtimeMode !== 'capacitor_native'
                ? `<button
                    type="button"
                    id="setup-apk-install-btn"
                    data-testid="apk-install-btn"
                    class="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#0d0f14] bg-[#10b981] hover:bg-[#34d399] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[#34d399]"
                  >
                    ${icons.smartphone}
                    <span>${pwaState.isInstalled ? 'حزمة APK' : 'تثبيت التطبيق / APK'}</span>
                  </button>`
                : ''
            }
            <button
              type="button"
              id="setup-toggle-3d"
              class="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#f5f0e6] bg-[#161a22] border border-[#f5f0e6]/15 rounded-lg hover:border-[#d4a853]/50 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#d4a853]"
            >
              ${icons.cube}
              <span>معاينة المخيم 3D</span>
            </button>
          </div>
        </header>

        <main class="max-w-7xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <!-- Right Column (7 cols): Market Customization Studio -->
          <section class="lg:col-span-7 bg-[#161a22] border border-[#d4a853]/20 rounded-xl p-6 space-y-6">
            <div class="flex flex-wrap items-center justify-between gap-4 border-b border-[#f5f0e6]/10 pb-4">
              <div>
                <h1 class="font-display text-2xl font-bold text-[#f5f0e6]">إعداد وتخصيص جلسة البورصة</h1>
                <p class="text-sm text-[#9ca3af] mt-1">
                  اضبط عدد المنتجات، الأمد الزمني، حدة التذبذب، والتقويم الهجري والميلادي مع إمكانية حفظ الجلسات واسترجاعها.
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  id="setup-saved-sessions-btn"
                  data-testid="setup-saved-sessions-btn"
                  class="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#d4a853] bg-[#1d222d] border border-[#d4a853]/40 rounded-lg hover:bg-[#d4a853]/15 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  ${icons.bookmark}
                  <span>الجلسات المحفوظة (${this.savedSessionsCount})</span>
                </button>
                <label class="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium text-[#f5f0e6] bg-[#1d222d] border border-[#f5f0e6]/15 rounded-lg hover:border-[#d4a853]/50 cursor-pointer whitespace-nowrap shrink-0">
                  ${icons.upload}
                  <span>استيراد JSON</span>
                  <input type="file" id="setup-import-file" accept=".json,application/json" class="sr-only" />
                </label>
                ${
                  this.hasSavedSession
                    ? `<button type="button" id="setup-resume-btn" class="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold text-[#0d0f14] bg-[#10b981] rounded-lg hover:bg-[#34d399] transition-colors whitespace-nowrap shrink-0 cursor-pointer">
                        ${icons.play}
                        <span>استكمال الأخيرة</span>
                      </button>`
                    : ''
                }
              </div>
            </div>

            <!-- Session Name & Horizon Mode (Timeless Months) -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label for="cfg-session-name" class="block text-sm font-medium text-[#f5f0e6] mb-1.5">
                  اسم الجلسة أو الكشتة
                </label>
                <input
                  id="cfg-session-name"
                  type="text"
                  value="${this.escapeAttr(this.config.sessionName)}"
                  class="w-full px-3.5 py-2.5 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg text-sm text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                />
              </div>
              <div>
                <span class="block text-sm font-medium text-[#f5f0e6] mb-1.5">
                  أمد البورصة الزمني (الشهر بلا وقت)
                </span>
                <div class="grid grid-cols-2 gap-2" role="group" aria-label="أمد البورصة الزمني">
                  <button
                    type="button"
                    data-horizon-mode="36_months"
                    data-testid="horizon-36-btn"
                    class="px-3 py-2.5 text-xs rounded-lg border text-center transition-colors ${
                      this.config.horizonMode === '36_months'
                        ? 'bg-[#d4a853] text-[#0d0f14] border-[#d4a853] font-bold'
                        : 'bg-[#0d0f14] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
                    }"
                  >
                    3 سنوات (36 شهراً)
                  </button>
                  <button
                    type="button"
                    data-horizon-mode="unlimited"
                    data-testid="horizon-unlimited-btn"
                    class="px-3 py-2.5 text-xs rounded-lg border text-center transition-colors ${
                      this.config.horizonMode === 'unlimited'
                        ? 'bg-[#d4a853] text-[#0d0f14] border-[#d4a853] font-bold'
                        : 'bg-[#0d0f14] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
                    }"
                  >
                    مفتوحة (إلى غير أمد)
                  </button>
                </div>
                <p class="text-[11px] text-[#9ca3af] mt-1.5">
                  الشهر مفتوح بدون مؤقت تنازلي؛ ينتقل المدير للشهر التالي يدوياً متى انتهت الصفقات.
                </p>
              </div>
            </div>

            <!-- Product Count & Base Volatility -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-5 pt-2 border-t border-[#f5f0e6]/10">
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label for="cfg-product-count" class="text-sm font-medium text-[#f5f0e6]">
                    عدد المنتجات النشطة
                  </label>
                  <span id="cfg-product-count-readout" class="font-num text-sm font-semibold text-[#d4a853]">
                    ${this.config.productCount} / ${maxProducts} منتج
                  </span>
                </div>
                <input
                  id="cfg-product-count"
                  type="range"
                  min="4"
                  max="${maxProducts}"
                  step="1"
                  value="${this.config.productCount}"
                  class="w-full accent-[#d4a853] cursor-pointer"
                />
                <p id="cfg-product-preview" class="text-xs text-[#9ca3af] mt-2 leading-relaxed">
                  ${activePreview.map((a) => a.spec.name).join(' · ')}
                </p>
              </div>

              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <label for="cfg-volatility" class="text-sm font-medium text-[#f5f0e6]">
                    التذبذب الأساسي للأسعار
                  </label>
                  <span id="cfg-volatility-readout" class="font-num text-sm font-semibold text-[#d4a853]">
                    ${this.config.volatilityMultiplier.toFixed(1)}× · ${volatilityLabel}
                  </span>
                </div>
                <input
                  id="cfg-volatility"
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value="${this.config.volatilityMultiplier}"
                  class="w-full accent-[#d4a853] cursor-pointer"
                />
                <div class="flex items-center gap-2 mt-2">
                  ${[
                    { val: 0.6, label: 'هادئ 0.6×' },
                    { val: 1.0, label: 'متوازن 1.0×' },
                    { val: 1.4, label: 'متقلب 1.4×' },
                    { val: 1.8, label: 'عاصف 1.8×' },
                  ]
                    .map(
                      (p) => `
                    <button
                      type="button"
                      data-volatility-preset="${p.val}"
                      class="px-2.5 py-1 text-xs rounded border transition-colors whitespace-nowrap shrink-0 ${
                        Math.abs(this.config.volatilityMultiplier - p.val) < 0.05
                          ? 'bg-[#d4a853] text-[#0d0f14] border-[#d4a853] font-bold'
                          : 'bg-[#0d0f14] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
                      }"
                    >${p.label}</button>
                  `
                    )
                    .join('')}
                </div>
              </div>
            </div>

            <!-- Active Algorithmic Pattern Families (3 Patterns) -->
            <div class="pt-3 border-t border-[#f5f0e6]/10">
              <div class="flex items-center justify-between mb-3">
                <span class="text-sm font-semibold text-[#f5f0e6]">الأنماط الخوارزمية المفعّلة</span>
                <span class="text-xs text-[#9ca3af]">الأنماط المعطلة تتحول إلى حركة سوق متوازنة</span>
              </div>
              <div class="grid grid-cols-1 gap-2.5">
                ${patternKeys
                  .map((key) => {
                    const checked = this.config.activePatterns[key];
                    return `
                    <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      checked
                        ? 'bg-[#1d222d] border-[#d4a853]/40'
                        : 'bg-[#0d0f14] border-[#f5f0e6]/10 opacity-75'
                    }">
                      <input
                        type="checkbox"
                        data-pattern-key="${key}"
                        ${checked ? 'checked' : ''}
                        class="mt-1 w-4 h-4 accent-[#d4a853] shrink-0"
                      />
                      <span class="text-xs leading-relaxed">
                        <span class="block font-semibold text-[#f5f0e6]">${PATTERN_LABELS[key]}</span>
                        <span class="block text-[#9ca3af] mt-0.5">${PATTERN_DESCRIPTIONS[key]}</span>
                      </span>
                    </label>
                  `;
                  })
                  .join('')}
              </div>
            </div>

            <!-- Dual Hijri & Gregorian Calendar + Hijri Market Effects -->
            <div class="pt-3 border-t border-[#f5f0e6]/10 space-y-3" data-testid="setup-hijri-section">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="text-sm font-semibold text-[#f5f0e6] flex items-center gap-1.5">
                  <span class="text-[#d4a853]">${icons.calendar}</span>
                  <span>التقويم الهجري والميلادي</span>
                </span>
                <span class="text-xs font-medium text-[#d4a853]" data-testid="setup-dual-preview">
                  بداية الشهر 1: ${startDual.gregorianLabel} · ${startDual.hijriLabel}
                </span>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label for="cfg-start-month" class="block text-xs text-[#9ca3af] mb-1">شهر البداية الميلادي</label>
                  <select
                    id="cfg-start-month"
                    class="w-full px-3 py-2 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg text-xs text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                  >
                    ${GREGORIAN_MONTH_NAMES.map(
                      (mName, idx) =>
                        `<option value="${idx + 1}" ${this.config.startMonth === idx + 1 ? 'selected' : ''}>${idx + 1} - ${mName}</option>`
                    ).join('')}
                  </select>
                </div>
                <div>
                  <label for="cfg-start-year" class="block text-xs text-[#9ca3af] mb-1">سنة البداية الميلادية</label>
                  <select
                    id="cfg-start-year"
                    class="w-full px-3 py-2 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg font-num text-xs text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                  >
                    ${[2025, 2026, 2027, 2028, 2029, 2030]
                      .map(
                        (yr) =>
                          `<option value="${yr}" ${this.config.startYear === yr ? 'selected' : ''}>${yr}</option>`
                      )
                      .join('')}
                  </select>
                </div>
              </div>

              <label class="flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                this.config.hijriEffectsEnabled
                  ? 'bg-[#1d222d] border-[#10b981]/45'
                  : 'bg-[#0d0f14] border-[#f5f0e6]/10 opacity-75'
              }">
                <input
                  type="checkbox"
                  id="cfg-hijri-effects-enabled"
                  data-testid="hijri-effects-toggle"
                  ${this.config.hijriEffectsEnabled ? 'checked' : ''}
                  class="mt-1 w-4 h-4 accent-[#10b981] shrink-0"
                />
                <span class="text-xs leading-relaxed flex-1">
                  <span class="font-semibold text-[#f5f0e6] block">
                    تفعيل تأثير الشهور الهجرية على أسعار المنتجات
                  </span>
                  <span class="block text-[#9ca3af] mt-0.5">
                    يرفع الطلب والأسعار في المواسم الدينية: التمور (+38%) والقهوة والطحين والدواجن في <strong>رمضان</strong>، الجوالات في <strong>شوال</strong>، والأغنام (+35%) والبنزين في <strong>ذو الحجة</strong>.
                  </span>
                  ${
                    nextRamadan || nextHijjah
                      ? `<span class="block text-[11px] text-[#34d399] mt-1 font-num">
                          ${nextRamadan ? `🌙 رمضان ${nextRamadan.hijriYear} هـ يصادف الشهر ${nextRamadan.monthIndex + 1} (${nextRamadan.gregorianLabel})` : ''}
                          ${nextRamadan && nextHijjah ? ' · ' : ''}
                          ${nextHijjah ? `🕋 ذو الحجة ${nextHijjah.hijriYear} هـ يصادف الشهر ${nextHijjah.monthIndex + 1} (${nextHijjah.gregorianLabel})` : ''}
                        </span>`
                      : ''
                  }
                </span>
              </label>
            </div>

            <!-- Quarterly Seasonal Events Settings (Every 3 Months, Single Product) -->
            <div class="pt-3 border-t border-[#f5f0e6]/10 space-y-3">
              <label class="flex items-start gap-3 p-3.5 rounded-lg border cursor-pointer transition-colors ${
                this.config.seasonalEventsEnabled
                  ? 'bg-[#1d222d] border-[#d4a853]/45'
                  : 'bg-[#0d0f14] border-[#f5f0e6]/10 opacity-75'
              }">
                <input
                  type="checkbox"
                  id="cfg-seasonal-events-enabled"
                  data-testid="seasonal-events-toggle"
                  ${this.config.seasonalEventsEnabled ? 'checked' : ''}
                  class="mt-1 w-4 h-4 accent-[#d4a853] shrink-0"
                />
                <span class="text-xs leading-relaxed flex-1">
                  <span class="flex items-center gap-1.5 font-semibold text-[#f5f0e6]">
                    ${icons.bolt}
                    <span>الأحداث الموسمية (كل 3 شهور)</span>
                  </span>
                  <span class="block text-[#9ca3af] mt-0.5">
                    حدث مفاجئ له سبب واضح (مثل انتشار مرض الجرب بين المواشي أو أزمة عالمية في النفط)، يقع في الشهر 3 و 6 و 9... ويظهر كنافذة منبثقة ليؤثر على منتج واحد فقط.
                  </span>
                </span>
              </label>

              ${
                this.config.seasonalEventsEnabled
                  ? `<div class="flex flex-wrap items-center justify-between gap-3 px-1">
                      <span class="text-xs text-[#9ca3af]">شدة تأثير الحدث الموسمي على المنتج المستهدف:</span>
                      <div class="flex items-center gap-1.5">
                        ${[
                          { val: 0.25, label: 'خفيف ±25%' },
                          { val: 0.3, label: 'متوسط ±30%' },
                          { val: 0.4, label: 'قوي ±40%' },
                          { val: 0.5, label: 'قياسي ±50%' },
                        ]
                          .map(
                            (opt) => `
                          <button
                            type="button"
                            data-seasonal-impact="${opt.val}"
                            data-testid="seasonal-impact-${Math.round(opt.val * 100)}"
                            class="px-2.5 py-1 text-xs font-num rounded border transition-colors whitespace-nowrap shrink-0 ${
                              Math.abs(this.config.seasonalEventImpactPct - opt.val) < 0.04
                                ? 'bg-[#d4a853] text-[#0d0f14] border-[#d4a853] font-bold'
                                : 'bg-[#0d0f14] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
                            }"
                          >${opt.label}</button>
                        `
                          )
                          .join('')}
                      </div>
                    </div>`
                  : ''
              }
            </div>

            <!-- Per-Product Pattern Assignment Studio -->
            <div class="pt-3 border-t border-[#f5f0e6]/10 space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 class="text-sm font-semibold text-[#f5f0e6]">تعيين النمط لكل منتج (${activePreview.length})</h2>
                  <p class="text-xs text-[#9ca3af] mt-0.5">في النمط الموسمي يمكنك اختيار فصل الذروة أو اختيار «أخرى» لتحديد سعر كل شهر (ش1–ش12) يدوياً.</p>
                </div>
                <button
                  type="button"
                  id="setup-reset-patterns"
                  class="px-2.5 py-1.5 text-xs rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#9ca3af] hover:text-[#f5f0e6] hover:border-[#d4a853]/40 whitespace-nowrap"
                >استعادة الافتراضي</button>
              </div>

              <div class="space-y-2.5 max-h-[430px] overflow-y-auto pl-1" data-testid="product-pattern-list">
                ${activePreview
                  .map(({ spec }) => this.renderProductPatternRow(spec.id, activePreview.map((a) => a.spec)))
                  .join('')}
              </div>
            </div>

            <!-- Economy & Security Parameters -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#f5f0e6]/10">
              <div>
                <label for="cfg-starting-cash" class="block text-xs text-[#9ca3af] mb-1">السيولة الابتدائية (ر.س)</label>
                <input
                  id="cfg-starting-cash"
                  type="number"
                  min="500"
                  max="100000"
                  step="500"
                  value="${this.config.startingCash}"
                  class="w-full px-3 py-2 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg font-num text-sm text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                />
              </div>
              <div>
                <label for="cfg-report-cost" class="block text-xs text-[#9ca3af] mb-1">سعر التقرير السري</label>
                <input
                  id="cfg-report-cost"
                  type="number"
                  min="0"
                  max="5000"
                  step="100"
                  value="${this.config.secretReportCost}"
                  class="w-full px-3 py-2 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg font-num text-sm text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                />
              </div>
              <div>
                <label for="cfg-demand-threshold" class="block text-xs text-[#9ca3af] mb-1">حد العرض والطلب (وحدة)</label>
                <input
                  id="cfg-demand-threshold"
                  type="number"
                  min="2"
                  max="100"
                  step="1"
                  value="${this.config.supplyDemandThreshold}"
                  class="w-full px-3 py-2 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg font-num text-sm text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                />
              </div>
              <div>
                <label for="cfg-mod-pin" class="block text-xs text-[#9ca3af] mb-1">رمز PIN للمدير (اختياري)</label>
                <input
                  id="cfg-mod-pin"
                  type="password"
                  maxlength="8"
                  placeholder="بدون رمز"
                  value="${this.escapeAttr(this.config.moderatorPin)}"
                  class="w-full px-3 py-2 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg font-num text-sm text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                />
              </div>
            </div>
          </section>

          <!-- Left Column (5 cols): Teams Roster, Plan Preview & Launch -->
          <section class="lg:col-span-5 bg-[#161a22] border border-[#d4a853]/20 rounded-xl p-6 space-y-5">
            <div class="flex items-center justify-between border-b border-[#f5f0e6]/10 pb-4">
              <div>
                <h2 class="font-display text-xl font-bold text-[#f5f0e6]">الفرق المتنافسة (${this.teamNames.length} / 6)</h2>
                <p class="text-xs text-[#9ca3af] mt-1">أضف من 2 إلى 6 فرق بأسماء مخصصة.</p>
              </div>
              <button
                type="button"
                id="setup-add-team"
                ${this.teamNames.length >= 6 ? 'disabled' : ''}
                class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-[#d4a853]/40 text-[#d4a853] hover:bg-[#d4a853]/10 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                ${icons.plus}
                <span>إضافة فريق</span>
              </button>
            </div>

            <div class="space-y-2.5" id="setup-teams-list">
              ${this.teamNames
                .map(
                  (name, idx) => `
                <div class="flex items-center gap-2.5">
                  <span class="font-num text-xs text-[#9ca3af] w-6 text-center">${idx + 1}.</span>
                  <input
                    type="text"
                    data-team-index="${idx}"
                    aria-label="اسم الفريق ${idx + 1}"
                    value="${this.escapeAttr(name)}"
                    class="flex-1 px-3.5 py-2.5 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg text-sm text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
                  />
                  ${
                    this.teamNames.length > 2
                      ? `<button
                          type="button"
                          data-remove-team="${idx}"
                          aria-label="حذف الفريق ${idx + 1}"
                          class="p-2 text-[#9ca3af] hover:text-[#ef4444] rounded-lg border border-transparent hover:border-[#ef4444]/30 transition-colors shrink-0"
                        >${icons.close}</button>`
                      : ''
                  }
                </div>
              `
                )
                .join('')}
            </div>

            <!-- Summary before Launch -->
            <div class="bg-[#0d0f14] border border-[#f5f0e6]/10 rounded-lg p-4 space-y-2 text-xs text-[#9ca3af]">
              <div class="flex items-center justify-between">
                <span>مجموع المنتجات المشاركة</span>
                <span class="font-num text-[#f5f0e6] font-semibold">${this.config.productCount} منتج</span>
              </div>
              <div class="flex items-center justify-between">
                <span>رأس مال كل فريق</span>
                <span class="font-num text-[#f5f0e6] font-semibold">${this.config.startingCash.toLocaleString('en-US')} ر.س</span>
              </div>
              <div class="flex items-center justify-between">
                <span>الأمد الزمني للبورصة</span>
                <span class="font-num text-[#f5f0e6] font-semibold">${horizonLabel}</span>
              </div>
              <div class="flex items-center justify-between">
                <span>مدة كل شهر</span>
                <span class="font-semibold text-[#10b981]">مفتوح (بلا وقت)</span>
              </div>
              <div class="flex items-center justify-between">
                <span>بداية التقويم المزدوج</span>
                <span class="font-medium text-[#f5f0e6]">${startDual.shortLabel}</span>
              </div>
              <div class="flex items-center justify-between">
                <span>تأثير الشهور الهجرية</span>
                <span class="font-semibold ${
                  this.config.hijriEffectsEnabled ? 'text-[#10b981]' : 'text-[#9ca3af]'
                }">${this.config.hijriEffectsEnabled ? 'مفعّل (رمضان / شوال / ذو الحجة...)' : 'معطّل'}</span>
              </div>
              <div class="flex items-center justify-between">
                <span>الأحداث الموسمية (كل 3 شهور)</span>
                <span class="font-num font-semibold ${
                  this.config.seasonalEventsEnabled ? 'text-[#d4a853]' : 'text-[#9ca3af]'
                }">${
                  this.config.seasonalEventsEnabled
                    ? `مفعّلة · منتج واحد فقط (±${Math.round(this.config.seasonalEventImpactPct * 100)}%)`
                    : 'معطّلة'
                }</span>
              </div>
              ${
                overridesCount > 0
                  ? `<div class="flex items-center justify-between text-[#d4a853]">
                      <span>تعديلات الخطة الشهرية المسبقة</span>
                      <span class="font-num font-bold">${overridesCount} تعديل</span>
                    </div>`
                  : ''
              }
              <div class="pt-2 border-t border-[#f5f0e6]/10 text-[#d4a853]">
                منطقة المجهول: يبدأ السوق من الشهر 1 دون كشف الأسعار المستقبلية للفرق، مع إمكانية إضافة سيولة (1,000 / 2,000 / 3,000 / مخصص) قبل بداية كل شهر.
              </div>
            </div>

            <div class="space-y-2.5 pt-2">
              <button
                type="button"
                id="setup-preview-plan-btn"
                data-testid="preview-plan-btn"
                class="w-full py-3 px-5 rounded-lg bg-[#1d222d] hover:bg-[#252b38] border border-[#d4a853]/45 text-[#d4a853] font-display font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                ${icons.book}
                <span>معاينة وتعديل خطة البورصة قبل الاعتماد (3 سنوات)</span>
              </button>
              <button
                type="button"
                id="setup-start-btn"
                data-testid="start-session-btn"
                class="w-full py-3.5 px-6 rounded-lg bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] font-display font-bold text-base transition-colors cursor-pointer"
              >
                اعتماد البورصة وبدء الجلسة من الشهر الأول
              </button>
              <button
                type="button"
                id="setup-quickstart-btn"
                class="w-full py-2.5 px-4 rounded-lg bg-[#0d0f14] hover:bg-[#1d222d] text-[#f5f0e6] border border-[#f5f0e6]/15 text-xs font-medium transition-colors cursor-pointer"
              >
                بدء سريع بالإعدادات الافتراضية (${maxProducts} منتجاً · 4 فرق)
              </button>
            </div>
          </section>
        </main>
      </div>
    `;

    const nextPage = this.container.querySelector<HTMLElement>('[data-testid="setup-view"]');
    if (nextPage && prevPageScroll > 0) nextPage.scrollTop = prevPageScroll;
    const nextList = this.container.querySelector<HTMLElement>('[data-testid="product-pattern-list"]');
    if (nextList && prevListScroll > 0) nextList.scrollTop = prevListScroll;

    this.bindEvents();
  }

  private renderProductPatternRow(
    commodityId: string,
    activeSpecs: typeof COMMODITIES_CATALOG
  ): string {
    const spec = COMMODITIES_CATALOG.find((c) => c.id === commodityId);
    if (!spec) return '';
    const cfg: ProductPatternConfig =
      this.config.productPatternConfigs[commodityId] ?? { ...spec.defaultPatternConfig };
    const isPatternDisabled = !this.config.activePatterns[cfg.pattern];

    let subControlsHtml = '';
    let customMonthlyGridHtml = '';

    if (cfg.pattern === 'seasonal_monthly') {
      const peak = cfg.seasonalPeak ?? 'winter';
      subControlsHtml = `
        <select
          data-product-seasonal="${commodityId}"
          aria-label="فصل الذروة لـ ${spec.name}"
          class="flex-1 min-w-[160px] px-2.5 py-1.5 bg-[#161a22] border border-[#f5f0e6]/15 rounded text-xs text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
        >
          ${(Object.keys(SEASONAL_PEAK_LABELS) as SeasonalPeak[])
            .map(
              (k) =>
                `<option value="${k}" ${k === peak ? 'selected' : ''}>${SEASONAL_PEAK_LABELS[k]}</option>`
            )
            .join('')}
        </select>
      `;

      if (peak === 'custom') {
        const monthlyPrices =
          cfg.customMonthlyPrices && cfg.customMonthlyPrices.length === 12
            ? cfg.customMonthlyPrices
            : buildDefaultCustomMonthlyPrices(spec.basePrice);
        customMonthlyGridHtml = `
          <div class="pt-2 border-t border-[#f5f0e6]/10" data-testid="custom-seasonal-grid-${commodityId}">
            <div class="text-[11px] text-[#d4a853] mb-1.5">تقسيم الأسعار لكل شهر من السنة (ر.س):</div>
            <div class="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
              ${monthlyPrices
                .map(
                  (priceVal, mIdx) => `
                <label class="flex flex-col gap-0.5 text-[10px] text-[#9ca3af]">
                  <span class="font-num">ش${mIdx + 1}</span>
                  <input
                    type="number"
                    min="1"
                    data-custom-month="${commodityId}"
                    data-month-slot="${mIdx}"
                    aria-label="سعر ${spec.name} لشهر ${mIdx + 1}"
                    value="${priceVal}"
                    class="w-full px-1.5 py-1 bg-[#161a22] border border-[#f5f0e6]/15 rounded font-num text-xs text-[#f5f0e6] text-center focus:border-[#d4a853] focus:outline-none"
                  />
                </label>
              `
                )
                .join('')}
            </div>
          </div>
        `;
      }
    } else if (cfg.pattern === 'numeric_month_rule') {
      const rule = cfg.numericRule ?? 'even_up_odd_down';
      subControlsHtml = `
        <select
          data-product-numeric="${commodityId}"
          aria-label="القاعدة الرقمية لـ ${spec.name}"
          class="flex-1 min-w-[190px] px-2.5 py-1.5 bg-[#161a22] border border-[#f5f0e6]/15 rounded text-xs text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
        >
          ${(Object.keys(NUMERIC_RULE_LABELS) as NumericMonthRule[])
            .map(
              (k) =>
                `<option value="${k}" ${k === rule ? 'selected' : ''}>${NUMERIC_RULE_LABELS[k]}</option>`
            )
            .join('')}
        </select>
      `;
    } else if (cfg.pattern === 'linked_commodity') {
      const otherSpecs = activeSpecs.filter((s) => s.id !== commodityId);
      const targetId =
        cfg.linkedCommodityId && otherSpecs.some((s) => s.id === cfg.linkedCommodityId)
          ? cfg.linkedCommodityId
          : otherSpecs[0]?.id ?? '';
      const dir = cfg.correlationDirection ?? 'direct';
      const lag = cfg.lagMonths ?? 0;

      subControlsHtml = `
        <select
          data-product-link-dir="${commodityId}"
          aria-label="نوع الارتباط لـ ${spec.name}"
          class="px-2.5 py-1.5 bg-[#161a22] border border-[#f5f0e6]/15 rounded text-xs text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
        >
          ${(Object.keys(CORRELATION_LABELS) as CorrelationDirection[])
            .map(
              (k) =>
                `<option value="${k}" ${k === dir ? 'selected' : ''}>${CORRELATION_LABELS[k]}</option>`
            )
            .join('')}
        </select>
        <select
          data-product-link-target="${commodityId}"
          aria-label="المنتج المرتبط بـ ${spec.name}"
          class="px-2.5 py-1.5 bg-[#161a22] border border-[#f5f0e6]/15 rounded text-xs text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
        >
          ${otherSpecs
            .map(
              (other) =>
                `<option value="${other.id}" ${other.id === targetId ? 'selected' : ''}>مع: ${other.name}</option>`
            )
            .join('')}
        </select>
        <select
          data-product-link-lag="${commodityId}"
          aria-label="توقيت الارتباط لـ ${spec.name}"
          class="px-2 py-1.5 bg-[#161a22] border border-[#f5f0e6]/15 rounded text-xs text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
        >
          <option value="0" ${lag === 0 ? 'selected' : ''}>فوري</option>
          <option value="1" ${lag === 1 ? 'selected' : ''}>تأخر شهر</option>
        </select>
      `;
    }

    return `
      <div class="p-3 rounded-lg bg-[#0d0f14] border ${isPatternDisabled ? 'border-[#ef4444]/30 opacity-75' : 'border-[#f5f0e6]/10'} space-y-2" data-testid="product-pattern-row-${commodityId}">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-[120px]">
            <span class="text-sm font-bold text-[#f5f0e6]">${spec.name}</span>
            <span class="font-num text-[11px] text-[#9ca3af]">(${spec.basePrice} ر.س)</span>
          </div>
          <select
            data-product-pattern="${commodityId}"
            aria-label="نمط منتج ${spec.name}"
            class="px-2.5 py-1.5 bg-[#161a22] border border-[#d4a853]/35 rounded text-xs font-semibold text-[#d4a853] focus:border-[#d4a853] focus:outline-none"
          >
            ${(['seasonal_monthly', 'numeric_month_rule', 'linked_commodity'] as Array<
              Exclude<PatternFamily, 'neutral'>
            >)
              .map(
                (p) =>
                  `<option value="${p}" ${cfg.pattern === p ? 'selected' : ''}>${PATTERN_SHORT_LABELS[p]}</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          ${subControlsHtml}
          ${
            isPatternDisabled
              ? `<span class="text-[11px] text-[#ef4444]">(هذا النمط معطّل من الأعلى)</span>`
              : ''
          }
        </div>
        ${customMonthlyGridHtml}
      </div>
    `;
  }

  private buildDraftConfig(): SessionConfig {
    return {
      ...this.config,
      activePatterns: { ...this.config.activePatterns },
      productPatternConfigs: JSON.parse(
        JSON.stringify(this.config.productPatternConfigs)
      ) as Record<string, ProductPatternConfig>,
      customPlanOverrides: JSON.parse(
        JSON.stringify(this.config.customPlanOverrides ?? {})
      ) as Record<string, Record<number, number>>,
      seed: this.config.seed || DEFAULT_SESSION_CONFIG.seed,
    };
  }

  private bindEvents() {
    this.container
      .querySelector('#setup-apk-install-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenApkInstall());

    this.container
      .querySelector('#setup-toggle-3d')
      ?.addEventListener('click', () => this.callbacks.onToggle3DPreview());

    this.container
      .querySelector('#setup-saved-sessions-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenSavedSessions());

    this.container
      .querySelector('#setup-resume-btn')
      ?.addEventListener('click', () => this.callbacks.onResumeSaved?.());

    this.container
      .querySelector<HTMLInputElement>('#setup-import-file')
      ?.addEventListener('change', (e) => {
        const input = e.target as HTMLInputElement;
        const file = input.files?.[0];
        if (file) this.callbacks.onImportJsonFile(file);
      });

    this.container
      .querySelector<HTMLInputElement>('#cfg-session-name')
      ?.addEventListener('input', (e) => {
        this.config.sessionName = (e.target as HTMLInputElement).value;
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-horizon-mode]')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          this.config.horizonMode = btn.dataset.horizonMode as HorizonMode;
          this.render();
        })
      );

    this.container
      .querySelector<HTMLInputElement>('#cfg-product-count')
      ?.addEventListener('input', (e) => {
        this.config.productCount = Number((e.target as HTMLInputElement).value);
        this.render();
      });

    this.container
      .querySelector<HTMLInputElement>('#cfg-volatility')
      ?.addEventListener('input', (e) => {
        this.config.volatilityMultiplier = Number((e.target as HTMLInputElement).value);
        this.render();
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-volatility-preset]')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          this.config.volatilityMultiplier = Number(btn.dataset.volatilityPreset);
          this.render();
        })
      );

    this.container
      .querySelectorAll<HTMLInputElement>('[data-pattern-key]')
      .forEach((cb) =>
        cb.addEventListener('change', () => {
          const key = cb.dataset.patternKey as keyof ActivePatternsConfig;
          this.config.activePatterns[key] = cb.checked;
          this.render();
        })
      );

    this.container
      .querySelector<HTMLSelectElement>('#cfg-start-month')
      ?.addEventListener('change', (e) => {
        this.config.startMonth = Number((e.target as HTMLSelectElement).value) || 11;
        const anchored = anchorHijriStart(this.config.startYear, this.config.startMonth);
        this.config.startHijriYear = anchored.hijriYear;
        this.config.startHijriMonth = anchored.hijriMonth;
        this.render();
      });

    this.container
      .querySelector<HTMLSelectElement>('#cfg-start-year')
      ?.addEventListener('change', (e) => {
        this.config.startYear = Number((e.target as HTMLSelectElement).value) || 2026;
        const anchored = anchorHijriStart(this.config.startYear, this.config.startMonth);
        this.config.startHijriYear = anchored.hijriYear;
        this.config.startHijriMonth = anchored.hijriMonth;
        this.render();
      });

    this.container
      .querySelector<HTMLInputElement>('#cfg-hijri-effects-enabled')
      ?.addEventListener('change', (e) => {
        this.config.hijriEffectsEnabled = (e.target as HTMLInputElement).checked;
        this.render();
      });

    this.container
      .querySelector<HTMLInputElement>('#cfg-seasonal-events-enabled')
      ?.addEventListener('change', (e) => {
        this.config.seasonalEventsEnabled = (e.target as HTMLInputElement).checked;
        this.render();
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-seasonal-impact]')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          this.config.seasonalEventImpactPct = Number(btn.dataset.seasonalImpact) || 0.5;
          this.render();
        })
      );

    this.container
      .querySelector('#setup-reset-patterns')
      ?.addEventListener('click', () => {
        this.config.productPatternConfigs = buildDefaultProductPatternConfigs();
        this.config.customPlanOverrides = {};
        this.render();
      });

    this.container
      .querySelectorAll<HTMLSelectElement>('[data-product-pattern]')
      .forEach((sel) =>
        sel.addEventListener('change', () => {
          const cid = sel.dataset.productPattern!;
          const pattern = sel.value as Exclude<PatternFamily, 'neutral'>;
          const prev = this.config.productPatternConfigs[cid] ?? { pattern };
          const spec = COMMODITIES_CATALOG.find((c) => c.id === cid);
          const fallbackOther =
            COMMODITIES_CATALOG.find((c) => c.id !== cid)?.id ?? 'firewood';
          this.config.productPatternConfigs[cid] = {
            ...prev,
            pattern,
            seasonalPeak: prev.seasonalPeak ?? 'winter',
            customMonthlyPrices:
              prev.customMonthlyPrices ??
              buildDefaultCustomMonthlyPrices(spec?.basePrice ?? 100),
            numericRule: prev.numericRule ?? 'even_up_odd_down',
            linkedCommodityId:
              prev.linkedCommodityId && prev.linkedCommodityId !== cid
                ? prev.linkedCommodityId
                : fallbackOther,
            correlationDirection: prev.correlationDirection ?? 'direct',
            lagMonths: prev.lagMonths ?? 0,
          };
          this.render();
        })
      );

    this.container
      .querySelectorAll<HTMLSelectElement>('[data-product-seasonal]')
      .forEach((sel) =>
        sel.addEventListener('change', () => {
          const cid = sel.dataset.productSeasonal!;
          const spec = COMMODITIES_CATALOG.find((c) => c.id === cid);
          const prev = this.config.productPatternConfigs[cid];
          const nextPeak = sel.value as SeasonalPeak;
          this.config.productPatternConfigs[cid] = {
            ...prev,
            pattern: 'seasonal_monthly',
            seasonalPeak: nextPeak,
            customMonthlyPrices:
              prev?.customMonthlyPrices ??
              buildDefaultCustomMonthlyPrices(spec?.basePrice ?? 100),
          };
          this.render();
        })
      );

    this.container
      .querySelectorAll<HTMLInputElement>('[data-custom-month]')
      .forEach((inp) =>
        inp.addEventListener('change', () => {
          const cid = inp.dataset.customMonth!;
          const slot = Number(inp.dataset.monthSlot);
          const spec = COMMODITIES_CATALOG.find((c) => c.id === cid);
          const prev = this.config.productPatternConfigs[cid];
          const arr = [
            ...(prev?.customMonthlyPrices ??
              buildDefaultCustomMonthlyPrices(spec?.basePrice ?? 100)),
          ];
          const val = Math.max(1, Math.round(Number(inp.value) || spec?.basePrice || 1));
          arr[slot] = val;
          inp.value = String(val);
          this.config.productPatternConfigs[cid] = {
            ...prev,
            pattern: 'seasonal_monthly',
            seasonalPeak: 'custom',
            customMonthlyPrices: arr,
          };
        })
      );

    this.container
      .querySelectorAll<HTMLSelectElement>('[data-product-numeric]')
      .forEach((sel) =>
        sel.addEventListener('change', () => {
          const cid = sel.dataset.productNumeric!;
          this.config.productPatternConfigs[cid] = {
            ...this.config.productPatternConfigs[cid],
            pattern: 'numeric_month_rule',
            numericRule: sel.value as NumericMonthRule,
          };
        })
      );

    this.container
      .querySelectorAll<HTMLSelectElement>('[data-product-link-dir]')
      .forEach((sel) =>
        sel.addEventListener('change', () => {
          const cid = sel.dataset.productLinkDir!;
          this.config.productPatternConfigs[cid] = {
            ...this.config.productPatternConfigs[cid],
            pattern: 'linked_commodity',
            correlationDirection: sel.value as CorrelationDirection,
          };
        })
      );

    this.container
      .querySelectorAll<HTMLSelectElement>('[data-product-link-target]')
      .forEach((sel) =>
        sel.addEventListener('change', () => {
          const cid = sel.dataset.productLinkTarget!;
          this.config.productPatternConfigs[cid] = {
            ...this.config.productPatternConfigs[cid],
            pattern: 'linked_commodity',
            linkedCommodityId: sel.value,
          };
        })
      );

    this.container
      .querySelectorAll<HTMLSelectElement>('[data-product-link-lag]')
      .forEach((sel) =>
        sel.addEventListener('change', () => {
          const cid = sel.dataset.productLinkLag!;
          this.config.productPatternConfigs[cid] = {
            ...this.config.productPatternConfigs[cid],
            pattern: 'linked_commodity',
            lagMonths: Number(sel.value) === 1 ? 1 : 0,
          };
        })
      );

    this.container
      .querySelector<HTMLInputElement>('#cfg-starting-cash')
      ?.addEventListener('change', (e) => {
        this.config.startingCash = Math.max(
          500,
          Number((e.target as HTMLInputElement).value) || 5000
        );
        this.render();
      });

    this.container
      .querySelector<HTMLInputElement>('#cfg-report-cost')
      ?.addEventListener('change', (e) => {
        this.config.secretReportCost = Math.max(
          0,
          Number((e.target as HTMLInputElement).value) || 0
        );
      });

    this.container
      .querySelector<HTMLInputElement>('#cfg-demand-threshold')
      ?.addEventListener('change', (e) => {
        this.config.supplyDemandThreshold = Math.max(
          2,
          Number((e.target as HTMLInputElement).value) || 10
        );
      });

    this.container
      .querySelector<HTMLInputElement>('#cfg-mod-pin')
      ?.addEventListener('input', (e) => {
        this.config.moderatorPin = (e.target as HTMLInputElement).value.trim();
      });

    this.container
      .querySelector('#setup-add-team')
      ?.addEventListener('click', () => {
        if (this.teamNames.length < 6) {
          this.teamNames.push(
            DEFAULT_TEAM_NAMES[this.teamNames.length] ??
              `فريق ${this.teamNames.length + 1}`
          );
          this.render();
        }
      });

    this.container
      .querySelectorAll<HTMLInputElement>('[data-team-index]')
      .forEach((inp) =>
        inp.addEventListener('input', () => {
          const idx = Number(inp.dataset.teamIndex);
          this.teamNames[idx] = inp.value;
        })
      );

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-remove-team]')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.removeTeam);
          if (this.teamNames.length > 2) {
            this.teamNames.splice(idx, 1);
            this.render();
          }
        })
      );

    this.container
      .querySelector('#setup-preview-plan-btn')
      ?.addEventListener('click', () => {
        this.callbacks.onPreviewPlan(this.buildDraftConfig(), [...this.teamNames]);
      });

    this.container
      .querySelector('#setup-start-btn')
      ?.addEventListener('click', () => {
        const finalConfig: SessionConfig = {
          ...this.buildDraftConfig(),
          seed: Date.now() % 10000000,
        };
        this.callbacks.onStartSession(finalConfig, this.teamNames);
      });

    this.container
      .querySelector('#setup-quickstart-btn')
      ?.addEventListener('click', () => {
        this.callbacks.onStartSession(
          {
            ...DEFAULT_SESSION_CONFIG,
            activePatterns: { ...DEFAULT_SESSION_CONFIG.activePatterns },
            productPatternConfigs: buildDefaultProductPatternConfigs(),
            customPlanOverrides: {},
            seed: DEFAULT_SESSION_CONFIG.seed,
          },
          DEFAULT_TEAM_NAMES.slice(0, 4)
        );
      });
  }

  private escapeAttr(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
}

export { CATEGORY_LABELS, COMMODITIES_CATALOG };
