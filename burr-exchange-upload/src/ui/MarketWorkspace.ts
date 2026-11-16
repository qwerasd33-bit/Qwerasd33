import { CATEGORY_LABELS } from '../constants';
import {
  getActiveHijriImpacts,
  getActiveSeasonalEvent,
  getCommoditySpec,
  getDualCalendarForMonth,
  getEffectivePrice,
  getLeaderboard,
  getNextSeasonalEventMonth,
  getPlayedSeasonalEvents,
  getPreviousMonthDelta,
  getVisibleHistory,
  getYearAndMonthDisplay,
} from '../engine/marketEngine';
import { pwaInstallService } from '../services/PwaInstallService';
import { CommodityCategory, GameState, HijriCommodityImpact } from '../types';
import { renderProgressiveChartSvg } from './chartSvg';
import { icons } from './icons';

export interface MarketWorkspaceCallbacks {
  onAdvanceMonth: () => void;
  onOpenTeamFunding: () => void;
  onOpenTradeModal: (teamId: string) => void;
  onOpenSecretReportModal: (teamId: string, commodityId?: string) => void;
  onToggleModeratorBar: () => void;
  onUndo: () => void;
  onOpenOverrideModal: (commodityId?: string) => void;
  onOpenMonthlyPlanEditor: () => void;
  onEndUnlimitedSession: () => void;
  onOpenCheatSheet: () => void;
  onExportJson: () => void;
  onImportJsonFile: (file: File) => void;
  onOpenSetup: () => void;
  onToggle3DZen: () => void;
  onOpenSeasonalEventModal: (monthIndex?: number) => void;
  onOpenSavedSessions: () => void;
  onOpenResetModal: () => void;
  onOpenApkInstall: () => void;
}

export class MarketWorkspace {
  private container: HTMLElement;
  private callbacks: MarketWorkspaceCallbacks;
  private selectedCategory: CommodityCategory | 'all' = 'all';
  private selectedCommodityId = '';
  private expandedTeamHints: Set<string> = new Set();

