import { PATTERN_LABELS } from '../constants';
import {
  MonthlyPlanEdit,
  describePatternRule,
  getActiveHijriImpacts,
  getActiveSeasonalEvent,
  getCommoditySpec,
  getDualCalendarForMonth,
  getEffectivePrice,
  getLeaderboard,
  getYearAndMonthDisplay,
} from '../engine/marketEngine';
import {
  GameState,
  SavedSessionSlot,
  SeasonalEventRecord,
  SessionConfig,
  TradeOrderItem,
} from '../types';
import { pwaInstallService } from '../services/PwaInstallService';
import { buildAndroidApkPlan } from '../services/pwaEnvironment';
import { icons } from './icons';

export type ModalKind =
  | { type: 'none' }
  | { type: 'trade'; teamId: string }
  | { type: 'secret_report'; teamId: string; commodityId?: string }
  | { type: 'manual_override'; commodityId?: string }
  | { type: 'pin_gate' }
  | { type: 'cheat_sheet' }
  | { type: 'championship' }
  | {
      type: 'pre_adoption_plan';
      previewState: GameState;
      config: SessionConfig;
      teamNames: string[];
    }
  | { type: 'monthly_plan_editor' }
  | { type: 'team_funding'; mode: 'grant_only' | 'advance_month' }
  | { type: 'seasonal_event'; event: SeasonalEventRecord }
  | { type: 'saved_sessions'; canSaveCurrent: boolean; slots: SavedSessionSlot[] }
  | { type: 'confirm_reset' }
  | { type: 'android_apk' };

export interface ModalCallbacks {
  onClose: () => void;
  onExecuteTrade: (teamId: string, orders: TradeOrderItem[]) => string | undefined;
  onBuySecretReport: (
    teamId: string,
    commodityId: string
  ) => { error?: string; hintText?: string };
  onApplyOverride: (
    commodityId: string,
    newPrice: number,
    mode: 'temporary' | 'permanent'
  ) => string | undefined;
  onUnlockModerator: (pinAttempt: string) => boolean;
  onExportJson: () => void;
  onUndoLast: () => void;
  onNewSession: () => void;
  onSavePreAdoptionPlan: (
    overrides: Record<string, Record<number, number>>,
    config: SessionConfig,
    teamNames: string[]
  ) => void;
  onAdoptAndStartPlan: (
    overrides: Record<string, Record<number, number>>,
    config: SessionConfig,
    teamNames: string[]
  ) => void;
  onSaveMonthlyPlan: (edits: MonthlyPlanEdit[]) => string | undefined;
  onExtendPlanYear: () => void;
  onConfirmFunding: (
    mode: 'grant_only' | 'advance_month',
    grantsByTeamId: Record<string, number>
  ) => string | undefined;
  onSaveSessionSlot: (label: string, overwriteId?: string) => string | undefined;
  onLoadSessionSlot: (slotId: string) => string | undefined;
  onDeleteSessionSlot: (slotId: string) => void;
  onConfirmReset: (regeneratePrices: boolean) => void;
  onOpenResetFromChamp: () => void;
  onPromptPwaInstall: () => Promise<'accepted' | 'dismissed' | 'unavailable'>;
}

export class ModalRenderer {
  private container: HTMLElement;
  private callbacks: ModalCallbacks;
  private tradeQuantities: Record<string, number> = {};
  private selectedTradeTeamId = '';
  private selectedHintTeamId = '';
  private selectedHintCommodityId = '';
  private lastHintMessage = '';
  private selectedOverrideCommodityId = '';
  private overrideMode: 'temporary' | 'permanent' = 'temporary';
  private modalError = '';

  // Pre-adoption & Monthly plan editor state
  private planYearTab = 0; // 0 = Year 1 (0..11), 1 = Year 2 (12..23), ...
  private draftPreAdoptionOverrides: Record<string, Record<number, number>> = {};
  private draftSessionEdits: Record<string, MonthlyPlanEdit> = {};

  // Team funding state
  private fundingAmounts: Record<string, number> = {};
  private globalCustomFunding = 1500;