  constructor(container: HTMLElement, callbacks: MarketWorkspaceCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public render(
    state: GameState,
    moderatorVisible: boolean,
    is3DZenMode: boolean,
    toastMessage: string | null
  ) {
    if (
      !this.selectedCommodityId ||
      !state.market.seriesById[this.selectedCommodityId]
    ) {
      this.selectedCommodityId = state.market.activeCommodityIds[0] ?? '';
    }

    if (is3DZenMode) {
      this.container.innerHTML = `
        <div class="fixed top-4 right-4 z-40 flex items-center gap-3" data-testid="zen-3d-bar">
          <button
            type="button"
            id="ws-exit-3d"
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#161a22]/95 border border-[#d4a853]/40 text-sm font-semibold text-[#d4a853] hover:bg-[#1d222d] transition-colors whitespace-nowrap shrink-0"
          >
            ${icons.chevronLeft}
            <span>العودة للوحة التداول</span>
          </button>
        </div>
      `;
      this.container
        .querySelector('#ws-exit-3d')
        ?.addEventListener('click', () => this.callbacks.onToggle3DZen());
      return;
    }

    const { year, monthInYear, absoluteMonth } = getYearAndMonthDisplay(
      state.currentMonthIndex
    );
    const dual = getDualCalendarForMonth(state.config, state.currentMonthIndex);
    const isUnlimited = state.config.horizonMode === 'unlimited';
    const isFinalFixedMonth = !isUnlimited && absoluteMonth >= state.config.totalMonths;

    const leaderboard = getLeaderboard(state);
    const selectedSpec = getCommoditySpec(this.selectedCommodityId);
    const selectedHistory = this.selectedCommodityId
      ? getVisibleHistory(state, this.selectedCommodityId)
      : [];

    const filteredIds = state.market.activeCommodityIds.filter((cid) => {
      if (this.selectedCategory === 'all') return true;
      return getCommoditySpec(cid)?.category === this.selectedCategory;
    });

    const minHist = selectedHistory.length ? Math.min(...selectedHistory) : 0;
    const maxHist = selectedHistory.length ? Math.max(...selectedHistory) : 0;
    const currHist = selectedHistory.length
      ? selectedHistory[selectedHistory.length - 1]
      : 0;

    const activeSeasonalEvent = getActiveSeasonalEvent(
      state.market,
      state.currentMonthIndex
    );
    const nextEventMonth = getNextSeasonalEventMonth(state);
    const playedEvents = getPlayedSeasonalEvents(state);
    const hijriImpacts = getActiveHijriImpacts(state.market, state.currentMonthIndex);
    const hijriImpactByCid: Record<string, HijriCommodityImpact> = {};
    for (const imp of hijriImpacts) {
      hijriImpactByCid[imp.commodityId] = imp;
    }
    const monthDuals = Array.from({ length: absoluteMonth }, (_, idx) =>
      getDualCalendarForMonth(state.config, idx)
    );

    const pwaState = pwaInstallService.getState();

    this.container.innerHTML = `
      <div class="h-full w-full flex flex-col bg-[#0d0f14]/88 text-[#f5f0e6] overflow-y-auto lg:overflow-hidden" data-testid="market-workspace">
        ${
          !pwaState.isOnline
            ? `<div class="bg-[#b45309] text-white text-xs font-medium px-4 py-1.5 flex items-center justify-center gap-2 shrink-0" role="status" data-testid="offline-indicator">
                ${icons.wifiOff}
                <span>وضع عدم الاتصال — يعمل التطبيق بالبيانات المخزنة محلياً</span>
              </div>`
            : ''
        }
        <!-- 3-Zone Top Bar (Timeless Month Mode) -->
        <header class="px-4 lg:px-5 py-2.5 lg:py-3 border-b border-[#d4a853]/20 bg-[#161a22]/95 flex flex-wrap items-center justify-between gap-2.5 lg:gap-4 shrink-0">
          <!-- Zone 1: Brand Title -->
          <div class="flex items-center gap-3 min-w-0">
            <span class="font-display text-lg font-bold text-[#d4a853] whitespace-nowrap shrink-0">
              بورصة البر والفعاليات
            </span>
            <span class="hidden xl:inline text-xs text-[#9ca3af] truncate max-w-[200px]">
              · ${state.config.sessionName}
            </span>
          </div>

          <!-- Zone 2: Timeless Month Progression & Team Funding -->
          <div class="flex flex-wrap items-center gap-2.5">
            <div class="flex flex-wrap items-center gap-2 text-sm font-medium text-[#f5f0e6] bg-[#0d0f14] border border-[#f5f0e6]/12 rounded-lg px-3 py-1.5" data-testid="timeline-readout">
              <span class="font-display font-bold text-[#d4a853]">السنة ${year}</span>
              <span class="text-[#9ca3af]" aria-hidden="true">·</span>
              <span>الشهر ${monthInYear}</span>
              <span class="text-[#9ca3af]" aria-hidden="true">·</span>
              <span class="font-num text-xs text-[#9ca3af]">${
                isUnlimited
                  ? `الشهر ${absoluteMonth} (مفتوحة الأمد)`
                  : `${absoluteMonth} / ${state.config.totalMonths}`
              }</span>
              <span class="text-[#9ca3af]" aria-hidden="true">|</span>
              <span class="inline-flex items-center gap-1.5 text-xs text-[#34d399]" data-testid="timeline-dual-date">
                ${icons.calendar}
                <span>${dual.gregorianLabel} · ${dual.hijriLabel}</span>
              </span>
            </div>

            <button
              type="button"
              id="ws-team-funding-btn"
              data-testid="team-funding-btn"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-[#34d399] hover:bg-[#10b981]/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              ${icons.plus}
              <span>إضافة سيولة للفرق</span>
            </button>

            <button
              type="button"
              id="ws-advance-month"
              data-testid="advance-month-btn"
              class="px-4 py-2 text-xs font-bold rounded-lg bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              ${isFinalFixedMonth ? 'إنهاء الموسم وإعلان النتائج' : `إغلاق الشهر ${absoluteMonth} والانتقال`}
            </button>
          </div>

          <!-- Zone 3: View, Storage, Reset & Moderator Switch -->
          <div class="flex flex-wrap items-center gap-2 max-w-full">
            ${
              pwaState.runtimeMode !== 'capacitor_native'
                ? `<button
                    type="button"
                    id="ws-apk-install-btn"
                    data-testid="ws-apk-install-btn"
                    class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#0d0f14] rounded-lg bg-[#10b981] hover:bg-[#34d399] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ${icons.smartphone}
                    <span>${pwaState.isInstalled ? 'APK' : 'تثبيت / APK'}</span>
                  </button>`
                : ''
            }
            <button
              type="button"
              id="ws-saved-sessions-btn"
              data-testid="saved-sessions-btn"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#d4a853] rounded-lg border border-[#d4a853]/35 bg-[#d4a853]/10 hover:bg-[#d4a853]/20 whitespace-nowrap shrink-0 cursor-pointer"
            >
              ${icons.bookmark}
              <span>حفظ / استرجاع</span>
            </button>
            <button
              type="button"
              id="ws-reset-btn"
              data-testid="reset-exchange-btn"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-[#fca5a5] rounded-lg border border-[#ef4444]/35 bg-[#ef4444]/10 hover:bg-[#ef4444]/20 whitespace-nowrap shrink-0 cursor-pointer"
            >
              ${icons.reset}
              <span>إعادة البورصة</span>
            </button>
            <button
              type="button"
              id="ws-open-setup"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg border border-[#f5f0e6]/10 hover:border-[#f5f0e6]/25 whitespace-nowrap shrink-0"
            >
              ${icons.sliders}
              <span>جلسة جديدة</span>
            </button>
            <button
              type="button"
              id="ws-toggle-3d"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-[#f5f0e6] rounded-lg border border-[#f5f0e6]/15 hover:border-[#d4a853]/50 whitespace-nowrap shrink-0"
            >
              ${icons.cube}
              <span>عرض 3D</span>
            </button>
            <button
              type="button"
              id="ws-toggle-mod"
              data-testid="toggle-moderator-btn"
              class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border whitespace-nowrap shrink-0 transition-colors ${
                moderatorVisible
                  ? 'bg-[#d4a853]/15 text-[#d4a853] border-[#d4a853]/50'
                  : 'bg-[#0d0f14] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
              }"
            >
              ${moderatorVisible ? icons.eyeOff : icons.lock}
              <span>${moderatorVisible ? 'إخفاء أدوات المدير' : 'لوحة المدير'}</span>
            </button>
          </div>
        </header>

        <!-- Protected Moderator Toolbar -->
        ${
          moderatorVisible
            ? `<div class="px-5 py-2.5 bg-[#1d222d] border-b border-[#d4a853]/30 flex flex-wrap items-center justify-between gap-3 shrink-0" data-testid="moderator-bar">
                <div class="flex items-center gap-2 text-xs font-semibold text-[#d4a853]">
                  <span>أدوات مدير الجلسة المحمية</span>
                  <span class="text-[#9ca3af] font-normal">· تعديل الأسعار الشهرية وإدارة الجلسة</span>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    id="mod-undo-btn"
                    data-testid="mod-undo-btn"
                    ${state.undoStack.length === 0 ? 'disabled' : ''}
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#f5f0e6] hover:border-[#d4a853]/50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                  >
                    ${icons.undo}
                    <span>تراجع خطوة (${state.undoStack.length})</span>
                  </button>
                  <button
                    type="button"
                    id="mod-monthly-plan-btn"
                    data-testid="mod-monthly-plan-btn"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#d4a853]/15 border border-[#d4a853]/45 text-[#d4a853] hover:bg-[#d4a853]/25 whitespace-nowrap shrink-0"
                  >
                    ${icons.edit}
                    <span>تعديل المنتجات شهرياً</span>
                  </button>
                  <button
                    type="button"
                    id="mod-override-btn"
                    data-testid="mod-override-btn"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#f5f0e6] hover:border-[#d4a853]/50 whitespace-nowrap shrink-0"
                  >
                    ${icons.edit}
                    <span>تعديل سعر الشهر الحالي</span>
                  </button>
                  <button
                    type="button"
                    id="mod-cheatsheet-btn"
                    data-testid="mod-cheatsheet-btn"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#0d0f14] border border-[#d4a853]/35 text-[#d4a853] hover:bg-[#d4a853]/15 whitespace-nowrap shrink-0"
                  >
                    ${icons.book}
                    <span>دليل المدير السري</span>
                  </button>
                  <button
                    type="button"
                    id="mod-export-btn"
                    data-testid="mod-export-btn"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#f5f0e6] hover:border-[#d4a853]/50 whitespace-nowrap shrink-0"
                  >
                    ${icons.save}
                    <span>حفظ وتصدير JSON</span>
                  </button>
                  <label class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#f5f0e6] hover:border-[#d4a853]/50 cursor-pointer whitespace-nowrap shrink-0">
                    ${icons.upload}
                    <span>استيراد JSON</span>
                    <input type="file" id="mod-import-file" accept=".json,application/json" class="sr-only" />
                  </label>
                  <button
                    type="button"
                    id="mod-reset-btn"
                    data-testid="mod-reset-btn"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#ef4444]/15 border border-[#ef4444]/40 text-[#fca5a5] hover:bg-[#ef4444]/25 whitespace-nowrap shrink-0"
                  >
                    ${icons.reset}
                    <span>إعادة من الشهر 1</span>
                  </button>
                  ${
                    isUnlimited
                      ? `<button
                          type="button"
                          id="mod-end-session-btn"
                          data-testid="mod-end-session-btn"
                          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#ef4444]/15 border border-[#ef4444]/40 text-[#fca5a5] hover:bg-[#ef4444]/25 whitespace-nowrap shrink-0"
                        >
                          ${icons.trophy}
                          <span>إنهاء الجلسة وإعلان النتائج</span>
                        </button>`
                      : ''
                  }
                </div>
              </div>`
            : ''
        }

        ${
          toastMessage
            ? `<div class="px-5 py-2 bg-[#10b981]/15 border-b border-[#10b981]/30 text-xs text-[#ecfdf5] flex items-center justify-between shrink-0" role="status">
                <span>${toastMessage}</span>
              </div>`
            : ''
        }

        <!-- Main Workspace 2-Column Layout -->
        <main class="flex-1 lg:overflow-y-auto p-3.5 lg:p-5">
          <div class="max-w-[1440px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <!-- Primary Column (8 cols): Market Board + Historical Chart + Cumulative Table -->
            <div class="lg:col-span-8 space-y-5">
              <!-- Market Board -->
              <section class="bg-[#161a22] border border-[#f5f0e6]/10 rounded-xl p-4 sm:p-5">
                <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <h1 class="font-display text-lg font-bold text-[#f5f0e6]">لوحة أسعار الشهر الحالي (${state.market.activeCommodityIds.length} سلعة)</h1>
                      ${
                        state.config.seasonalEventsEnabled && nextEventMonth !== null
                          ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                              activeSeasonalEvent
                                ? 'bg-[#d4a853]/15 border-[#d4a853]/50 text-[#d4a853]'
                                : 'bg-[#0d0f14] border-[#f5f0e6]/15 text-[#9ca3af]'
                            }" data-testid="seasonal-event-cadence-badge">
                              ${icons.bolt}
                              <span>${
                                activeSeasonalEvent
                                  ? `حدث موسمي نشط هذا الشهر`
                                  : `الحدث الموسمي القادم: الشهر ${nextEventMonth}`
                              }</span>
                            </span>`
                          : ''
                      }
                    </div>
                    <p class="text-xs text-[#9ca3af] mt-0.5">اضغط على أي سلعة لعرض مسارها التاريخي منذ الشهر 1 وحتى الشهر ${absoluteMonth} فقط.</p>
                  </div>

                  <!-- Category Filter Tabs -->
                  <div class="flex flex-wrap items-center gap-1 p-1 bg-[#0d0f14] rounded-lg border border-[#f5f0e6]/10" role="tablist" aria-label="تصفية حسب الفئة">
                    <button
                      type="button"
                      data-cat-filter="all"
                      class="px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        this.selectedCategory === 'all'
                          ? 'bg-[#d4a853] text-[#0d0f14] font-bold'
                          : 'text-[#9ca3af] hover:text-[#f5f0e6]'
                      }"
                    >الكل</button>
                    ${(Object.keys(CATEGORY_LABELS) as CommodityCategory[])
                      .map(
                        (cat) => `
                      <button
                        type="button"
                        data-cat-filter="${cat}"
                        class="px-2.5 py-1 text-xs rounded-md transition-colors whitespace-nowrap shrink-0 ${
                          this.selectedCategory === cat
                            ? 'bg-[#d4a853] text-[#0d0f14] font-bold'
                            : 'text-[#9ca3af] hover:text-[#f5f0e6]'
                        }"
                      >${CATEGORY_LABELS[cat]}</button>
                    `
                      )
                      .join('')}
                  </div>
                </div>