  constructor(container: HTMLElement, callbacks: ModalCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  public resetTransientState(modal: ModalKind, state: GameState | null) {
    this.modalError = '';
    this.lastHintMessage = '';
    if (modal.type === 'trade' && state) {
      this.tradeQuantities = {};
      this.selectedTradeTeamId = modal.teamId || state.teams[0]?.id || '';
    } else if (modal.type === 'secret_report' && state) {
      this.selectedHintTeamId = modal.teamId || state.teams[0]?.id || '';
      this.selectedHintCommodityId =
        modal.commodityId || state.market.activeCommodityIds[0] || '';
    } else if (modal.type === 'manual_override' && state) {
      this.selectedOverrideCommodityId =
        modal.commodityId || state.market.activeCommodityIds[0] || '';
      this.overrideMode = 'temporary';
    } else if (modal.type === 'pre_adoption_plan') {
      this.planYearTab = 0;
      this.draftPreAdoptionOverrides = JSON.parse(
        JSON.stringify(modal.config.customPlanOverrides ?? {})
      ) as Record<string, Record<number, number>>;
    } else if (modal.type === 'monthly_plan_editor' && state) {
      this.planYearTab = Math.floor(state.currentMonthIndex / 12);
      this.draftSessionEdits = {};
    } else if (modal.type === 'team_funding' && state) {
      this.fundingAmounts = {};
      for (const team of state.teams) {
        this.fundingAmounts[team.id] = 0;
      }
      this.globalCustomFunding = 1500;
    }
  }

  public render(modal: ModalKind, state: GameState | null) {
    if (modal.type === 'none') {
      this.container.innerHTML = '';
      this.container.classList.add('hidden');
      return;
    }

    this.container.classList.remove('hidden');

    const isWide =
      modal.type === 'pre_adoption_plan' ||
      modal.type === 'monthly_plan_editor' ||
      modal.type === 'cheat_sheet';

    let innerHtml = '';
    switch (modal.type) {
      case 'trade':
        if (state) innerHtml = this.renderTradeModal(state);
        break;
      case 'secret_report':
        if (state) innerHtml = this.renderSecretReportModal(state);
        break;
      case 'manual_override':
        if (state) innerHtml = this.renderOverrideModal(state);
        break;
      case 'pin_gate':
        innerHtml = this.renderPinModal();
        break;
      case 'cheat_sheet':
        if (state) innerHtml = this.renderCheatSheetModal(state);
        break;
      case 'championship':
        if (state) innerHtml = this.renderChampionshipModal(state);
        break;
      case 'pre_adoption_plan':
        innerHtml = this.renderPreAdoptionPlanModal(modal.previewState, modal.config);
        break;
      case 'monthly_plan_editor':
        if (state) innerHtml = this.renderMonthlyPlanEditorModal(state);
        break;
      case 'team_funding':
        if (state) innerHtml = this.renderTeamFundingModal(state, modal.mode);
        break;
      case 'seasonal_event':
        if (state) innerHtml = this.renderSeasonalEventModal(state, modal.event);
        break;
      case 'saved_sessions':
        innerHtml = this.renderSavedSessionsModal(modal, state);
        break;
      case 'confirm_reset':
        if (state) innerHtml = this.renderConfirmResetModal(state);
        break;
      case 'android_apk':
        innerHtml = this.renderAndroidApkModal();
        break;
    }

    this.container.innerHTML = `
      <div
        class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0d0f14]/85"
        role="dialog"
        aria-modal="true"
        data-modal-backdrop="true"
      >
        <div class="w-full ${isWide ? 'max-w-6xl' : 'max-w-2xl'} max-h-[90vh] flex flex-col bg-[#161a22] border border-[#d4a853]/30 rounded-xl overflow-hidden text-[#f5f0e6]">
          ${innerHtml}
        </div>
      </div>
    `;

    this.bindEvents(modal, state);
  }

  private renderPreAdoptionPlanModal(
    previewState: GameState,
    config: SessionConfig
  ): string {
    const startMonth = this.planYearTab * 12;
    const endMonth = Math.min(36, startMonth + 12);
    const monthsInTab = Array.from(
      { length: Math.max(0, endMonth - startMonth) },
      (_, i) => startMonth + i
    );
    const totalEdits = Object.values(this.draftPreAdoptionOverrides).reduce(
      (sum, mMap) => sum + Object.keys(mMap).length,
      0
    );

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div>
          <h2 class="font-display text-lg font-bold text-[#d4a853]">معاينة وتعديل خطة البورصة قبل الاعتماد (3 سنوات)</h2>
          <p class="text-xs text-[#9ca3af] mt-0.5">
            ${
              config.horizonMode === 'unlimited'
                ? 'تعرض هذه الخطة السنوات الثلاث الأولى (36 شهراً) ويمكنك تعديل سعر أي منتج شهرياً، وعند الاعتماد تستمر البورصة تلقائياً لما بعد الشهر 36 إلى غير أمد.'
                : 'راجع خطة الأسعار لجميع المنتجات على مدار 3 سنوات (ش1 إلى ش36) وعدّل أي شهر قبل اعتماد البورصة وبدء الجلسة.'
            }
          </p>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <div class="px-5 py-3 bg-[#0d0f14] border-b border-[#f5f0e6]/10 flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-2" role="tablist" aria-label="سنوات الخطة">
          ${[0, 1, 2]
            .map(
              (yr) => `
            <button
              type="button"
              data-plan-year-tab="${yr}"
              data-testid="plan-year-tab-${yr + 1}"
              class="px-3.5 py-1.5 text-xs rounded-lg border transition-colors ${
                this.planYearTab === yr
                  ? 'bg-[#d4a853] text-[#0d0f14] border-[#d4a853] font-bold'
                  : 'bg-[#161a22] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
              }"
            >السنة ${yr + 1} (ش${yr * 12 + 1}–ش${(yr + 1) * 12})</button>
          `
            )
            .join('')}
        </div>
        <div class="flex items-center gap-3 text-xs">
          <span class="text-[#9ca3af]">التعديلات المخصصة: <strong class="font-num text-[#d4a853]">${totalEdits}</strong></span>
          <button
            type="button"
            id="plan-clear-overrides"
            class="px-2.5 py-1 rounded bg-[#161a22] border border-[#f5f0e6]/15 text-[#9ca3af] hover:text-[#ef4444]"
          >مسح التعديلات</button>
        </div>
      </div>

      <div class="flex-1 overflow-auto p-4" data-testid="pre-adoption-plan-table">
        <table class="w-full text-right border-collapse text-xs">
          <thead>
            <tr class="border-b border-[#d4a853]/30 text-[#9ca3af]">
              <th class="py-2 px-3 sticky right-0 bg-[#161a22] min-w-[140px]">المنتج</th>
              ${monthsInTab
                .map((m) => {
                  const ev = getActiveSeasonalEvent(previewState.market, m);
                  const dual = getDualCalendarForMonth(config, m);
                  const evHint = ev
                    ? `title="${dual.shortLabel} — ${ev.commodityName}: ${ev.title} (${ev.priceDelta > 0 ? '+' : ''}${ev.priceDelta} ر.س)"`
                    : `title="${dual.shortLabel}"`;
                  return `<th class="py-2 px-2 text-center font-num whitespace-nowrap ${
                    ev ? 'text-[#d4a853]' : ''
                  }" ${evHint}>
                    <div>ش${m + 1}${ev ? ' ⚡' : ''}</div>
                    <div class="text-[10px] font-normal text-[#34d399]/80 font-sans">${dual.hijriMonthName}</div>
                    <div class="text-[9px] font-normal text-[#9ca3af]/75 font-sans">${dual.gregorianMonthName}</div>
                  </th>`;
                })
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${previewState.market.activeCommodityIds
              .map((cid) => {
                const spec = getCommoditySpec(cid);
                const cells = monthsInTab
                  .map((m) => {
                    const baseGenerated = getEffectivePrice(previewState.market, cid, m);
                    const draftOverride = this.draftPreAdoptionOverrides[cid]?.[m];
                    const val = draftOverride ?? baseGenerated;
                    const isEdited = draftOverride !== undefined;
                    return `
                      <td class="p-1.5 text-center">
                        <input
                          type="number"
                          min="1"
                          data-plan-cid="${cid}"
                          data-plan-month="${m}"
                          aria-label="سعر ${spec?.name ?? cid} في الشهر ${m + 1}"
                          value="${val}"
                          class="w-16 px-1.5 py-1 text-center font-num text-xs rounded border ${
                            isEdited
                              ? 'bg-[#d4a853]/15 border-[#d4a853] text-[#d4a853] font-bold'
                              : 'bg-[#0d0f14] border-[#f5f0e6]/15 text-[#f5f0e6]'
                          } focus:border-[#d4a853] focus:outline-none"
                        />
                      </td>
                    `;
                  })
                  .join('');

                return `
                  <tr class="border-b border-[#f5f0e6]/10 hover:bg-[#1d222d]/40">
                    <td class="py-2 px-3 font-semibold text-[#f5f0e6] sticky right-0 bg-[#161a22] whitespace-nowrap">${spec?.name ?? cid}</td>
                    ${cells}
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      <div class="px-5 py-4 border-t border-[#f5f0e6]/10 flex flex-wrap items-center justify-between gap-3 bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-4 py-2 text-xs text-[#9ca3af] hover:text-[#f5f0e6]">إلغاء</button>
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            id="plan-save-only-btn"
            data-testid="plan-save-only-btn"
            class="px-4 py-2 text-xs font-semibold rounded-lg bg-[#1d222d] border border-[#f5f0e6]/20 text-[#f5f0e6] hover:border-[#d4a853]/50"
          >حفظ التعديلات والعودة للإعداد</button>
          <button
            type="button"
            id="plan-adopt-start-btn"
            data-testid="adopt-and-start-btn"
            class="px-5 py-2.5 text-sm font-bold rounded-lg bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14]"
          >اعتماد البورصة وبدء الجلسة</button>
        </div>
      </div>
    `;
  }

  private renderMonthlyPlanEditorModal(state: GameState): string {
    const firstId = state.market.activeCommodityIds[0];
    const totalAvailableMonths = firstId
      ? state.market.seriesById[firstId].basePrices.length
      : state.config.totalMonths;
    const totalYears = Math.max(1, Math.ceil(totalAvailableMonths / 12));
    if (this.planYearTab >= totalYears) this.planYearTab = totalYears - 1;

    const startMonth = this.planYearTab * 12;
    const endMonth = Math.min(totalAvailableMonths, startMonth + 12);
    const monthsInTab = Array.from(
      { length: Math.max(0, endMonth - startMonth) },
      (_, i) => startMonth + i
    );
    const pendingEditsCount = Object.keys(this.draftSessionEdits).length;
    const isUnlimited = state.config.horizonMode === 'unlimited';

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div>
          <h2 class="font-display text-lg font-bold text-[#d4a853]">تعديل أسعار المنتجات شهرياً (لوحة المدير)</h2>
          <p class="text-xs text-[#9ca3af] mt-0.5">
            عدّل سعر أي سلعة في الشهر الحالي أو الأشهر القادمة مباشرة، مع إمكانية التراجع في أي وقت.
          </p>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <div class="px-5 py-3 bg-[#0d0f14] border-b border-[#f5f0e6]/10 flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2" role="tablist" aria-label="سنوات التعديل">
          ${Array.from({ length: totalYears }, (_, yr) => {
            const yrStart = yr * 12 + 1;
            const yrEnd = Math.min(totalAvailableMonths, (yr + 1) * 12);
            return `
              <button
                type="button"
                data-plan-year-tab="${yr}"
                data-testid="mod-plan-year-tab-${yr + 1}"
                class="px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  this.planYearTab === yr
                    ? 'bg-[#d4a853] text-[#0d0f14] border-[#d4a853] font-bold'
                    : 'bg-[#161a22] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
                }"
              >السنة ${yr + 1} (ش${yrStart}–ش${yrEnd})</button>
            `;
          }).join('')}
          ${
            isUnlimited
              ? `<button
                  type="button"
                  id="mod-extend-year-btn"
                  data-testid="mod-extend-year-btn"
                  class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-[#34d399] hover:bg-[#10b981]/25"
                >+ إضافة سنة جديدة</button>`
              : ''
          }
        </div>
        <div class="text-xs text-[#9ca3af]">
          تعديلات معلّقة: <strong class="font-num text-[#d4a853]">${pendingEditsCount}</strong>
        </div>
      </div>

      <div class="flex-1 overflow-auto p-4" data-testid="monthly-plan-editor-table">
        <table class="w-full text-right border-collapse text-xs">
          <thead>
            <tr class="border-b border-[#d4a853]/30 text-[#9ca3af]">
              <th class="py-2 px-3 sticky right-0 bg-[#161a22] min-w-[140px]">السلعة</th>
              ${monthsInTab
                .map((m) => {
                  const isCurr = m === state.currentMonthIndex;
                  const ev = getActiveSeasonalEvent(state.market, m);
                  const dual = getDualCalendarForMonth(state.config, m);
                  return `<th class="py-2 px-2 text-center font-num whitespace-nowrap ${
                    isCurr ? 'text-[#d4a853] font-bold' : ev ? 'text-[#d4a853]' : ''
                  }" title="${dual.shortLabel}">
                    <div>ش${m + 1}${ev ? ' ⚡' : ''}${isCurr ? ' (الحالي)' : ''}</div>
                    <div class="text-[10px] font-normal text-[#34d399]/80 font-sans">${dual.hijriMonthName}</div>
                    <div class="text-[9px] font-normal text-[#9ca3af]/75 font-sans">${dual.gregorianMonthName}</div>
                  </th>`;
                })
                .join('')}
            </tr>
          </thead>
          <tbody>
            ${state.market.activeCommodityIds
              .map((cid) => {
                const spec = getCommoditySpec(cid);
                const cells = monthsInTab
                  .map((m) => {
                    const currentVal = getEffectivePrice(state.market, cid, m);
                    const draft = this.draftSessionEdits[`${cid}:${m}`];
                    const val = draft ? draft.price : currentVal;
                    const isEdited = draft !== undefined && draft.price !== currentVal;
                    const isCurr = m === state.currentMonthIndex;
                    return `
                      <td class="p-1.5 text-center ${isCurr ? 'bg-[#d4a853]/5' : ''}">
                        <input
                          type="number"
                          min="1"
                          data-mod-plan-cid="${cid}"
                          data-mod-plan-month="${m}"
                          aria-label="تعديل سعر ${spec?.name ?? cid} لشهر ${m + 1}"
                          value="${val}"
                          class="w-16 px-1.5 py-1 text-center font-num text-xs rounded border ${
                            isEdited
                              ? 'bg-[#d4a853]/15 border-[#d4a853] text-[#d4a853] font-bold'
                              : isCurr
                                ? 'bg-[#0d0f14] border-[#d4a853]/40 text-[#f5f0e6]'
                                : 'bg-[#0d0f14] border-[#f5f0e6]/15 text-[#f5f0e6]'
                          } focus:border-[#d4a853] focus:outline-none"
                        />
                      </td>
                    `;
                  })
                  .join('');

                return `
                  <tr class="border-b border-[#f5f0e6]/10 hover:bg-[#1d222d]/40">
                    <td class="py-2 px-3 font-semibold text-[#f5f0e6] sticky right-0 bg-[#161a22] whitespace-nowrap">${spec?.name ?? cid}</td>
                    ${cells}
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      </div>

      ${
        this.modalError
          ? `<div class="px-5 py-2.5 bg-[#ef4444]/15 border-t border-[#ef4444]/30 text-xs text-[#fca5a5]">${this.modalError}</div>`
          : ''
      }

      <div class="px-5 py-4 border-t border-[#f5f0e6]/10 flex items-center justify-end gap-3 bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-4 py-2 text-xs text-[#9ca3af] hover:text-[#f5f0e6]">إلغاء</button>
        <button
          type="button"
          id="save-monthly-plan-btn"
          data-testid="save-monthly-plan-btn"
          class="px-5 py-2 text-sm font-bold bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] rounded-lg"
        >حفظ خطة الأسعار الشهرية</button>
      </div>
    `;
  }

  private renderTeamFundingModal(
    state: GameState,
    mode: 'grant_only' | 'advance_month'
  ): string {
    const nextMonthNum = state.currentMonthIndex + 2;
    const isAdvance = mode === 'advance_month';
    const totalToGrant = state.teams.reduce(
      (sum, t) => sum + Math.max(0, Math.round(this.fundingAmounts[t.id] ?? 0)),
      0
    );

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div>
          <h2 class="font-display text-lg font-bold text-[#d4a853]">
            ${
              isAdvance
                ? `إضافة سيولة للفرق قبل بداية الشهر ${nextMonthNum}`
                : `إضافة سيولة نقدية للفرق (الشهر ${state.currentMonthIndex + 1})`
            }
          </h2>
          <p class="text-xs text-[#9ca3af] mt-0.5">
            ${
              isAdvance
                ? 'أضف +1,000 أو +2,000 أو +3,000 أو أي مبلغ آخر لكل فريق قبل فتح الشهر الجديد، أو اتركه 0 للانتقال مباشرة.'
                : 'اختر مبلغاً جاهزاً (+1,000 / +2,000 / +3,000) أو اكتب مبلغاً مخصصاً لإضافته فوراً لكل فريق.'
            }
          </p>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <!-- Global Quick-Apply Bar -->
      <div class="px-5 py-3 bg-[#0d0f14] border-b border-[#f5f0e6]/10 space-y-2">
        <div class="text-xs font-semibold text-[#d4a853]">تطبيق مبلغ موحد على جميع الفرق دفعة واحدة:</div>
        <div class="flex flex-wrap items-center gap-2">
          ${[0, 1000, 2000, 3000]
            .map(
              (amt) => `
            <button
              type="button"
              data-funding-all="${amt}"
              data-testid="funding-all-${amt}"
              class="px-3 py-1.5 text-xs font-num font-semibold rounded-lg bg-[#161a22] border border-[#f5f0e6]/15 hover:border-[#d4a853]/60 text-[#f5f0e6]"
            >${amt === 0 ? 'تصفير الكل (0)' : `+${amt.toLocaleString('en-US')}`}</button>
          `
            )
            .join('')}
          <div class="flex items-center gap-1.5 mr-auto">
            <input
              type="number"
              min="0"
              step="100"
              id="funding-global-custom-input"
              aria-label="سعر آخر موحد لجميع الفرق"
              value="${this.globalCustomFunding}"
              class="w-24 px-2.5 py-1.5 bg-[#161a22] border border-[#f5f0e6]/20 rounded-lg font-num text-xs text-[#f5f0e6] text-center focus:border-[#d4a853] focus:outline-none"
            />
            <button
              type="button"
              id="funding-apply-custom-all"
              class="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[#1d222d] border border-[#d4a853]/40 text-[#d4a853] hover:bg-[#d4a853]/15"
            >تطبيق للجميع</button>
          </div>
        </div>
      </div>

      <!-- Per-Team Funding Rows -->
      <div class="flex-1 overflow-y-auto px-5 py-3 space-y-2.5" data-testid="team-funding-list">
        ${state.teams
          .map((team) => {
            const grant = Math.max(0, Math.round(this.fundingAmounts[team.id] ?? 0));
            const projected = team.cash + grant;
            return `
            <div class="p-3 rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/10 flex flex-wrap items-center justify-between gap-3" data-testid="funding-row-${team.id}">
              <div class="min-w-[140px]">
                <div class="text-sm font-bold text-[#f5f0e6]">${team.name}</div>
                <div class="text-xs font-num text-[#9ca3af] mt-0.5">
                  الحالي: <span class="text-[#f5f0e6]">${team.cash.toLocaleString('en-US')}</span>
                  ${
                    grant > 0
                      ? ` ← <span class="text-[#10b981] font-bold">${projected.toLocaleString('en-US')} ر.س</span>`
                      : ''
                  }
                </div>
              </div>

              <div class="flex flex-wrap items-center gap-1.5">
                ${[0, 1000, 2000, 3000]
                  .map(
                    (preset) => `
                  <button
                    type="button"
                    data-team-grant-preset="${team.id}"
                    data-grant-amount="${preset}"
                    data-testid="grant-${team.id}-${preset}"
                    class="px-2.5 py-1.5 text-xs font-num rounded border transition-colors ${
                      grant === preset
                        ? preset === 0
                          ? 'bg-[#1d222d] text-[#f5f0e6] border-[#f5f0e6]/40 font-semibold'
                          : 'bg-[#d4a853] text-[#0d0f14] border-[#d4a853] font-bold'
                        : 'bg-[#161a22] text-[#9ca3af] border-[#f5f0e6]/15 hover:text-[#f5f0e6]'
                    }"
                  >${preset === 0 ? '0' : `+${preset.toLocaleString('en-US')}`}</button>
                `
                  )
                  .join('')}
                <input
                  type="number"
                  min="0"
                  step="100"
                  data-funding-input="${team.id}"
                  aria-label="مبلغ مخصص لـ ${team.name}"
                  placeholder="سعر آخر"
                  value="${grant}"
                  class="w-24 px-2.5 py-1.5 bg-[#161a22] border border-[#f5f0e6]/20 rounded font-num text-xs text-[#f5f0e6] text-center focus:border-[#d4a853] focus:outline-none"
                />
              </div>
            </div>
          `;
          })
          .join('')}
      </div>

      ${
        this.modalError
          ? `<div class="px-5 py-2.5 bg-[#ef4444]/15 border-t border-[#ef4444]/30 text-xs text-[#fca5a5]">${this.modalError}</div>`
          : ''
      }

      <div class="px-5 py-4 border-t border-[#f5f0e6]/10 flex flex-wrap items-center justify-between gap-3 bg-[#0d0f14]">
        <span class="text-xs text-[#9ca3af]">
          إجمالي السيولة المضافة: <strong class="font-num text-[#10b981]" data-testid="funding-total-readout">+${totalToGrant.toLocaleString('en-US')} ر.س</strong>
        </span>
        <div class="flex items-center gap-3">
          <button type="button" data-close-modal="true" class="px-4 py-2 text-xs text-[#9ca3af] hover:text-[#f5f0e6]">إلغاء</button>
          <button
            type="button"
            id="confirm-funding-btn"
            data-testid="confirm-funding-btn"
            class="px-5 py-2.5 text-sm font-bold bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] rounded-lg transition-colors"
          >${
            isAdvance
              ? totalToGrant > 0
                ? `اعتماد السيولة وبدء الشهر ${nextMonthNum}`
                : `بدء الشهر ${nextMonthNum} بدون إضافة`
              : 'إضافة السيولة للفرق الآن'
          }</button>
        </div>
      </div>
    `;
  }

  private renderTradeModal(state: GameState): string {
    const team =
      state.teams.find((t) => t.id === this.selectedTradeTeamId) ?? state.teams[0];
    if (!team) return '';

    let netCost = 0;
    for (const cid of state.market.activeCommodityIds) {
      const qty = this.tradeQuantities[cid] ?? 0;
      if (qty !== 0) {
        netCost += qty * getEffectivePrice(state.market, cid, state.currentMonthIndex);
      }
    }
    const projectedCash = team.cash - netCost;

    const rows = state.market.activeCommodityIds
      .map((cid) => {
        const spec = getCommoditySpec(cid);
        const price = getEffectivePrice(state.market, cid, state.currentMonthIndex);
        const owned = team.holdings[cid] ?? 0;
        const qty = this.tradeQuantities[cid] ?? 0;

        return `
        <div class="flex items-center justify-between gap-3 py-2.5 px-3 border-b border-[#f5f0e6]/10 last:border-0">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-semibold text-[#f5f0e6] truncate">${spec?.name ?? cid}</div>
            <div class="text-xs text-[#9ca3af] font-num">
              السعر: ${price} ر.س · المتاح بالمحفظة: <span class="text-[#f5f0e6]">${owned}</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              data-trade-step="${cid}"
              data-step="-5"
              aria-label="بيع 5 من ${spec?.name ?? cid}"
              class="px-2 py-1.5 text-xs font-num rounded bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#ef4444] hover:border-[#ef4444]/50"
            >-5</button>
            <button
              type="button"
              data-trade-step="${cid}"
              data-step="-1"
              aria-label="بيع 1 من ${spec?.name ?? cid}"
              class="px-2.5 py-1.5 text-xs font-num rounded bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#ef4444] hover:border-[#ef4444]/50"
            >-1</button>
            <input
              type="number"
              data-trade-input="${cid}"
              aria-label="كمية التداول لـ ${spec?.name ?? cid}"
              value="${qty}"
              class="w-16 py-1.5 px-2 text-center font-num text-sm bg-[#0d0f14] border border-[#f5f0e6]/20 rounded text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
            />
            <button
              type="button"
              data-trade-step="${cid}"
              data-step="1"
              aria-label="شراء 1 من ${spec?.name ?? cid}"
              class="px-2.5 py-1.5 text-xs font-num rounded bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#10b981] hover:border-[#10b981]/50"
            >+1</button>
            <button
              type="button"
              data-trade-step="${cid}"
              data-step="5"
              aria-label="شراء 5 من ${spec?.name ?? cid}"
              class="px-2 py-1.5 text-xs font-num rounded bg-[#0d0f14] border border-[#f5f0e6]/15 text-[#10b981] hover:border-[#10b981]/50"
            >+5</button>
          </div>
        </div>
      `;
      })
      .join('');

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div>
          <h2 class="font-display text-lg font-bold text-[#d4a853]">تنفيذ صفقات الشهر ${state.currentMonthIndex + 1}</h2>
          <p class="text-xs text-[#9ca3af] mt-0.5">القيم الموجبة (+) شراء والسالبة (-) بيع من المحفظة.</p>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">
          ${icons.close}
        </button>
      </div>

      <div class="px-5 py-3 bg-[#0d0f14] border-b border-[#f5f0e6]/10 flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-center gap-2">
          <label for="trade-team-select" class="text-xs text-[#9ca3af]">الفريق:</label>
          <select id="trade-team-select" class="px-3 py-1.5 bg-[#161a22] border border-[#d4a853]/30 rounded-lg text-sm font-semibold text-[#f5f0e6] focus:outline-none">
            ${state.teams
              .map(
                (t) =>
                  `<option value="${t.id}" ${t.id === team.id ? 'selected' : ''}>${t.name} (${t.cash.toLocaleString('en-US')} ر.س)</option>`
              )
              .join('')}
          </select>
        </div>
        <div class="flex items-center gap-4 text-xs font-num">
          <span>صافي الصفقة: <strong class="${netCost > 0 ? 'text-[#ef4444]' : netCost < 0 ? 'text-[#10b981]' : 'text-[#f5f0e6]'}">${netCost > 0 ? `-${netCost}` : netCost < 0 ? `+${Math.abs(netCost)}` : '0'} ر.س</strong></span>
          <span>السيولة بعد التنفيذ: <strong class="${projectedCash < 0 ? 'text-[#ef4444]' : 'text-[#d4a853]'}">${projectedCash.toLocaleString('en-US')} ر.س</strong></span>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-5 py-2">
        ${rows}
      </div>

      ${
        this.modalError
          ? `<div class="px-5 py-2.5 bg-[#ef4444]/15 border-t border-[#ef4444]/30 text-xs text-[#fca5a5]">${this.modalError}</div>`
          : ''
      }

      <div class="px-5 py-4 border-t border-[#f5f0e6]/10 flex items-center justify-end gap-3 bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-4 py-2 text-sm text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">إلغاء</button>
        <button
          type="button"
          id="confirm-trade-btn"
          data-testid="confirm-trade-btn"
          class="px-5 py-2 text-sm font-bold bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] rounded-lg transition-colors"
        >اعتماد وتنفيذ الصفقات</button>
      </div>
    `;
  }

  private renderSecretReportModal(state: GameState): string {
    const team =
      state.teams.find((t) => t.id === this.selectedHintTeamId) ?? state.teams[0];
    if (!team) return '';
    const cost = state.config.secretReportCost;
    const unlockedCountForSelected = team.unlockedHints.filter(
      (h) => h.commodityId === this.selectedHintCommodityId
    ).length;

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div>
          <h2 class="font-display text-lg font-bold text-[#d4a853]">شراء تقرير سري (استخبارات السوق)</h2>
          <p class="text-xs text-[#9ca3af] mt-0.5">التكلفة: <span class="font-num text-[#f5f0e6]">${cost} ر.س</span> · يكشف قانون السلعة أو تحذيراً من انهيار قادم.</p>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <div class="p-5 space-y-4 overflow-y-auto">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="hint-team-select" class="block text-xs text-[#9ca3af] mb-1.5">الفريق المشتري</label>
            <select id="hint-team-select" class="w-full px-3 py-2.5 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg text-sm text-[#f5f0e6]">
              ${state.teams
                .map(
                  (t) =>
                    `<option value="${t.id}" ${t.id === team.id ? 'selected' : ''}>${t.name} (السيولة: ${t.cash} ر.س)</option>`
                )
                .join('')}
            </select>
          </div>
          <div>
            <label for="hint-commodity-select" class="block text-xs text-[#9ca3af] mb-1.5">السلعة المطلوب تحليلها</label>
            <select id="hint-commodity-select" class="w-full px-3 py-2.5 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg text-sm text-[#f5f0e6]">
              ${state.market.activeCommodityIds
                .map((cid) => {
                  const spec = getCommoditySpec(cid);
                  const count = team.unlockedHints.filter((h) => h.commodityId === cid).length;
                  return `<option value="${cid}" ${cid === this.selectedHintCommodityId ? 'selected' : ''}>${spec?.name ?? cid} (${count}/2 تقارير)</option>`;
                })
                .join('')}
            </select>
          </div>
        </div>

        ${
          this.lastHintMessage
            ? `<div class="p-4 rounded-lg bg-[#10b981]/12 border border-[#10b981]/35 text-sm text-[#ecfdf5] leading-relaxed" data-testid="unlocked-hint-banner">
                <div class="text-xs font-bold text-[#10b981] mb-1">تم فك التقرير السري بنجاح:</div>
                ${this.lastHintMessage}
              </div>`
            : ''
        }

        ${
          this.modalError
            ? `<div class="p-3 rounded-lg bg-[#ef4444]/15 border border-[#ef4444]/30 text-xs text-[#fca5a5]">${this.modalError}</div>`
            : ''
        }

        <div class="pt-2 border-t border-[#f5f0e6]/10">
          <div class="text-xs font-semibold text-[#9ca3af] mb-2">التقارير المفتوحة سابقاً لـ ${team.name} (${team.unlockedHints.length}):</div>
          ${
            team.unlockedHints.length === 0
              ? `<p class="text-xs text-[#9ca3af]/70 py-2">لا توجد تقارير سرية مشتراة لهذا الفريق بعد.</p>`
              : `<div class="space-y-2 max-h-44 overflow-y-auto">
                  ${team.unlockedHints
                    .map(
                      (h) => `
                    <div class="p-3 rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/10 text-xs">
                      <div class="flex items-center justify-between text-[#d4a853] font-semibold mb-1">
                        <span>${h.commodityName}</span>
                        <span class="font-num text-[#9ca3af]">الشهر ${h.monthIndex + 1}</span>
                      </div>
                      <p class="text-[#f5f0e6] leading-relaxed">${h.text}</p>
                    </div>
                  `
                    )
                    .join('')}
                </div>`
          }
        </div>
      </div>

      <div class="px-5 py-4 border-t border-[#f5f0e6]/10 flex items-center justify-between bg-[#0d0f14]">
        <span class="text-xs text-[#9ca3af]">متاح لهذه السلعة: <strong class="font-num text-[#f5f0e6]">${2 - unlockedCountForSelected}</strong> تقرير</span>
        <div class="flex items-center gap-3">
          <button type="button" data-close-modal="true" class="px-4 py-2 text-sm text-[#9ca3af] hover:text-[#f5f0e6]">إغلاق</button>
          <button
            type="button"
            id="confirm-hint-btn"
            data-testid="confirm-hint-btn"
            class="px-5 py-2 text-sm font-bold bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] rounded-lg"
          >شراء التقرير (${cost} ر.س)</button>
        </div>
      </div>
    `;
  }

  private renderOverrideModal(state: GameState): string {
    const cid = this.selectedOverrideCommodityId || state.market.activeCommodityIds[0];
    const currentPrice = getEffectivePrice(state.market, cid, state.currentMonthIndex);

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div>
          <h2 class="font-display text-lg font-bold text-[#d4a853]">تعديل السعر اليدوي (صدمة سوق)</h2>
          <p class="text-xs text-[#9ca3af] mt-0.5">لتطبيق أحداث كشتة مفاجئة (مثل هطول مطر) أو تصحيح سعر للشهر الحالي.</p>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6]">${icons.close}</button>
      </div>

      <div class="p-5 space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="override-commodity-select" class="block text-xs text-[#9ca3af] mb-1.5">السلعة</label>
            <select id="override-commodity-select" class="w-full px-3 py-2.5 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg text-sm text-[#f5f0e6]">
              ${state.market.activeCommodityIds
                .map((id) => {
                  const s = getCommoditySpec(id);
                  const p = getEffectivePrice(state.market, id, state.currentMonthIndex);
                  return `<option value="${id}" ${id === cid ? 'selected' : ''}>${s?.name ?? id} (${p} ر.س)</option>`;
                })
                .join('')}
            </select>
          </div>
          <div>
            <label for="override-price-input" class="block text-xs text-[#9ca3af] mb-1.5">السعر الجديد (ر.س)</label>
            <input
              id="override-price-input"
              type="number"
              min="1"
              value="${currentPrice}"
              class="w-full px-3 py-2.5 bg-[#0d0f14] border border-[#f5f0e6]/15 rounded-lg font-num text-sm text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
            />
          </div>
        </div>

        <div class="space-y-2">
          <span class="block text-xs text-[#9ca3af]">نطاق التعديل:</span>
          <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
            this.overrideMode === 'temporary'
              ? 'bg-[#1d222d] border-[#d4a853]/40'
              : 'bg-[#0d0f14] border-[#f5f0e6]/10'
          }">
            <input type="radio" name="override-mode" value="temporary" ${this.overrideMode === 'temporary' ? 'checked' : ''} class="mt-1 accent-[#d4a853]" />
            <span class="text-xs">
              <strong class="block text-[#f5f0e6]">تعديل مؤقت للشهر الحالي فقط (الشهر ${state.currentMonthIndex + 1})</strong>
              <span class="text-[#9ca3af]">يعود السعر تلقائياً لمساره المبرمج في الشهر القادم.</span>
            </span>
          </label>
          <label class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${
            this.overrideMode === 'permanent'
              ? 'bg-[#1d222d] border-[#d4a853]/40'
              : 'bg-[#0d0f14] border-[#f5f0e6]/10'
          }">
            <input type="radio" name="override-mode" value="permanent" ${this.overrideMode === 'permanent' ? 'checked' : ''} class="mt-1 accent-[#d4a853]" />
            <span class="text-xs">
              <strong class="block text-[#f5f0e6]">إزاحة دائمة لمنحنى السلعة</strong>
              <span class="text-[#9ca3af]">يرفع أو يخفض بقية منحنى السلعة لجميع الأشهر القادمة بنفس الفارق.</span>
            </span>
          </label>
        </div>

        ${
          this.modalError
            ? `<div class="p-3 rounded-lg bg-[#ef4444]/15 border border-[#ef4444]/30 text-xs text-[#fca5a5]">${this.modalError}</div>`
            : ''
        }
      </div>

      <div class="px-5 py-4 border-t border-[#f5f0e6]/10 flex items-center justify-end gap-3 bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-4 py-2 text-sm text-[#9ca3af] hover:text-[#f5f0e6]">إلغاء</button>
        <button
          type="button"
          id="confirm-override-btn"
          data-testid="confirm-override-btn"
          class="px-5 py-2 text-sm font-bold bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] rounded-lg"
        >تطبيق السعر</button>
      </div>
    `;
  }

  private renderPinModal(): string {
    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <h2 class="font-display text-lg font-bold text-[#d4a853]">تأكيد هوية مدير الجلسة</h2>
        <button type="button" data-close-modal="true" aria-label="إغلاق" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6]">${icons.close}</button>
      </div>
      <form id="pin-gate-form" class="p-5 space-y-4">
        <div>
          <label for="mod-pin-input" class="block text-sm text-[#f5f0e6] mb-2">أدخل رمز PIN لإظهار أدوات المدير السرية</label>
          <input
            id="mod-pin-input"
            type="password"
            autofocus
            placeholder="••••"
            class="w-full px-4 py-2.5 bg-[#0d0f14] border border-[#f5f0e6]/20 rounded-lg font-num text-base text-[#f5f0e6] focus:border-[#d4a853] focus:outline-none"
          />
        </div>
        ${
          this.modalError
            ? `<div class="text-xs text-[#fca5a5]">${this.modalError}</div>`
            : ''
        }
        <div class="flex justify-end gap-3 pt-2">
          <button type="button" data-close-modal="true" class="px-4 py-2 text-sm text-[#9ca3af]">إلغاء</button>
          <button type="submit" class="px-5 py-2 text-sm font-bold bg-[#d4a853] text-[#0d0f14] rounded-lg">فتح لوحة المدير</button>
        </div>
      </form>
    `;
  }

  private renderCheatSheetModal(state: GameState): string {
    const m = state.currentMonthIndex;
    const isUnlimited = state.config.horizonMode === 'unlimited';
    const rows = state.market.activeCommodityIds
      .map((cid) => {
        const spec = getCommoditySpec(cid);
        const series = state.market.seriesById[cid];
        const maxBound = isUnlimited
          ? series.basePrices.length
          : state.config.totalMonths;
        const curr = getEffectivePrice(state.market, cid, m);
        const next1 =
          m + 1 < maxBound ? getEffectivePrice(state.market, cid, m + 1) : null;
        const next2 =
          m + 2 < maxBound ? getEffectivePrice(state.market, cid, m + 2) : null;

        return `
        <tr class="border-b border-[#f5f0e6]/10 text-xs">
          <td class="py-2.5 px-3 font-semibold text-[#f5f0e6]">${spec?.name ?? cid}</td>
          <td class="py-2.5 px-3 text-[#d4a853]">${PATTERN_LABELS[series.effectivePattern]}</td>
          <td class="py-2.5 px-3 text-[#9ca3af] leading-relaxed">${describePatternRule(
            series.effectivePattern,
            series.appliedPatternConfig
          )}</td>
          <td class="py-2.5 px-3 font-num text-[#f5f0e6] whitespace-nowrap">${curr}</td>
          <td class="py-2.5 px-3 font-num whitespace-nowrap ${
            next1 !== null && next1 > curr
              ? 'text-[#10b981]'
              : next1 !== null && next1 < curr
                ? 'text-[#ef4444]'
                : 'text-[#9ca3af]'
          }">${next1 ?? '—'}</td>
          <td class="py-2.5 px-3 font-num whitespace-nowrap ${
            next2 !== null && next2 > curr
              ? 'text-[#10b981]'
              : next2 !== null && next2 < curr
                ? 'text-[#ef4444]'
                : 'text-[#9ca3af]'
          }">${next2 ?? '—'}</td>
        </tr>
      `;
      })
      .join('');

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div>
          <h2 class="font-display text-lg font-bold text-[#d4a853]">دليل المدير السري (قوانين السوق وتوقعاته)</h2>
          <p class="text-xs text-[#ef4444] mt-0.5">خاص بمدير الجلسة فقط — لا تعرض هذه النافذة للاعبين.</p>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6]">${icons.close}</button>
      </div>
      <div class="flex-1 overflow-auto p-4 space-y-4">
        ${(() => {
          const nearEvents = [m, m + 1, m + 2]
            .map((idx) => getActiveSeasonalEvent(state.market, idx))
            .filter((ev): ev is NonNullable<typeof ev> => Boolean(ev));
          const nearHijri = [m, m + 1, m + 2]
            .map((idx) => ({
              idx,
              dual: getDualCalendarForMonth(state.config, idx),
              impacts: getActiveHijriImpacts(state.market, idx),
            }))
            .filter((item) => item.impacts.length > 0);
          return `
            ${
              nearEvents.length > 0
                ? `<div class="p-3 rounded-lg bg-[#d4a853]/10 border border-[#d4a853]/35 text-xs space-y-1.5">
                    <div class="font-bold text-[#d4a853] flex items-center gap-1.5">
                      ${icons.bolt}
                      <span>أحداث موسمية في الأشهر (ش${m + 1} – ش${m + 3}):</span>
                    </div>
                    ${nearEvents
                      .map(
                        (ev) => `
                      <div class="text-[#f5f0e6] flex items-start justify-between gap-2">
                        <div>
                          <div><strong class="font-num text-[#d4a853]">ش${ev.monthIndex + 1}</strong> · ${ev.commodityName}: ${ev.title}</div>
                          <div class="text-[11px] text-[#9ca3af] mt-0.5">السبب: ${ev.reason}</div>
                        </div>
                        <span class="font-num font-bold shrink-0 ${ev.direction === 'up' ? 'text-[#10b981]' : 'text-[#ef4444]'}" dir="ltr">${ev.priceDelta > 0 ? '+' : ''}${ev.priceDelta} ر.س</span>
                      </div>
                    `
                      )
                      .join('')}
                  </div>`
                : ''
            }
            ${
              nearHijri.length > 0
                ? `<div class="p-3 rounded-lg bg-[#10b981]/10 border border-[#10b981]/35 text-xs space-y-1.5">
                    <div class="font-bold text-[#34d399] flex items-center gap-1.5">
                      ${icons.calendar}
                      <span>تأثير الشهور الهجرية القادمة (ش${m + 1} – ش${m + 3}):</span>
                    </div>
                    ${nearHijri
                      .map(
                        (item) => `
                      <div class="text-[#f5f0e6]">
                        <strong class="font-num text-[#34d399]">ش${item.idx + 1} (${item.dual.hijriLabel}):</strong>
                        ${item.impacts
                          .map(
                            (imp) =>
                              `${imp.commodityName} (<span dir="ltr" class="font-num">${imp.impactPct >= 0 ? '+' : ''}${Math.round(imp.impactPct * 100)}%</span>)`
                          )
                          .join(' · ')}
                      </div>
                    `
                      )
                      .join('')}
                  </div>`
                : ''
            }
          `;
        })()}
        <table class="w-full text-right border-collapse">
          <thead>
            <tr class="border-b border-[#d4a853]/30 text-xs text-[#9ca3af]">
              <th class="py-2 px-3">السلعة</th>
              <th class="py-2 px-3">النمط الفعلي</th>
              <th class="py-2 px-3">القانون الرياضي</th>
              <th class="py-2 px-3">الحالي (ش${m + 1})</th>
              <th class="py-2 px-3">ش${m + 2}</th>
              <th class="py-2 px-3">ش${m + 3}</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="px-5 py-3 border-t border-[#f5f0e6]/10 flex justify-end bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-5 py-2 text-sm font-semibold bg-[#1d222d] text-[#f5f0e6] rounded-lg border border-[#f5f0e6]/15">إغلاق الدليل</button>
      </div>
    `;
  }

  private renderChampionshipModal(state: GameState): string {
    const leaderboard = getLeaderboard(state);
    const winner = leaderboard[0];
    const { year, monthInYear, absoluteMonth } = getYearAndMonthDisplay(
      state.currentMonthIndex
    );

    return `
      <div class="p-6 text-center space-y-5 overflow-y-auto">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#d4a853]/15 text-[#d4a853] mx-auto">
          ${icons.trophy}
        </div>
        <div>
          <h2 class="font-display text-2xl font-bold text-[#d4a853]">ختام بورصة البر والفعاليات</h2>
          <p class="text-sm text-[#9ca3af] mt-1">${
            state.config.horizonMode === 'unlimited'
              ? `تم إغلاق الجلسة عند الشهر ${absoluteMonth} (السنة ${year} · الشهر ${monthInYear})`
              : `تم إكمال الـ 36 شهراً (السنة ${year} · الشهر ${monthInYear})`
          } · البطل: <strong class="text-[#f5f0e6]">${winner?.team.name ?? ''}</strong></p>
        </div>

        <div class="space-y-2 text-right">
          ${leaderboard
            .map((entry) => {
              const roi = Math.round(
                ((entry.netWorth - state.config.startingCash) /
                  state.config.startingCash) *
                  100
              );
              return `
              <div class="flex items-center justify-between p-3.5 rounded-lg border ${
                entry.rank === 1
                  ? 'bg-[#d4a853]/12 border-[#d4a853]/45'
                  : 'bg-[#0d0f14] border-[#f5f0e6]/10'
              }">
                <div class="flex items-center gap-3">
                  <span class="font-num text-sm font-bold ${entry.rank === 1 ? 'text-[#d4a853]' : 'text-[#9ca3af]'}">#${entry.rank}</span>
                  <div>
                    <div class="text-sm font-bold text-[#f5f0e6]">${entry.team.name}</div>
                    <div class="text-xs text-[#9ca3af] font-num">سيولة: ${entry.team.cash.toLocaleString('en-US')} · أصول: ${entry.assetsValue.toLocaleString('en-US')}</div>
                  </div>
                </div>
                <div class="text-left font-num">
                  <div class="text-base font-bold text-[#f5f0e6]">${entry.netWorth.toLocaleString('en-US')} ر.س</div>
                  <div class="text-xs ${roi >= 0 ? 'text-[#10b981]' : 'text-[#ef4444]'}">${roi >= 0 ? '+' : ''}${roi}% عائد</div>
                </div>
              </div>
            `;
            })
            .join('')}
        </div>

        <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
          <button type="button" id="champ-export-btn" class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#1d222d] border border-[#f5f0e6]/15 rounded-lg text-[#f5f0e6]">
            ${icons.save}
            <span>تصدير النتيجة JSON</span>
          </button>
          <button type="button" id="champ-undo-btn" class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#1d222d] border border-[#f5f0e6]/15 rounded-lg text-[#f5f0e6]">
            ${icons.undo}
            <span>تراجع خطوة</span>
          </button>
          <button type="button" id="champ-reset-btn" data-testid="champ-reset-btn" class="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-[#ef4444]/15 border border-[#ef4444]/40 rounded-lg text-[#fca5a5] hover:bg-[#ef4444]/25">
            ${icons.reset}
            <span>إعادة البورصة من البداية</span>
          </button>
          <button type="button" id="champ-new-btn" class="px-5 py-2 text-xs font-bold bg-[#d4a853] text-[#0d0f14] rounded-lg">
            جلسة جديدة
          </button>
        </div>
      </div>
    `;
  }

  private renderSeasonalEventModal(
    state: GameState,
    event: SeasonalEventRecord
  ): string {
    const { year, monthInYear, absoluteMonth } = getYearAndMonthDisplay(event.monthIndex);
    const isUp = event.direction === 'up';
    const pct = Math.round(event.impactPct * 100);
    const afterPrice = getEffectivePrice(state.market, event.commodityId, event.monthIndex);
    const beforePrice = Math.max(1, afterPrice - event.priceDelta);

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b ${
        isUp ? 'border-[#10b981]/30 bg-[#10b981]/8' : 'border-[#ef4444]/30 bg-[#ef4444]/8'
      }" data-testid="seasonal-event-modal">
        <div class="flex items-center gap-2.5">
          <span class="inline-flex items-center justify-center w-9 h-9 rounded-full ${
            isUp ? 'bg-[#10b981]/20 text-[#34d399]' : 'bg-[#ef4444]/20 text-[#fca5a5]'
          }">
            ${icons.bolt}
          </span>
          <div>
            <div class="text-xs font-semibold text-[#d4a853]">
              حدث موسمي عاجل · الشهر ${absoluteMonth} (السنة ${year} · الشهر ${monthInYear})
            </div>
            <h2 class="font-display text-lg font-bold text-[#f5f0e6] mt-0.5">${event.title}</h2>
          </div>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <div class="p-5 space-y-4 overflow-y-auto">
        <!-- Reason Card -->
        <div class="p-4 rounded-xl bg-[#0d0f14] border border-[#d4a853]/30 space-y-1.5" data-testid="seasonal-modal-reason">
          <div class="text-xs font-bold text-[#d4a853]">سبب الحدث وتداعياته في السوق:</div>
          <p class="text-sm text-[#f5f0e6] leading-relaxed">${event.reason}</p>
        </div>

        <!-- Single Targeted Commodity Impact -->
        <div class="p-4 rounded-xl border ${
          isUp ? 'bg-[#10b981]/8 border-[#10b981]/40' : 'bg-[#ef4444]/8 border-[#ef4444]/40'
        } space-y-3" data-testid="seasonal-modal-impact">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="text-xs text-[#9ca3af] block">المنتج المتأثر فقط هذا الشهر</span>
              <span class="font-display text-xl font-bold text-[#f5f0e6]" data-testid="seasonal-modal-commodity">${event.commodityName}</span>
            </div>
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold ${
              isUp
                ? 'bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/45'
                : 'bg-[#ef4444]/20 text-[#fca5a5] border border-[#ef4444]/45'
            }" data-testid="seasonal-modal-pct">
              ${isUp ? icons.arrowUp : icons.arrowDown}
              <span>${isUp ? 'ارتفاع' : 'انخفاض'}</span>
              <span dir="ltr" class="font-num">${isUp ? '+' : '-'}${pct}%</span>
            </span>
          </div>

          <div class="grid grid-cols-3 gap-2.5 pt-2 border-t border-[#f5f0e6]/10 text-center">
            <div class="p-2.5 rounded-lg bg-[#0d0f14]/80">
              <div class="text-[11px] text-[#9ca3af]">قبل الحدث</div>
              <div class="font-num text-sm font-semibold text-[#f5f0e6] mt-0.5">${beforePrice} <span class="text-[10px] text-[#9ca3af]">ر.س</span></div>
            </div>
            <div class="p-2.5 rounded-lg bg-[#0d0f14]/80">
              <div class="text-[11px] text-[#9ca3af]">أثر الحدث</div>
              <div class="font-num text-sm font-bold mt-0.5 ${isUp ? 'text-[#10b981]' : 'text-[#ef4444]'}">
                <span dir="ltr">${event.priceDelta > 0 ? '+' : ''}${event.priceDelta}</span>
                <span class="text-[10px]">ر.س</span>
              </div>
            </div>
            <div class="p-2.5 rounded-lg bg-[#0d0f14] border border-[#d4a853]/35">
              <div class="text-[11px] text-[#d4a853]">السعر الحالي</div>
              <div class="font-num text-base font-bold text-[#f5f0e6] mt-0.5">${afterPrice} <span class="text-[10px] text-[#9ca3af]">ر.س</span></div>
            </div>
          </div>

          <p class="text-[11px] text-[#9ca3af]">
            ملاحظة: بقية المنتجات لم تتأثر بهذا الحدث وتواصل مسارها المعتاد.
          </p>
        </div>
      </div>

      <div class="px-5 py-4 border-t border-[#f5f0e6]/10 flex items-center justify-end bg-[#0d0f14]">
        <button
          type="button"
          data-close-modal="true"
          data-testid="close-seasonal-event-modal"
          class="px-6 py-2.5 text-sm font-bold bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] rounded-lg transition-colors cursor-pointer"
        >متابعة التداول</button>
      </div>
    `;
  }

  private renderSavedSessionsModal(
    modal: Extract<ModalKind, { type: 'saved_sessions' }>,
    state: GameState | null
  ): string {
    const slots = modal.slots;
    const currentDual = state
      ? getDualCalendarForMonth(state.config, state.currentMonthIndex)
      : null;

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10" data-testid="saved-sessions-modal">
        <div class="flex items-center gap-2.5">
          <span class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#d4a853]/15 text-[#d4a853]">
            ${icons.bookmark}
          </span>
          <div>
            <h2 class="font-display text-lg font-bold text-[#d4a853]">خزنة البيانات المحفوظة داخل التطبيق</h2>
            <p class="text-xs text-[#9ca3af] mt-0.5">احفظ نقاط تقدم الجلسات واسترجعها في أي وقت من ذاكرة التطبيق مباشرة.</p>
          </div>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <div class="p-5 space-y-4 overflow-y-auto">
        ${
          modal.canSaveCurrent && state && currentDual
            ? `<div class="p-4 rounded-xl bg-[#0d0f14] border border-[#d4a853]/35 space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span class="font-bold text-[#d4a853]">حفظ الجلسة النشطة الآن:</span>
                  <span class="text-[#9ca3af]">${state.config.sessionName} · الشهر ${state.currentMonthIndex + 1} (${currentDual.shortLabel})</span>
                </div>
                <div class="flex flex-col sm:flex-row gap-2.5">
                  <input
                    id="save-slot-label-input"
                    data-testid="save-slot-label-input"
                    type="text"
                    placeholder="اسم نقطة الحفظ (مثال: كشتة رمضان - نهاية ش4)"
                    class="flex-1 px-3.5 py-2.5 bg-[#161a22] border border-[#f5f0e6]/15 rounded-lg text-sm text-[#f5f0e6] placeholder:text-[#9ca3af]/60 focus:border-[#d4a853] focus:outline-none"
                  />
                  <button
                    type="button"
                    id="save-slot-btn"
                    data-testid="save-slot-btn"
                    class="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold rounded-lg bg-[#d4a853] hover:bg-[#e2bc6f] text-[#0d0f14] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    ${icons.bookmark}
                    <span>حفظ الجلسة الحالية</span>
                  </button>
                </div>
              </div>`
            : `<div class="p-3 rounded-lg bg-[#0d0f14] border border-[#f5f0e6]/10 text-xs text-[#9ca3af]">
                ابدأ جلسة لتتمكن من حفظ نقاط جديدة، أو اختر إحدى الجلسات المحفوظة أدناه لاسترجاعها فوراً.
              </div>`
        }

        ${
          this.modalError
            ? `<div class="p-3 rounded-lg bg-[#ef4444]/15 border border-[#ef4444]/30 text-xs text-[#fca5a5]">${this.modalError}</div>`
            : ''
        }

        <div class="space-y-2.5">
          <div class="flex items-center justify-between text-xs text-[#9ca3af]">
            <span class="font-semibold text-[#f5f0e6]">الجلسات المحفوظة (${slots.length})</span>
            <span>تُحفظ محلياً داخل المتصفح حتى بعد الإغلاق</span>
          </div>

          <div class="space-y-2.5 max-h-72 overflow-y-auto" data-testid="saved-slots-list">
            ${
              slots.length === 0
                ? `<div class="p-6 text-center rounded-xl bg-[#0d0f14] border border-[#f5f0e6]/10 text-xs text-[#9ca3af]">
                    لا توجد جلسات محفوظة بعد داخل التطبيق. احفظ جلستك الأولى بالأعلى للرجوع إليها لاحقاً.
                  </div>`
                : slots
                    .map((slot) => {
                      const savedDate = new Date(slot.savedAt).toLocaleString('ar-SA', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      });
                      return `
                      <div class="p-3.5 rounded-xl bg-[#0d0f14] border border-[#f5f0e6]/12 hover:border-[#d4a853]/35 transition-colors flex flex-wrap items-center justify-between gap-3" data-testid="saved-slot-item-${slot.id}">
                        <div class="min-w-0 flex-1 space-y-1">
                          <div class="font-display text-sm font-bold text-[#f5f0e6] truncate">${slot.label}</div>
                          <div class="flex flex-wrap items-center gap-2 text-[11px] text-[#9ca3af]">
                            <span class="font-num text-[#d4a853] font-semibold">الشهر ${slot.monthNumber}</span>
                            <span>· ${slot.gregorianLabel}</span>
                            <span class="text-[#34d399]">· ${slot.hijriLabel}</span>
                            <span>· ${slot.teamCount} فرق</span>
                            ${slot.leaderName ? `<span>· المتصدر: ${slot.leaderName}</span>` : ''}
                          </div>
                          <div class="text-[10px] text-[#9ca3af]/75">${slot.sessionName} · حُفظت في ${savedDate}</div>
                        </div>

                        <div class="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            data-load-slot="${slot.id}"
                            class="px-3 py-1.5 text-xs font-bold rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-[#34d399] hover:bg-[#10b981]/25 cursor-pointer"
                          >استرجاع</button>
                          ${
                            modal.canSaveCurrent
                              ? `<button
                                  type="button"
                                  data-overwrite-slot="${slot.id}"
                                  class="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[#161a22] border border-[#d4a853]/30 text-[#d4a853] hover:bg-[#d4a853]/15 cursor-pointer"
                                >استبدال</button>`
                              : ''
                          }
                          <button
                            type="button"
                            data-delete-slot="${slot.id}"
                            class="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-[#161a22] border border-[#ef4444]/30 text-[#fca5a5] hover:bg-[#ef4444]/15 cursor-pointer"
                          >حذف</button>
                        </div>
                      </div>
                    `;
                    })
                    .join('')
            }
          </div>
        </div>
      </div>

      <div class="px-5 py-3.5 border-t border-[#f5f0e6]/10 flex justify-end bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-5 py-2 text-xs font-semibold bg-[#1d222d] text-[#f5f0e6] rounded-lg border border-[#f5f0e6]/15">إغلاق الخزنة</button>
      </div>
    `;
  }

  private renderConfirmResetModal(state: GameState): string {
    const startDual = getDualCalendarForMonth(state.config, 0);

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#ef4444]/30 bg-[#ef4444]/8" data-testid="confirm-reset-modal">
        <div class="flex items-center gap-2.5">
          <span class="inline-flex items-center justify-center w-9 h-9 rounded-full bg-[#ef4444]/20 text-[#fca5a5]">
            ${icons.reset}
          </span>
          <div>
            <h2 class="font-display text-lg font-bold text-[#f5f0e6]">إعادة البورصة من البداية</h2>
            <p class="text-xs text-[#fca5a5] mt-0.5">إرجاع الجلسة إلى الشهر 1 (${startDual.shortLabel})</p>
          </div>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <div class="p-5 space-y-4">
        <div class="p-4 rounded-xl bg-[#0d0f14] border border-[#f5f0e6]/12 text-xs text-[#f5f0e6]/90 space-y-2 leading-relaxed">
          <p class="font-semibold text-[#d4a853]">سيتم تطبيق الإجراءات التالية عند إعادة البورصة:</p>
          <ul class="list-disc pr-5 space-y-1 text-[#9ca3af]">
            <li>العودة إلى <strong class="text-[#f5f0e6]">الشهر 1</strong> (${startDual.shortLabel}).</li>
            <li>إرجاع سيولة جميع الفرق (<span class="font-num">${state.teams.length}</span> فرق) إلى رأس المال الافتتاحي (<span class="font-num text-[#f5f0e6]">${state.config.startingCash.toLocaleString('en-US')}</span> ر.س).</li>
            <li>تفريغ محافظ الأصول وسجل الصفقات والتقارير السرية وأثر العرض والطلب.</li>
            <li>الاحتفاظ بنقطة تراجع في سجل التراجع للعودة إذا رغبت.</li>
          </ul>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            id="confirm-reset-same-plan-btn"
            data-testid="confirm-reset-same-plan-btn"
            class="p-3.5 rounded-xl bg-[#d4a853]/15 border border-[#d4a853]/50 hover:bg-[#d4a853]/25 text-right space-y-1 transition-colors cursor-pointer"
          >
            <div class="font-display text-sm font-bold text-[#d4a853]">إعادة بنفس خطة الأسعار</div>
            <div class="text-[11px] text-[#9ca3af] leading-relaxed">يبدأ من الشهر 1 بنفس مسار الأسعار المعتمد والتعديلات المخصصة.</div>
          </button>

          <button
            type="button"
            id="confirm-reset-new-seed-btn"
            data-testid="confirm-reset-new-seed-btn"
            class="p-3.5 rounded-xl bg-[#ef4444]/15 border border-[#ef4444]/45 hover:bg-[#ef4444]/25 text-right space-y-1 transition-colors cursor-pointer"
          >
            <div class="font-display text-sm font-bold text-[#fca5a5]">إعادة بأسعار جديدة كلياً</div>
            <div class="text-[11px] text-[#9ca3af] leading-relaxed">يبدأ من الشهر 1 مع توليد أرقام سوق وأحداث جديدة للفرق.</div>
          </button>
        </div>
      </div>

      <div class="px-5 py-3.5 border-t border-[#f5f0e6]/10 flex justify-end bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-5 py-2 text-xs text-[#9ca3af] hover:text-[#f5f0e6]">إلغاء والعودة للبورصة</button>
      </div>
    `;
  }

  private renderAndroidApkModal(): string {
    const pwaState = pwaInstallService.getState();
    const apkPlan = buildAndroidApkPlan();
    const cliBlock = apkPlan.commands.join(' && ');

    return `
      <div class="flex items-center justify-between px-5 py-4 border-b border-[#f5f0e6]/10">
        <div class="flex items-center gap-3">
          <img
            src="/pwa-192x192.png"
            alt="أيقونة تطبيق بورصة البر"
            class="w-11 h-11 rounded-xl border border-[#d4a853]/30 shrink-0"
          />
          <div>
            <h2 class="font-display text-lg font-bold text-[#d4a853]">تثبيت التطبيق على أندرويد وتجهيز APK</h2>
            <p class="text-xs text-[#9ca3af] mt-0.5 font-mono" dir="ltr">${apkPlan.appId} · v1.0.0</p>
          </div>
        </div>
        <button type="button" data-close-modal="true" aria-label="إغلاق النافذة" class="p-2 text-[#9ca3af] hover:text-[#f5f0e6] rounded-lg">${icons.close}</button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-4 text-sm" data-testid="android-apk-modal-body">
        ${
          this.modalError
            ? `<div class="p-3 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-xs text-[#34d399]" role="status">${this.modalError}</div>`
            : ''
        }

        <!-- Section 1: Instant Android WebAPK / PWA Install -->
        <section class="p-4 rounded-xl bg-[#0d0f14] border border-[#10b981]/35 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-[#34d399] font-display font-bold">
              ${icons.smartphone}
              <span>1) التثبيت الفوري كتطبيق أندرويد (WebAPK / دون متصفح)</span>
            </div>
            <span class="px-2 py-0.5 text-[11px] rounded bg-[#10b981]/15 text-[#34d399]">
              ${pwaState.isInstalled ? 'مثبت حالياً' : 'جاهز للعمل دون إنترنت'}
            </span>
          </div>

          <p class="text-xs text-[#9ca3af] leading-relaxed">
            التطبيق مجهّز بملف <span class="font-mono text-[#f5f0e6]" dir="ltr">Web App Manifest</span> وخدمة تخزين محلي (<span class="font-mono text-[#f5f0e6]" dir="ltr">Service Worker</span>) للعمل بدون إنترنت في الكشتات والبر بكامل الشاشة.
          </p>

          ${
            pwaState.isInstalled
              ? `<div class="p-3 rounded-lg bg-[#10b981]/15 border border-[#10b981]/40 text-xs text-[#34d399] font-medium">
                  التطبيق يعمل الآن بوضع التطبيق المستقل (Standalone) ويمكن تشغيله بدون اتصال بالإنترنت.
                </div>`
              : pwaState.canPromptInstall
                ? `<button
                    type="button"
                    id="apk-direct-install-btn"
                    data-testid="apk-direct-install-btn"
                    class="w-full py-2.5 px-4 rounded-lg bg-[#10b981] hover:bg-[#34d399] text-[#0d0f14] font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    ${icons.download}
                    <span>تثبيت التطبيق الآن على الجهاز</span>
                  </button>`
                : pwaState.isIOS
                  ? `<div class="p-3 rounded-lg bg-[#161a22] border border-[#f5f0e6]/10 text-xs text-[#f5f0e6] space-y-1">
                      <div class="font-semibold text-[#d4a853]">خطوات التثبيت على iPhone / iPad (Safari):</div>
                      <div>1. اضغط على زر <strong>المشاركة (Share)</strong> في شريط Safari بالأسفل.</div>
                      <div>2. اختر <strong>إضافة إلى الصفحة الرئيسية (Add to Home Screen)</strong>.</div>
                    </div>`
                  : `<div class="p-3 rounded-lg bg-[#161a22] border border-[#f5f0e6]/10 text-xs text-[#f5f0e6] space-y-1">
                      <div class="font-semibold text-[#d4a853]">خطوات التثبيت الفوري على أندرويد (Chrome):</div>
                      <div>1. افتح رابط التطبيق في متصفح <strong>Chrome</strong> على هاتف أندرويد.</div>
                      <div>2. اضغط قائمة المتصفح (<strong>⋮</strong>) ثم اختر <strong>تثبيت التطبيق (Install App)</strong> ليظهر بأيقونة مستقلة كأي تطبيق APK.</div>
                    </div>`
          }
        </section>

        <!-- Section 2: Native Capacitor Android APK Project -->
        <section class="p-4 rounded-xl bg-[#0d0f14] border border-[#d4a853]/30 space-y-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 text-[#d4a853] font-display font-bold">
              ${icons.cube}
              <span>2) حزمة بناء ملف APK قياسي (Capacitor + Gradle)</span>
            </div>
            <span class="px-2 py-0.5 text-[11px] rounded bg-[#d4a853]/15 text-[#d4a853] font-mono" dir="ltr">Android</span>
          </div>

          <p class="text-xs text-[#9ca3af] leading-relaxed">
            بيئة المعاينة السحابية لا تحتوي على Android SDK أو Gradle لتجميع ملف <span class="font-mono text-[#f5f0e6]" dir="ltr">.apk</span> ثنائي هنا مباشرة، لكن المشروع تم تجهيزه بالكامل بحزمة <strong class="text-[#f5f0e6]">Capacitor Android</strong> ومشروع Gradle وملف بناء تلقائي <span class="font-mono text-[#f5f0e6]" dir="ltr">${apkPlan.workflowPath}</span>.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div class="p-2.5 rounded-lg bg-[#161a22] border border-[#f5f0e6]/10">
              <div class="text-[#9ca3af]">معرّف الحزمة (Application ID)</div>
              <div class="font-mono text-[#f5f0e6] mt-0.5" dir="ltr">${apkPlan.appId}</div>
            </div>
            <div class="p-2.5 rounded-lg bg-[#161a22] border border-[#f5f0e6]/10">
              <div class="text-[#9ca3af]">مسار ملف APK الناتج</div>
              <div class="font-mono text-[#34d399] mt-0.5 break-all text-[11px]" dir="ltr">${apkPlan.apkOutputPath}</div>
            </div>
          </div>

          <div class="space-y-1.5">
            <div class="flex items-center justify-between gap-2 text-xs">
              <span class="text-[#9ca3af]">أوامر توليد ملف APK محلياً (أو عبر GitHub Actions):</span>
              <button
                type="button"
                id="apk-copy-cmd-btn"
                data-testid="apk-copy-cmd-btn"
                class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#161a22] border border-[#d4a853]/35 text-[#d4a853] hover:bg-[#d4a853]/15 text-[11px] cursor-pointer shrink-0"
              >
                ${icons.copy}
                <span>نسخ الأوامر</span>
              </button>
            </div>
            <pre class="p-3 rounded-lg bg-[#161a22] border border-[#f5f0e6]/10 text-[11px] font-mono text-[#f5f0e6] whitespace-pre-wrap break-all select-all" dir="ltr">${cliBlock}</pre>
          </div>
        </section>
      </div>

      <div class="px-5 py-3.5 border-t border-[#f5f0e6]/10 flex justify-end bg-[#0d0f14]">
        <button type="button" data-close-modal="true" class="px-5 py-2 text-xs text-[#f5f0e6] bg-[#161a22] border border-[#f5f0e6]/15 rounded-lg hover:border-[#d4a853]/40">إغلاق</button>
      </div>
    `;
  }

  private bindEvents(modal: ModalKind, state: GameState | null) {
    this.container.querySelectorAll('[data-close-modal="true"]').forEach((el) =>
      el.addEventListener('click', () => this.callbacks.onClose())
    );

    this.container
      .querySelector('[data-modal-backdrop="true"]')
      ?.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) this.callbacks.onClose();
      });

    if (modal.type === 'pre_adoption_plan') {
      this.container
        .querySelectorAll<HTMLButtonElement>('[data-plan-year-tab]')
        .forEach((btn) =>
          btn.addEventListener('click', () => {
            this.planYearTab = Number(btn.dataset.planYearTab);
            this.render(modal, state);
          })
        );

      this.container
        .querySelectorAll<HTMLInputElement>('[data-plan-cid]')
        .forEach((inp) => {
          const syncCell = () => {
            const cid = inp.dataset.planCid!;
            const mIdx = Number(inp.dataset.planMonth);
            const rawVal = Number(inp.value);
            if (!Number.isFinite(rawVal) || rawVal < 1) return;
            const rounded = Math.round(rawVal);
            if (!this.draftPreAdoptionOverrides[cid]) {
              this.draftPreAdoptionOverrides[cid] = {};
            }
            this.draftPreAdoptionOverrides[cid][mIdx] = rounded;
          };
          inp.addEventListener('input', syncCell);
          inp.addEventListener('change', () => {
            syncCell();
            this.render(modal, state);
          });
        });

      this.container
        .querySelector('#plan-clear-overrides')
        ?.addEventListener('click', () => {
          this.draftPreAdoptionOverrides = {};
          this.render(modal, state);
        });

      this.container
        .querySelector('#plan-save-only-btn')
        ?.addEventListener('click', () => {
          this.callbacks.onSavePreAdoptionPlan(
            this.draftPreAdoptionOverrides,
            modal.config,
            modal.teamNames
          );
        });

      this.container
        .querySelector('#plan-adopt-start-btn')
        ?.addEventListener('click', () => {
          this.callbacks.onAdoptAndStartPlan(
            this.draftPreAdoptionOverrides,
            modal.config,
            modal.teamNames
          );
        });
    } else if (modal.type === 'monthly_plan_editor' && state) {
      this.container
        .querySelectorAll<HTMLButtonElement>('[data-plan-year-tab]')
        .forEach((btn) =>
          btn.addEventListener('click', () => {
            this.planYearTab = Number(btn.dataset.planYearTab);
            this.render(modal, state);
          })
        );

      this.container
        .querySelector('#mod-extend-year-btn')
        ?.addEventListener('click', () => {
          this.callbacks.onExtendPlanYear();
        });

      this.container
        .querySelectorAll<HTMLInputElement>('[data-mod-plan-cid]')
        .forEach((inp) => {
          const syncCell = () => {
            const cid = inp.dataset.modPlanCid!;
            const mIdx = Number(inp.dataset.modPlanMonth);
            const rawVal = Number(inp.value);
            if (!Number.isFinite(rawVal) || rawVal < 1) return;
            const rounded = Math.round(rawVal);
            const orig = getEffectivePrice(state.market, cid, mIdx);
            const key = `${cid}:${mIdx}`;
            if (rounded === orig) {
              delete this.draftSessionEdits[key];
            } else {
              this.draftSessionEdits[key] = {
                commodityId: cid,
                monthIndex: mIdx,
                price: rounded,
              };
            }
          };
          inp.addEventListener('input', syncCell);
          inp.addEventListener('change', () => {
            syncCell();
            this.render(modal, state);
          });
        });

      this.container
        .querySelector('#save-monthly-plan-btn')
        ?.addEventListener('click', () => {
          const edits = Object.values(this.draftSessionEdits);
          const err = this.callbacks.onSaveMonthlyPlan(edits);
          if (err) {
            this.modalError = err;
            this.render(modal, state);
          }
        });
    } else if (modal.type === 'team_funding' && state) {
      this.container
        .querySelectorAll<HTMLButtonElement>('[data-funding-all]')
        .forEach((btn) =>
          btn.addEventListener('click', () => {
            const amt = Number(btn.dataset.fundingAll) || 0;
            for (const team of state.teams) {
              this.fundingAmounts[team.id] = amt;
            }
            this.modalError = '';
            this.render(modal, state);
          })
        );

      this.container
        .querySelector<HTMLInputElement>('#funding-global-custom-input')
        ?.addEventListener('input', (e) => {
          this.globalCustomFunding = Math.max(
            0,
            Math.round(Number((e.target as HTMLInputElement).value) || 0)
          );
        });

      this.container
        .querySelector('#funding-apply-custom-all')
        ?.addEventListener('click', () => {
          const customInp = this.container.querySelector<HTMLInputElement>(
            '#funding-global-custom-input'
          );
          const val = Math.max(0, Math.round(Number(customInp?.value ?? 0) || 0));
          this.globalCustomFunding = val;
          for (const team of state.teams) {
            this.fundingAmounts[team.id] = val;
          }
          this.modalError = '';
          this.render(modal, state);
        });

      this.container
        .querySelectorAll<HTMLButtonElement>('[data-team-grant-preset]')
        .forEach((btn) =>
          btn.addEventListener('click', () => {
            const tid = btn.dataset.teamGrantPreset!;
            const amt = Number(btn.dataset.grantAmount) || 0;
            this.fundingAmounts[tid] = amt;
            this.modalError = '';
            this.render(modal, state);
          })
        );

      this.container
        .querySelectorAll<HTMLInputElement>('[data-funding-input]')
        .forEach((inp) => {
          const syncTeamGrant = () => {
            const tid = inp.dataset.fundingInput!;
            const val = Math.max(0, Math.round(Number(inp.value) || 0));
            this.fundingAmounts[tid] = val;
            const total = state.teams.reduce(
              (sum, t) => sum + Math.max(0, Math.round(this.fundingAmounts[t.id] ?? 0)),
              0
            );
            const readout = this.container.querySelector('[data-testid="funding-total-readout"]');
            if (readout) {
              readout.textContent = `+${total.toLocaleString('en-US')} ر.س`;
            }
          };
          inp.addEventListener('input', syncTeamGrant);
          inp.addEventListener('change', () => {
            syncTeamGrant();
            this.render(modal, state);
          });
        });

      this.container
        .querySelector('#confirm-funding-btn')
        ?.addEventListener('click', () => {
          const err = this.callbacks.onConfirmFunding(modal.mode, {
            ...this.fundingAmounts,
          });
          if (err) {
            this.modalError = err;
            this.render(modal, state);
          }
        });
    } else if (modal.type === 'trade' && state) {
      this.container
        .querySelector<HTMLSelectElement>('#trade-team-select')
        ?.addEventListener('change', (e) => {
          this.selectedTradeTeamId = (e.target as HTMLSelectElement).value;
          this.modalError = '';
          this.render(modal, state);
        });

      this.container
        .querySelectorAll<HTMLButtonElement>('[data-trade-step]')
        .forEach((btn) =>
          btn.addEventListener('click', () => {
            const cid = btn.dataset.tradeStep!;
            const step = Number(btn.dataset.step);
            this.tradeQuantities[cid] = (this.tradeQuantities[cid] ?? 0) + step;
            this.modalError = '';
            this.render(modal, state);
          })
        );

      this.container
        .querySelectorAll<HTMLInputElement>('[data-trade-input]')
        .forEach((inp) =>
          inp.addEventListener('change', () => {
            const cid = inp.dataset.tradeInput!;
            this.tradeQuantities[cid] = Math.trunc(Number(inp.value) || 0);
            this.modalError = '';
            this.render(modal, state);
          })
        );

      this.container
        .querySelector('#confirm-trade-btn')
        ?.addEventListener('click', () => {
          const orders: TradeOrderItem[] = Object.entries(this.tradeQuantities)
            .filter(([, q]) => q !== 0)
            .map(([commodityId, quantity]) => ({ commodityId, quantity }));
          const err = this.callbacks.onExecuteTrade(this.selectedTradeTeamId, orders);
          if (err) {
            this.modalError = err;
            this.render(modal, state);
          }
        });
    } else if (modal.type === 'secret_report' && state) {
      this.container
        .querySelector<HTMLSelectElement>('#hint-team-select')
        ?.addEventListener('change', (e) => {
          this.selectedHintTeamId = (e.target as HTMLSelectElement).value;
          this.modalError = '';
          this.render(modal, state);
        });

      this.container
        .querySelector<HTMLSelectElement>('#hint-commodity-select')
        ?.addEventListener('change', (e) => {
          this.selectedHintCommodityId = (e.target as HTMLSelectElement).value;
          this.modalError = '';
          this.render(modal, state);
        });

      this.container
        .querySelector('#confirm-hint-btn')
        ?.addEventListener('click', () => {
          const res = this.callbacks.onBuySecretReport(
            this.selectedHintTeamId,
            this.selectedHintCommodityId
          );
          if (res.error) {
            this.modalError = res.error;
            this.render(modal, state);
          } else {
            this.modalError = '';
            this.lastHintMessage = res.hintText ?? '';
            this.render(modal, state);
          }
        });
    } else if (modal.type === 'manual_override' && state) {
      this.container
        .querySelector<HTMLSelectElement>('#override-commodity-select')
        ?.addEventListener('change', (e) => {
          this.selectedOverrideCommodityId = (e.target as HTMLSelectElement).value;
          this.modalError = '';
          this.render(modal, state);
        });

      this.container
        .querySelectorAll<HTMLInputElement>('input[name="override-mode"]')
        .forEach((radio) =>
          radio.addEventListener('change', () => {
            this.overrideMode = radio.value as 'temporary' | 'permanent';
            this.render(modal, state);
          })
        );

      this.container
        .querySelector('#confirm-override-btn')
        ?.addEventListener('click', () => {
          const priceInput =
            this.container.querySelector<HTMLInputElement>('#override-price-input');
          const val = Number(priceInput?.value ?? 0);
          const err = this.callbacks.onApplyOverride(
            this.selectedOverrideCommodityId,
            val,
            this.overrideMode
          );
          if (err) {
            this.modalError = err;
            this.render(modal, state);
          }
        });
    } else if (modal.type === 'pin_gate') {
      this.container
        .querySelector('#pin-gate-form')
        ?.addEventListener('submit', (e) => {
          e.preventDefault();
          const inp = this.container.querySelector<HTMLInputElement>('#mod-pin-input');
          const ok = this.callbacks.onUnlockModerator(inp?.value ?? '');
          if (!ok) {
            this.modalError = 'رمز PIN غير صحيح.';
            this.render(modal, state);
          }
        });
    } else if (modal.type === 'championship') {
      this.container
        .querySelector('#champ-export-btn')
        ?.addEventListener('click', () => this.callbacks.onExportJson());
      this.container
        .querySelector('#champ-undo-btn')
        ?.addEventListener('click', () => this.callbacks.onUndoLast());
      this.container
        .querySelector('#champ-reset-btn')
        ?.addEventListener('click', () => this.callbacks.onOpenResetFromChamp());
      this.container
        .querySelector('#champ-new-btn')
        ?.addEventListener('click', () => this.callbacks.onNewSession());
    } else if (modal.type === 'saved_sessions') {
      const saveSlot = (overwriteId?: string) => {
        const inp = this.container.querySelector<HTMLInputElement>('#save-slot-label-input');
        const label = inp?.value.trim() ?? '';
        const err = this.callbacks.onSaveSessionSlot(label, overwriteId);
        if (err) {
          this.modalError = err;
          this.render(modal, state);
        }
      };

      this.container
        .querySelector('#save-slot-btn')
        ?.addEventListener('click', () => saveSlot());

      this.container
        .querySelectorAll<HTMLButtonElement>('[data-load-slot]')
        .forEach((btn) =>
          btn.addEventListener('click', () => {
            const err = this.callbacks.onLoadSessionSlot(btn.dataset.loadSlot!);
            if (err) {
              this.modalError = err;
              this.render(modal, state);
            }
          })
        );

      this.container
        .querySelectorAll<HTMLButtonElement>('[data-overwrite-slot]')
        .forEach((btn) =>
          btn.addEventListener('click', () => saveSlot(btn.dataset.overwriteSlot!))
        );

      this.container
        .querySelectorAll<HTMLButtonElement>('[data-delete-slot]')
        .forEach((btn) =>
          btn.addEventListener('click', () =>
            this.callbacks.onDeleteSessionSlot(btn.dataset.deleteSlot!)
          )
        );
    } else if (modal.type === 'confirm_reset') {
      this.container
        .querySelector('#confirm-reset-same-plan-btn')
        ?.addEventListener('click', () => this.callbacks.onConfirmReset(false));
      this.container
        .querySelector('#confirm-reset-new-seed-btn')
        ?.addEventListener('click', () => this.callbacks.onConfirmReset(true));
    } else if (modal.type === 'android_apk') {
      this.container
        .querySelector('#apk-direct-install-btn')
        ?.addEventListener('click', async () => {
          const outcome = await this.callbacks.onPromptPwaInstall();
          if (outcome === 'accepted') {
            this.modalError = 'تم تثبيت التطبيق بنجاح على جهازك.';
          } else if (outcome === 'unavailable') {
            this.modalError = 'التثبيت المباشر غير متاح في هذا المتصفح، اتبع خطوات التثبيت اليدوي أعلاه.';
          }
          this.render(modal, state);
        });

      this.container
        .querySelector('#apk-copy-cmd-btn')
        ?.addEventListener('click', async () => {
          const cmd = buildAndroidApkPlan().commands.join(' && ');
          let copied = false;
          try {
            if (navigator.clipboard?.writeText) {
              await navigator.clipboard.writeText(cmd);
              copied = true;
            }
          } catch {
            copied = false;
          }
          if (!copied) {
            try {
              const ta = document.createElement('textarea');
              ta.value = cmd;
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              copied = document.execCommand('copy');
              document.body.removeChild(ta);
            } catch {
              copied = false;
            }
          }
          this.modalError = copied
            ? 'تم نسخ أوامر بناء APK إلى الحافظة.'
            : 'تعذر النسخ التلقائي — يمكنك نسخ الأمر يدوياً من المربع أعلاه.';
          this.render(modal, state);
        });
    }
  }
}