                ${
                  activeSeasonalEvent
                    ? `<div
                        class="mb-4 p-4 rounded-xl border ${
                          activeSeasonalEvent.direction === 'up'
                            ? 'bg-[#10b981]/10 border-[#10b981]/45'
                            : 'bg-[#ef4444]/10 border-[#ef4444]/45'
                        } flex flex-wrap items-center justify-between gap-3"
                        data-testid="seasonal-event-banner"
                        role="region"
                        aria-label="الحدث الموسمي لهذا الشهر"
                      >
                        <div class="space-y-1 min-w-0 flex-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-[#0d0f14]/80 text-[#d4a853] border border-[#d4a853]/40">
                              ${icons.bolt}
                              <span>حدث موسمي · الشهر ${activeSeasonalEvent.monthIndex + 1}</span>
                            </span>
                            <span class="font-display text-sm font-bold text-[#f5f0e6]">${activeSeasonalEvent.title}</span>
                          </div>
                          <p class="text-xs text-[#f5f0e6]/90 leading-relaxed">
                            <strong class="text-[#d4a853]">السبب:</strong> ${activeSeasonalEvent.reason}
                          </p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2.5 shrink-0">
                          <div class="px-3 py-2 rounded-lg bg-[#0d0f14]/85 border border-[#f5f0e6]/15 text-left">
                            <div class="text-[11px] text-[#9ca3af]">المنتج المستهدف فقط</div>
                            <div class="flex items-center gap-2 mt-0.5">
                              <span class="font-display text-sm font-bold text-[#f5f0e6]" data-testid="seasonal-event-target">${activeSeasonalEvent.commodityName}</span>
                              <span class="inline-flex items-center gap-1 font-num text-xs font-bold ${
                                activeSeasonalEvent.direction === 'up'
                                  ? 'text-[#10b981]'
                                  : 'text-[#ef4444]'
                              }">
                                ${activeSeasonalEvent.direction === 'up' ? icons.arrowUp : icons.arrowDown}
                                <span dir="ltr">${activeSeasonalEvent.priceDelta > 0 ? '+' : ''}${activeSeasonalEvent.priceDelta}</span>
                                <span>ر.س</span>
                                <span dir="ltr">(${activeSeasonalEvent.direction === 'up' ? '+' : '-'}${Math.round(activeSeasonalEvent.impactPct * 100)}%)</span>
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            data-open-seasonal-modal="${activeSeasonalEvent.monthIndex}"
                            data-testid="reopen-seasonal-modal-btn"
                            class="px-3 py-2 text-xs font-bold rounded-lg bg-[#0d0f14] border border-[#d4a853]/45 text-[#d4a853] hover:bg-[#d4a853]/15 transition-colors cursor-pointer"
                          >عرض النافذة</button>
                        </div>
                      </div>`
                    : ''
                }

                ${
                  hijriImpacts.length > 0
                    ? `<div
                        class="mb-4 p-3.5 rounded-xl border border-[#10b981]/45 bg-[#10b981]/10 space-y-2"
                        data-testid="hijri-effects-banner"
                        role="region"
                        aria-label="تأثير الشهر الهجري على الأسعار"
                      >
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div class="flex items-center gap-2">
                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-[#0d0f14]/85 text-[#34d399] border border-[#10b981]/40">
                              ${icons.calendar}
                              <span>موسم ${dual.hijriMonthName} ${dual.hijriYear} هـ</span>
                            </span>
                            <span class="font-display text-sm font-bold text-[#f5f0e6]">تأثير الشهور الهجرية على السوق</span>
                          </div>
                          <span class="text-[11px] text-[#9ca3af]">${dual.gregorianLabel}</span>
                        </div>
                        <div class="flex flex-wrap gap-2">
                          ${hijriImpacts
                            .map((imp) => {
                              const isPos = imp.impactPct >= 0;
                              const pct = Math.round(Math.abs(imp.impactPct) * 100);
                              return `
                              <div class="px-2.5 py-1.5 rounded-lg bg-[#0d0f14]/85 border ${
                                isPos ? 'border-[#10b981]/40' : 'border-[#ef4444]/40'
                              } text-xs flex items-center gap-2">
                                <span class="font-bold text-[#f5f0e6]">${imp.commodityName}</span>
                                <span class="font-num font-bold ${isPos ? 'text-[#34d399]' : 'text-[#fca5a5]'}" dir="ltr">${
                                  isPos ? '+' : '-'
                                }${pct}% (${imp.priceDelta > 0 ? '+' : ''}${imp.priceDelta})</span>
                                <span class="text-[#9ca3af]">· ${imp.title}</span>
                              </div>
                            `;
                            })
                            .join('')}
                        </div>
                      </div>`
                    : ''
                }

                <!-- Commodity Price Cards Grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" data-testid="commodity-grid">
                  ${filteredIds
                    .map((cid) => {
                      const spec = getCommoditySpec(cid);
                      if (!spec) return '';
                      const { current, delta, deltaPct } = getPreviousMonthDelta(
                        state.market,
                        cid,
                        state.currentMonthIndex
                      );
                      const isSelected = cid === this.selectedCommodityId;
                      const isEventTarget = activeSeasonalEvent?.commodityId === cid;
                      const hijriImp = hijriImpactByCid[cid];
                      const eventBorder = isEventTarget
                        ? activeSeasonalEvent?.direction === 'up'
                          ? 'border-[#10b981]/65 bg-[#10b981]/8'
                          : 'border-[#ef4444]/65 bg-[#ef4444]/8'
                        : hijriImp
                          ? hijriImp.impactPct >= 0
                            ? 'border-[#10b981]/45 bg-[#0d0f14]'
                            : 'border-[#ef4444]/40 bg-[#0d0f14]'
                          : isSelected
                            ? 'bg-[#1d222d] border-[#d4a853]'
                            : 'bg-[#0d0f14] border-[#f5f0e6]/10 hover:border-[#d4a853]/45';
                      const deltaColor =
                        delta > 0
                          ? 'text-[#10b981]'
                          : delta < 0
                            ? 'text-[#ef4444]'
                            : 'text-[#9ca3af]';
                      const deltaArrow =
                        delta > 0
                          ? icons.arrowUp
                          : delta < 0
                            ? icons.arrowDown
                            : icons.minus;

                      return `
                      <button
                        type="button"
                        data-select-commodity="${cid}"
                        data-testid="commodity-card-${cid}"
                        class="text-right p-3.5 rounded-lg border transition-colors cursor-pointer flex flex-col justify-between gap-2 ${eventBorder}"
                      >
                        <div class="flex items-start justify-between gap-2 w-full">
                          <div class="min-w-0">
                            <div class="text-sm font-bold text-[#f5f0e6] truncate">${spec.name}</div>
                            <div class="text-xs text-[#9ca3af] mt-0.5">${CATEGORY_LABELS[spec.category]} · ${spec.unit}</div>
                          </div>
                          <div class="flex flex-col items-end gap-1 shrink-0">
                            ${
                              isEventTarget && activeSeasonalEvent
                                ? `<span
                                    data-testid="commodity-seasonal-badge-${cid}"
                                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                      activeSeasonalEvent.direction === 'up'
                                        ? 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40'
                                        : 'bg-[#ef4444]/20 text-[#fca5a5] border border-[#ef4444]/40'
                                    }"
                                  >${icons.bolt}<span>${
                                    activeSeasonalEvent.direction === 'up' ? 'حدث ▲' : 'حدث ▼'
                                  }</span></span>`
                                : ''
                            }
                            ${
                              hijriImp
                                ? `<span
                                    data-testid="commodity-hijri-badge-${cid}"
                                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                      hijriImp.impactPct >= 0
                                        ? 'bg-[#10b981]/15 text-[#34d399] border border-[#10b981]/35'
                                        : 'bg-[#ef4444]/15 text-[#fca5a5] border border-[#ef4444]/35'
                                    }"
                                  ><span>${hijriImp.hijriMonthName}</span><span dir="ltr" class="font-num">${
                                    hijriImp.impactPct >= 0 ? '+' : '-'
                                  }${Math.round(Math.abs(hijriImp.impactPct) * 100)}%</span></span>`
                                : ''
                            }
                          </div>
                        </div>

                        <div class="flex items-baseline justify-between gap-2 w-full pt-1 border-t border-[#f5f0e6]/8">
                          <span class="font-num text-lg font-bold text-[#f5f0e6]">
                            ${current} <span class="text-xs font-normal text-[#9ca3af]">ر.س</span>
                          </span>
                          <span class="inline-flex items-center gap-1 font-num text-xs font-semibold ${deltaColor}">
                            ${deltaArrow}
                            <span dir="ltr">${
                              state.currentMonthIndex === 0
                                ? 'افتتاح'
                                : delta === 0
                                  ? 'ثابت (0)'
                                  : `${delta > 0 ? '+' : ''}${delta} (${delta > 0 ? '+' : ''}${deltaPct}%)`
                            }</span>
                          </span>
                        </div>
                      </button>
                    `;
                    })
                    .join('')}
                </div>
              </section>

              <!-- Progressive Historical Chart & Cumulative Table -->
              <section class="bg-[#161a22] border border-[#f5f0e6]/10 rounded-xl p-4 sm:p-5 space-y-4">
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-[#f5f0e6]/10 pb-3">
                  <div>
                    <h2 class="font-display text-base font-bold text-[#f5f0e6]">
                      المسار التاريخي المتدرج: <span class="text-[#d4a853]">${selectedSpec?.name ?? ''}</span>
                    </h2>
                    <p class="text-xs text-[#9ca3af] mt-0.5">
                      يعرض فقط الأشهر المفتوحة (الشهر 1 حتى الشهر ${absoluteMonth}) — المستقبل في منطقة المجهول.
                    </p>
                  </div>
                  <div class="flex items-center gap-4 text-xs font-num">
                    <span class="text-[#9ca3af]">الأدنى: <strong class="text-[#f5f0e6]">${minHist}</strong></span>
                    <span class="text-[#9ca3af]">الأعلى: <strong class="text-[#f5f0e6]">${maxHist}</strong></span>
                    <span class="text-[#9ca3af]">الحالي: <strong class="text-[#d4a853]">${currHist} ر.س</strong></span>
                  </div>
                </div>

                <div class="bg-[#0d0f14] border border-[#f5f0e6]/10 rounded-lg p-3" data-testid="progressive-chart-box">
                  ${
                    selectedSpec
                      ? renderProgressiveChartSvg(
                          selectedHistory,
                          selectedSpec.name,
                          selectedSpec.unit,
                          monthDuals.map((d) => d.shortLabel)
                        )
                      : ''
                  }
                </div>

                <!-- Cumulative Month-by-Month Matrix -->
                <div>
                  <h3 class="text-xs font-semibold text-[#9ca3af] mb-2">الجدول التراكمي للأشهر الملعوبة (ر.س) — بالتاريخين الهجري والميلادي</h3>
                  <div class="overflow-x-auto border border-[#f5f0e6]/10 rounded-lg">
                    <table class="w-full text-right border-collapse text-xs" data-testid="cumulative-history-table">
                      <thead>
                        <tr class="bg-[#0d0f14] border-b border-[#f5f0e6]/10 text-[#9ca3af]">
                          <th class="py-2 px-3 sticky right-0 bg-[#0d0f14] font-semibold min-w-[140px]">السلعة</th>
                          ${monthDuals
                            .map(
                              (d, idx) =>
                                `<th class="py-1.5 px-2.5 font-num text-center whitespace-nowrap" title="${d.shortLabel}">
                                  <div>ش${idx + 1}</div>
                                  <div class="text-[10px] font-normal text-[#34d399]/80 font-sans">${d.hijriMonthName}</div>
                                  <div class="text-[9px] font-normal text-[#9ca3af]/75 font-sans">${d.gregorianMonthName}</div>
                                </th>`
                            )
                            .join('')}
                        </tr>
                      </thead>
                      <tbody>
                        ${state.market.activeCommodityIds
                          .map((cid) => {
                            const spec = getCommoditySpec(cid);
                            const rowHighlight =
                              cid === this.selectedCommodityId
                                ? 'bg-[#1d222d]'
                                : 'bg-[#161a22] hover:bg-[#1d222d]/60';
                            const cells = Array.from(
                              { length: absoluteMonth },
                              (_, m) => {
                                const p = getEffectivePrice(state.market, cid, m);
                                const prev =
                                  m > 0
                                    ? getEffectivePrice(state.market, cid, m - 1)
                                    : p;
                                const cls =
                                  m === 0 || p === prev
                                    ? 'text-[#f5f0e6]'
                                    : p > prev
                                      ? 'text-[#10b981]'
                                      : 'text-[#ef4444]';
                                return `<td class="py-2 px-2.5 font-num text-center ${cls}">${p}</td>`;
                              }
                            ).join('');

                            return `
                            <tr class="border-b border-[#f5f0e6]/8 last:border-0 ${rowHighlight} cursor-pointer" data-select-commodity="${cid}">
                              <td class="py-2 px-3 font-medium text-[#f5f0e6] sticky right-0 bg-inherit whitespace-nowrap">${spec?.name ?? cid}</td>
                              ${cells}
                            </tr>
                          `;
                          })
                          .join('')}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>

            <!-- Secondary Column (4 cols): Team Leaderboard & Portfolios + Activity Log -->
            <div class="lg:col-span-4 space-y-5">
              <section class="bg-[#161a22] border border-[#f5f0e6]/10 rounded-xl p-4 sm:p-5 space-y-4">
                <div class="flex items-center justify-between border-b border-[#f5f0e6]/10 pb-3">
                  <div>
                    <h2 class="font-display text-base font-bold text-[#f5f0e6]">لوحة الصدارة ومحافظ الفرق</h2>
                    <p class="text-xs text-[#9ca3af] mt-0.5">مرتبة تنازلياً حسب إجمالي صافي الثروة.</p>
                  </div>
                  <button
                    type="button"
                    id="ws-quick-trade-btn"
                    data-testid="quick-trade-btn"
                    class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] transition-colors whitespace-nowrap shrink-0"
                  >
                    ${icons.trade}
                    <span>صفقة سريعة</span>
                  </button>
                </div>

                <div class="space-y-3" data-testid="leaderboard-list">
                  ${leaderboard
                    .map((entry) => {
                      const t = entry.team;
                      const holdingsList = Object.entries(t.holdings)
                        .filter(([, q]) => q > 0)
                        .map(([cid, q]) => {
                          const s = getCommoditySpec(cid);
                          return `${s?.name ?? cid} ×${q}`;
                        });
                      const hintsExpanded = this.expandedTeamHints.has(t.id);

                      return `
                      <div class="p-3.5 rounded-lg bg-[#0d0f14] border ${
                        entry.rank === 1
                          ? 'border-[#d4a853]/45'
                          : 'border-[#f5f0e6]/10'
                      } space-y-2.5" data-testid="team-card-${t.id}">
                        <div class="flex items-center justify-between gap-2">
                          <div class="flex items-center gap-2 min-w-0">
                            <span class="font-num text-xs font-bold ${
                              entry.rank === 1 ? 'text-[#d4a853]' : 'text-[#9ca3af]'
                            }">#${entry.rank}</span>
                            <span class="font-display text-sm font-bold text-[#f5f0e6] truncate">${t.name}</span>
                          </div>
                          <span class="font-num text-base font-bold text-[#f5f0e6] whitespace-nowrap">
                            ${entry.netWorth.toLocaleString('en-US')} <span class="text-xs font-normal text-[#9ca3af]">ر.س</span>
                          </span>
                        </div>

                        <div class="flex items-center justify-between text-xs text-[#9ca3af] font-num">
                          <span>السيولة: <strong class="text-[#f5f0e6]" data-testid="team-cash-${t.id}">${t.cash.toLocaleString('en-US')}</strong></span>
                          <span>الأصول: <strong class="text-[#f5f0e6]">${entry.assetsValue.toLocaleString('en-US')}</strong></span>
                        </div>

                        <div class="text-xs text-[#9ca3af] leading-relaxed">
                          ${
                            holdingsList.length > 0
                              ? `<span class="text-[#f5f0e6]/90">المحفظة: ${holdingsList.join(' · ')}</span>`
                              : `<span class="opacity-65">لا توجد أصول في المحفظة حالياً</span>`
                          }
                        </div>

                        ${
                          t.unlockedHints.length > 0
                            ? `<div class="pt-1">
                                <button
                                  type="button"
                                  data-toggle-hints="${t.id}"
                                  class="text-xs text-[#d4a853] hover:underline"
                                >
                                  ${hintsExpanded ? 'إخفاء' : 'عرض'} التقارير السرية (${t.unlockedHints.length})
                                </button>
                                ${
                                  hintsExpanded
                                    ? `<div class="mt-2 space-y-1.5">
                                        ${t.unlockedHints
                                          .map(
                                            (h) => `
                                          <div class="p-2 rounded bg-[#161a22] border border-[#d4a853]/20 text-xs">
                                            <span class="font-semibold text-[#d4a853]">${h.commodityName}:</span>
                                            <span class="text-[#f5f0e6]"> ${h.text}</span>
                                          </div>
                                        `
                                          )
                                          .join('')}
                                      </div>`
                                    : ''
                                }
                              </div>`
                            : ''
                        }

                        <div class="flex items-center gap-2 pt-1.5 border-t border-[#f5f0e6]/8">
                          <button
                            type="button"
                            data-team-trade="${t.id}"
                            class="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded bg-[#161a22] border border-[#f5f0e6]/15 text-[#f5f0e6] hover:border-[#d4a853]/50 transition-colors whitespace-nowrap"
                          >
                            ${icons.trade}
                            <span>تداول</span>
                          </button>
                          <button
                            type="button"
                            data-team-hint="${t.id}"
                            class="flex-1 inline-flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-semibold rounded bg-[#161a22] border border-[#d4a853]/30 text-[#d4a853] hover:bg-[#d4a853]/10 transition-colors whitespace-nowrap"
                          >
                            ${icons.hint}
                            <span>تقرير سري (${state.config.secretReportCost})</span>
                          </button>
                        </div>
                      </div>
                    `;
                    })
                    .join('')}
                </div>
              </section>

              <!-- Recent Transactions Log -->
              <section class="bg-[#161a22] border border-[#f5f0e6]/10 rounded-xl p-4 space-y-3">
                <div class="flex items-center justify-between">
                  <h2 class="font-display text-sm font-bold text-[#f5f0e6]">سجل الصفقات الأخيرة</h2>
                  <span class="font-num text-xs text-[#9ca3af]">${state.tradeLog.length} عملية</span>
                </div>
                ${
                  state.tradeLog.length === 0
                    ? `<p class="text-xs text-[#9ca3af]/75 py-2">لم تُسجّل صفقات بعد في هذه الجلسة.</p>`
                    : `<div class="space-y-1.5 max-h-52 overflow-y-auto">
                        ${state.tradeLog
                          .slice(0, 12)
                          .map(
                            (tr) => `
                          <div class="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded bg-[#0d0f14] text-xs">
                            <div class="min-w-0 truncate">
                              <span class="font-semibold text-[#f5f0e6]">${tr.teamName}</span>
                              <span class="text-[#9ca3af]"> · ${tr.quantity > 0 ? 'شراء' : 'بيع'} ${Math.abs(tr.quantity)} ${tr.commodityName}</span>
                            </div>
                            <span class="font-num shrink-0 ${
                              tr.quantity > 0 ? 'text-[#ef4444]' : 'text-[#10b981]'
                            }">${tr.quantity > 0 ? '-' : '+'}${tr.totalAmount}</span>
                          </div>
                        `
                          )
                          .join('')}
                      </div>`
                }
              </section>

              ${
                state.config.seasonalEventsEnabled
                  ? `<section class="bg-[#161a22] border border-[#f5f0e6]/10 rounded-xl p-4 space-y-3" data-testid="played-seasonal-events-log">
                      <div class="flex items-center justify-between">
                        <h2 class="font-display text-sm font-bold text-[#f5f0e6] flex items-center gap-1.5">
                          <span class="text-[#d4a853]">${icons.bolt}</span>
                          <span>سجل الأحداث الموسمية (كل 3 شهور)</span>
                        </h2>
                        <span class="font-num text-xs text-[#9ca3af]">${playedEvents.length} حدث</span>
                      </div>
                      ${
                        playedEvents.length === 0
                          ? `<p class="text-xs text-[#9ca3af]/80 leading-relaxed">لم يقع أي حدث موسمي بعد — يبدأ أول حدث في الشهر 3 ويستهدف منتجاً واحداً فقط.</p>`
                          : `<div class="space-y-2 max-h-48 overflow-y-auto">
                              ${playedEvents
                                .map(
                                  (ev) => `
                                <div class="p-2.5 rounded-lg bg-[#0d0f14] border ${
                                  ev.direction === 'up'
                                    ? 'border-[#10b981]/30'
                                    : 'border-[#ef4444]/30'
                                } text-xs flex items-start justify-between gap-2">
                                  <div class="min-w-0 flex-1">
                                    <div class="font-semibold text-[#f5f0e6]">
                                      <span class="font-num text-[#d4a853]">ش${ev.monthIndex + 1}</span> · ${ev.commodityName}: ${ev.title}
                                    </div>
                                    <div class="text-[#9ca3af] text-[11px] mt-0.5">السبب: ${ev.reason}</div>
                                    <button
                                      type="button"
                                      data-open-seasonal-modal="${ev.monthIndex}"
                                      class="text-[11px] text-[#d4a853] hover:underline mt-1 cursor-pointer"
                                    >فتح التفاصيل</button>
                                  </div>
                                  <div class="text-left font-num font-bold shrink-0 ${
                                    ev.direction === 'up' ? 'text-[#10b981]' : 'text-[#ef4444]'
                                  }">
                                    <div dir="ltr">${ev.priceDelta > 0 ? '+' : ''}${ev.priceDelta}</div>
                                    <div class="text-[10px]" dir="ltr">${ev.direction === 'up' ? '+' : '-'}${Math.round(ev.impactPct * 100)}%</div>
                                  </div>
                                </div>
                              `
                                )
                                .join('')}
                            </div>`
                      }
                    </section>`
                  : ''
              }
            </div>
          </div>
        </main>
      </div>
    `;

    this.bindEvents();
  }

  private bindEvents() {
    this.container
      .querySelector('#ws-team-funding-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenTeamFunding());
    this.container
      .querySelector('#ws-advance-month')
      ?.addEventListener('click', () => this.callbacks.onAdvanceMonth());
    this.container
      .querySelector('#ws-apk-install-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenApkInstall());
    this.container
      .querySelector('#ws-saved-sessions-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenSavedSessions());
    this.container
      .querySelector('#ws-reset-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenResetModal());
    this.container
      .querySelector('#ws-open-setup')
      ?.addEventListener('click', () => this.callbacks.onOpenSetup());
    this.container
      .querySelector('#ws-toggle-3d')
      ?.addEventListener('click', () => this.callbacks.onToggle3DZen());
    this.container
      .querySelector('#ws-toggle-mod')
      ?.addEventListener('click', () => this.callbacks.onToggleModeratorBar());

    this.container
      .querySelector('#mod-undo-btn')
      ?.addEventListener('click', () => this.callbacks.onUndo());
    this.container
      .querySelector('#mod-monthly-plan-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenMonthlyPlanEditor());
    this.container
      .querySelector('#mod-override-btn')
      ?.addEventListener('click', () =>
        this.callbacks.onOpenOverrideModal(this.selectedCommodityId)
      );
    this.container
      .querySelector('#mod-cheatsheet-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenCheatSheet());
    this.container
      .querySelector('#mod-reset-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenResetModal());
    this.container
      .querySelector('#mod-end-session-btn')
      ?.addEventListener('click', () => this.callbacks.onEndUnlimitedSession());
    this.container
      .querySelector('#mod-export-btn')
      ?.addEventListener('click', () => this.callbacks.onExportJson());
    this.container
      .querySelector<HTMLInputElement>('#mod-import-file')
      ?.addEventListener('change', (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) this.callbacks.onImportJsonFile(file);
      });

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-cat-filter]')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          this.selectedCategory = btn.dataset.catFilter as
            | CommodityCategory
            | 'all';
          this.dispatchRerender();
        })
      );

    this.container
      .querySelectorAll<HTMLElement>('[data-select-commodity]')
      .forEach((el) =>
        el.addEventListener('click', () => {
          this.selectedCommodityId = el.dataset.selectCommodity!;
          this.dispatchRerender();
        })
      );

    this.container
      .querySelector('#ws-quick-trade-btn')
      ?.addEventListener('click', () => this.callbacks.onOpenTradeModal(''));

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-team-trade]')
      .forEach((btn) =>
        btn.addEventListener('click', () =>
          this.callbacks.onOpenTradeModal(btn.dataset.teamTrade!)
        )
      );

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-team-hint]')
      .forEach((btn) =>
        btn.addEventListener('click', () =>
          this.callbacks.onOpenSecretReportModal(
            btn.dataset.teamHint!,
            this.selectedCommodityId
          )
        )
      );

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-toggle-hints]')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          const tid = btn.dataset.toggleHints!;
          if (this.expandedTeamHints.has(tid)) {
            this.expandedTeamHints.delete(tid);
          } else {
            this.expandedTeamHints.add(tid);
          }
          this.dispatchRerender();
        })
      );

    this.container
      .querySelectorAll<HTMLButtonElement>('[data-open-seasonal-modal]')
      .forEach((btn) =>
        btn.addEventListener('click', () => {
          const monthIdx = Number(btn.dataset.openSeasonalModal);
          this.callbacks.onOpenSeasonalEventModal(
            Number.isFinite(monthIdx) ? monthIdx : undefined
          );
        })
      );
  }

  private rerenderHook?: () => void;
  public setRerenderHook(fn: () => void) {
    this.rerenderHook = fn;
  }
  private dispatchRerender() {
    this.rerenderHook?.();
  }
}
