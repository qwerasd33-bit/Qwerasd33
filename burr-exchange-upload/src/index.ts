import * as xb from 'xrblocks';
import { DEFAULT_SESSION_CONFIG, DEFAULT_TEAM_NAMES, STORAGE_KEY } from './constants';
import {
  MarketEngine,
  MonthlyPlanEdit,
  createInitialGameState,
} from './services/MarketEngine';
import {
  deleteSavedSessionSlot,
  listSavedSessions,
  loadSavedSessionState,
  saveSessionSlot,
} from './services/SavedSessionsStore';
import { pwaInstallService } from './services/PwaInstallService';
import { GameState, SessionConfig, TradeOrderItem } from './types';
import { MarketWorkspace } from './ui/MarketWorkspace';
import { ModalKind, ModalRenderer } from './ui/Modals';
import { SetupView } from './ui/SetupView';
import { DesertCampScene, detectSoftwareWebGL } from './xr/DesertCampScene';

class BurrExchangeApp {
  private root: HTMLElement;
  private uiLayer: HTMLElement;
  private modalLayer: HTMLElement;

  private setupView: SetupView;
  private workspace: MarketWorkspace;
  private modalRenderer: ModalRenderer;
  private campScene?: DesertCampScene;

  private marketEngine = new MarketEngine();
  private gameState: GameState | null = null;
  private viewMode: 'setup' | 'market' = 'setup';
  private activeModal: ModalKind = { type: 'none' };

  private moderatorVisible = false;
  private is3DZenMode = false;
  private toastMessage: string | null = null;
  private toastTimeout: number | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.className = 'relative w-full h-full overflow-hidden';

    // Isolated canvas for XR Blocks 3D scene
    const canvas = document.createElement('canvas');
    canvas.id = 'xr-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    this.root.appendChild(canvas);

    this.uiLayer = document.createElement('div');
    this.uiLayer.className = 'relative z-10 w-full h-full';
    this.root.appendChild(this.uiLayer);

    this.modalLayer = document.createElement('div');
    this.modalLayer.className = 'hidden';
    this.root.appendChild(this.modalLayer);

    pwaInstallService.init();
    pwaInstallService.subscribe(() => this.render());

    const saved = this.loadFromStorage();
    const initialSlots = listSavedSessions();

    this.setupView = new SetupView(
      this.uiLayer,
      {
        onStartSession: (config, teamNames) => this.startNewSession(config, teamNames),
        onPreviewPlan: (config, teamNames) => this.openPreAdoptionPlanModal(config, teamNames),
        onResumeSaved: () => {
          if (saved) {
            this.loadGameState(saved);
          }
        },
        onOpenSavedSessions: () => this.openSavedSessionsModal(),
        onImportJsonFile: (file) => void this.importJsonFile(file),
        onToggle3DPreview: () => this.toggle3DZenFromSetup(),
        onOpenApkInstall: () => this.openModal({ type: 'android_apk' }),
      },
      Boolean(saved),
      initialSlots.length
    );

    this.workspace = new MarketWorkspace(this.uiLayer, {
      onAdvanceMonth: () => this.handleAdvanceMonthClick(),
      onOpenTeamFunding: () => this.openModal({ type: 'team_funding', mode: 'grant_only' }),
      onOpenTradeModal: (teamId) => this.openModal({ type: 'trade', teamId }),
      onOpenSecretReportModal: (teamId, commodityId) =>
        this.openModal({ type: 'secret_report', teamId, commodityId }),
      onToggleModeratorBar: () => this.handleToggleModeratorBar(),
      onUndo: () => this.handleUndo(),
      onOpenOverrideModal: (commodityId) =>
        this.openModal({ type: 'manual_override', commodityId }),
      onOpenMonthlyPlanEditor: () => this.openModal({ type: 'monthly_plan_editor' }),
      onEndUnlimitedSession: () => this.handleEndUnlimitedSession(),
      onOpenCheatSheet: () => this.openModal({ type: 'cheat_sheet' }),
      onExportJson: () => this.exportJson(),
      onImportJsonFile: (file) => void this.importJsonFile(file),
      onOpenSetup: () => this.returnToSetup(),
      onToggle3DZen: () => {
        this.is3DZenMode = !this.is3DZenMode;
        if (this.is3DZenMode && this.gameState) {
          this.campScene?.updateMarketSummary(this.gameState);
          this.renderCurrentSceneOnceIfSoftwareGl();
        }
        this.render();
      },
      onOpenSeasonalEventModal: (monthIndex) => {
        if (!this.gameState) return;
        const targetIdx =
          typeof monthIndex === 'number' ? monthIndex : this.gameState.currentMonthIndex;
        if (targetIdx > this.gameState.currentMonthIndex) return;
        const ev = this.marketEngine.getActiveSeasonalEvent(targetIdx);
        if (ev) {
          this.openModal({ type: 'seasonal_event', event: ev });
        }
      },
      onOpenSavedSessions: () => this.openSavedSessionsModal(),
      onOpenResetModal: () => this.openModal({ type: 'confirm_reset' }),
      onOpenApkInstall: () => this.openModal({ type: 'android_apk' }),
    });
    this.workspace.setRerenderHook(() => this.render());

    this.modalRenderer = new ModalRenderer(this.modalLayer, {
      onClose: () => this.closeModal(),
      onExecuteTrade: (teamId, orders) => this.handleExecuteTrade(teamId, orders),
      onBuySecretReport: (teamId, commodityId) =>
        this.handleBuySecretReport(teamId, commodityId),
      onApplyOverride: (commodityId, newPrice, mode) =>
        this.handleManualOverride(commodityId, newPrice, mode),
      onUnlockModerator: (pinAttempt) => this.handlePinAttempt(pinAttempt),
      onExportJson: () => this.exportJson(),
      onUndoLast: () => {
        this.closeModal();
        this.handleUndo();
      },
      onNewSession: () => {
        this.closeModal();
        this.returnToSetup();
      },
      onSavePreAdoptionPlan: (overrides, config, teamNames) => {
        this.setupView.setDraftOverrides(overrides, config, teamNames);
        this.closeModal();
        this.showToast('تم حفظ تعديلات الخطة الشهرية في شاشة الإعداد.');
        this.render();
      },
      onAdoptAndStartPlan: (overrides, config, teamNames) => {
        const updatedConfig: SessionConfig = {
          ...config,
          customPlanOverrides: overrides,
        };
        this.setupView.setDraftOverrides(overrides, updatedConfig, teamNames);
        this.closeModal();
        this.startNewSession(updatedConfig, teamNames);
      },
      onSaveMonthlyPlan: (edits) => this.handleSaveMonthlyPlan(edits),
      onExtendPlanYear: () => this.handleExtendPlanYear(),
      onConfirmFunding: (mode, grants) => this.handleConfirmFunding(mode, grants),
      onSaveSessionSlot: (label, overwriteId) => this.handleSaveSessionSlot(label, overwriteId),
      onLoadSessionSlot: (slotId) => this.handleLoadSessionSlot(slotId),
      onDeleteSessionSlot: (slotId) => this.handleDeleteSessionSlot(slotId),
      onConfirmReset: (regeneratePrices) => this.handleConfirmReset(regeneratePrices),
      onOpenResetFromChamp: () => this.openModal({ type: 'confirm_reset' }),
      onPromptPwaInstall: () => pwaInstallService.promptInstall(),
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.activeModal.type !== 'none') {
        this.closeModal();
      }
    });

    const params = new URLSearchParams(window.location.search);
    if (saved) {
      this.loadGameState(saved);
    } else if (params.get('autostart') === '1') {
      this.startNewSession(
        { ...DEFAULT_SESSION_CONFIG },
        DEFAULT_TEAM_NAMES.slice(0, 4)
      );
    } else {
      this.render();
    }

    void this.initXRBlocks(canvas);
  }

  private async initXRBlocks(canvas: HTMLCanvasElement) {
    const isSoftwareGl = detectSoftwareWebGL();
    this.campScene = new DesertCampScene(isSoftwareGl);

    const options = new xb.Options();
    options.canvas = canvas;
    options.antialias = !isSoftwareGl;
    options.setAppTitle('بورصة البر والفعاليات');
    options.setAppDescription('محاكاة اقتصادية تفاعلية للكشتات والفعاليات.');
    options.xrButton.showEnterSimulatorButton = true;
    options.xrButton.alwaysAutostartSimulator = !isSoftwareGl;
    options.simulator.instructions.enabled = false;
    options.simulator.instructions.overlayEnabled = false;

    xb.add(this.campScene);
    try {
      await xb.init(options);
      if (this.gameState) {
        this.campScene.updateMarketSummary(this.gameState);
      }
      // On GPU-less headless Chromium (SwiftShader), pause continuous rAF loop and step on demand
      if (isSoftwareGl && xb.core) {
        xb.core.pause();
        xb.core.stepFrame(16);
      }
    } catch (err) {
      console.warn('XR Blocks initialization fallback:', err);
    }
  }

  private openPreAdoptionPlanModal(config: SessionConfig, teamNames: string[]) {
    const previewState = createInitialGameState(config, teamNames);
    const modal: ModalKind = {
      type: 'pre_adoption_plan',
      previewState,
      config,
      teamNames,
    };
    this.activeModal = modal;
    this.modalRenderer.resetTransientState(modal, null);
    this.modalRenderer.render(modal, null);
  }

  private startNewSession(config: SessionConfig, teamNames: string[]) {
    const state = this.marketEngine.initializeSession(config, teamNames);
    this.moderatorVisible = false;
    this.is3DZenMode = false;
    this.loadGameState(state);
    this.showToast(`تم اعتماد البورصة وبدأت الجلسة "${state.config.sessionName}" من الشهر الأول.`);
  }

  private loadGameState(state: GameState) {
    this.marketEngine.setState(state);
    this.gameState = state;
    this.viewMode = 'market';
    this.saveToStorage(state);
    this.campScene?.updateMarketSummary(state);
    if (state.isFinished) {
      this.openModal({ type: 'championship' });
    }
    this.render();
  }

  private returnToSetup() {
    this.viewMode = 'setup';
    this.is3DZenMode = false;
    this.closeModal();
    this.setupView.setHasSavedSession(Boolean(this.loadFromStorage()));
    this.setupView.setSavedSessionsCount(listSavedSessions().length);
    this.render();
  }

  private openSavedSessionsModal() {
    const slots = listSavedSessions();
    this.setupView.setSavedSessionsCount(slots.length);
    this.openModal({
      type: 'saved_sessions',
      canSaveCurrent: Boolean(this.gameState && this.viewMode === 'market'),
      slots,
    });
  }

  private handleSaveSessionSlot(label: string, overwriteId?: string): string | undefined {
    if (!this.gameState) return 'لا توجد جلسة نشطة لحفظها.';
    try {
      const slot = saveSessionSlot(this.gameState, label, overwriteId);
      const slots = listSavedSessions();
      this.setupView.setSavedSessionsCount(slots.length);
      this.openModal({
        type: 'saved_sessions',
        canSaveCurrent: Boolean(this.gameState && this.viewMode === 'market'),
        slots,
      });
      this.showToast(`تم حفظ نقطة التقدم "${slot.label}" داخل التطبيق.`);
      this.render();
      return undefined;
    } catch {
      return 'تعذر حفظ الجلسة في ذاكرة التطبيق.';
    }
  }

  private handleLoadSessionSlot(slotId: string): string | undefined {
    const res = loadSavedSessionState(slotId);
    if (res.error || !res.state) {
      return res.error ?? 'تعذر تحميل الجلسة المحفوظة.';
    }
    this.moderatorVisible = false;
    this.is3DZenMode = false;
    this.closeModal();
    this.loadGameState(res.state);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.showToast(
      `تم استرجاع الجلسة "${res.slot?.label ?? res.state.config.sessionName}" عند الشهر ${res.state.currentMonthIndex + 1}.`
    );
    return undefined;
  }

  private handleDeleteSessionSlot(slotId: string) {
    const slots = deleteSavedSessionSlot(slotId);
    this.setupView.setSavedSessionsCount(slots.length);
    this.openModal({
      type: 'saved_sessions',
      canSaveCurrent: Boolean(this.gameState && this.viewMode === 'market'),
      slots,
    });
    this.showToast('تم حذف نقطة الحفظ من ذاكرة التطبيق.');
    this.render();
  }

  private handleConfirmReset(regeneratePrices: boolean) {
    if (!this.gameState) return;
    this.marketEngine.setState(this.gameState);
    const reset = this.marketEngine.resetFromBeginning({ regeneratePrices });
    this.gameState = reset;
    this.saveToStorage(reset);
    this.campScene?.updateMarketSummary(reset);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.closeModal();
    this.showToast(
      regeneratePrices
        ? 'تمت إعادة البورصة من البداية (الشهر 1) مع توليد أسعار جديدة.'
        : 'تمت إعادة البورصة من البداية (الشهر 1) بنفس خطة الأسعار.'
    );
    this.render();
  }

  private toggle3DZenFromSetup() {
    if (!this.gameState) {
      this.startNewSession(
        { ...DEFAULT_SESSION_CONFIG },
        DEFAULT_TEAM_NAMES.slice(0, 4)
      );
    }
    this.viewMode = 'market';
    this.is3DZenMode = true;
    if (this.gameState) {
      this.campScene?.updateMarketSummary(this.gameState);
      this.renderCurrentSceneOnceIfSoftwareGl();
    }
    this.render();
  }

  private handleAdvanceMonthClick() {
    if (!this.gameState) return;
    const isUnlimited = this.gameState.config.horizonMode === 'unlimited';
    const isFinalFixedMonth =
      !isUnlimited &&
      this.gameState.currentMonthIndex + 1 >= this.gameState.config.totalMonths;

    if (isFinalFixedMonth) {
      this.marketEngine.setState(this.gameState);
      const next = this.marketEngine.advanceMonth();
      this.gameState = next;
      this.saveToStorage(next);
      this.campScene?.updateMarketSummary(next);
      this.renderCurrentSceneOnceIfSoftwareGl();
      this.openModal({ type: 'championship' });
      this.render();
      return;
    }

    // Open pre-month cash funding dialog before starting the next month
    this.openModal({ type: 'team_funding', mode: 'advance_month' });
  }

  private handleConfirmFunding(
    mode: 'grant_only' | 'advance_month',
    grantsByTeamId: Record<string, number>
  ): string | undefined {
    if (!this.gameState) return 'لا توجد جلسة نشطة.';
    this.marketEngine.setState(this.gameState);

    if (mode === 'grant_only') {
      const res = this.marketEngine.grantTeamCash(grantsByTeamId);
      if (res.error) return res.error;
      this.gameState = res.state;
      this.saveToStorage(res.state);
      this.campScene?.updateMarketSummary(res.state);
      this.renderCurrentSceneOnceIfSoftwareGl();
      this.closeModal();
      this.showToast(`تمت إضافة ${res.totalGranted.toLocaleString('en-US')} ر.س إلى سيولة الفرق.`);
      this.render();
      return undefined;
    }

    // Advance month and atomically apply any granted team cash
    const totalGranted = Object.values(grantsByTeamId).reduce(
      (s, v) => s + Math.max(0, Math.round(Number(v) || 0)),
      0
    );
    const next = this.marketEngine.advanceMonth(grantsByTeamId);
    this.gameState = next;
    this.saveToStorage(next);
    this.campScene?.updateMarketSummary(next);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.closeModal();

    if (next.isFinished) {
      this.openModal({ type: 'championship' });
    } else {
      const monthLabel = next.currentMonthIndex + 1;
      const horizonTxt =
        next.config.horizonMode === 'unlimited'
          ? `الشهر ${monthLabel}`
          : `الشهر ${monthLabel} من ${next.config.totalMonths}`;
      const ev = this.marketEngine.getActiveSeasonalEvent();
      const evSuffix = ev
        ? ` · حدث موسمي: ${ev.title} (${ev.commodityName})!`
        : '';
      this.showToast(
        totalGranted > 0
          ? `تمت إضافة ${totalGranted.toLocaleString('en-US')} ر.س وبدأ ${horizonTxt}${evSuffix}`
          : `تم الانتقال إلى ${horizonTxt}${evSuffix}`
      );
      if (ev) {
        this.openModal({ type: 'seasonal_event', event: ev });
      }
    }
    this.render();
    return undefined;
  }

  private handleSaveMonthlyPlan(edits: MonthlyPlanEdit[]): string | undefined {
    if (!this.gameState) return 'لا توجد جلسة نشطة.';
    if (edits.length === 0) {
      this.closeModal();
      return undefined;
    }
    this.marketEngine.setState(this.gameState);
    const res = this.marketEngine.applyMonthlyPlanBatchOverrides(edits);
    if (res.error) return res.error;

    this.gameState = res.state;
    this.saveToStorage(res.state);
    this.campScene?.updateMarketSummary(res.state);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.closeModal();
    this.showToast(
      res.updatedCount > 0
        ? `تم تحديث ${res.updatedCount} سعراً في خطة المنتجات الشهرية.`
        : 'لم تتغير الأسعار.'
    );
    this.render();
    return undefined;
  }

  private handleExtendPlanYear() {
    if (!this.gameState) return;
    const firstId = this.gameState.market.activeCommodityIds[0];
    const currentLen = firstId ? this.gameState.market.seriesById[firstId].basePrices.length : 36;
    this.marketEngine.setState(this.gameState);
    this.gameState = this.marketEngine.ensureHorizonLength(currentLen + 12);
    this.saveToStorage(this.gameState);
    this.modalRenderer.render(this.activeModal, this.gameState);
  }

  private handleEndUnlimitedSession() {
    if (!this.gameState) return;
    this.marketEngine.setState(this.gameState);
    const ended = this.marketEngine.endSession();
    this.gameState = ended;
    this.saveToStorage(ended);
    this.campScene?.updateMarketSummary(ended);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.openModal({ type: 'championship' });
    this.render();
  }

  private handleExecuteTrade(teamId: string, orders: TradeOrderItem[]): string | undefined {
    if (!this.gameState) return 'لا توجد جلسة نشطة.';
    this.marketEngine.setState(this.gameState);
    const res = this.marketEngine.executeTrade(teamId, orders);
    if (res.error) return res.error;

    this.gameState = res.state;
    this.saveToStorage(res.state);
    this.campScene?.updateMarketSummary(res.state);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.closeModal();
    this.showToast('تم تنفيذ الصفقة وتحديث محفظة الفريق.');
    this.render();
    return undefined;
  }

  private handleBuySecretReport(
    teamId: string,
    commodityId: string
  ): { error?: string; hintText?: string } {
    if (!this.gameState) return { error: 'لا توجد جلسة نشطة.' };
    this.marketEngine.setState(this.gameState);
    const res = this.marketEngine.purchaseSecretReport(teamId, commodityId);
    if (res.error) return { error: res.error };

    this.gameState = res.state;
    this.saveToStorage(res.state);
    this.render();
    return { hintText: res.hint?.text };
  }

  private handleManualOverride(
    commodityId: string,
    newPrice: number,
    mode: 'temporary' | 'permanent'
  ): string | undefined {
    if (!this.gameState) return 'لا توجد جلسة نشطة.';
    this.marketEngine.setState(this.gameState);
    const res = this.marketEngine.applyManualPriceOverride(commodityId, newPrice, mode);
    if (res.error) return res.error;

    this.gameState = res.state;
    this.saveToStorage(res.state);
    this.campScene?.updateMarketSummary(res.state);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.closeModal();
    this.showToast('تم تطبيق تعديل السعر اليدوي بنجاح.');
    this.render();
    return undefined;
  }

  private handleToggleModeratorBar() {
    if (!this.gameState) return;
    if (this.moderatorVisible) {
      this.moderatorVisible = false;
      this.render();
      return;
    }
    if (this.gameState.config.moderatorPin) {
      this.openModal({ type: 'pin_gate' });
    } else {
      this.moderatorVisible = true;
      this.render();
    }
  }

  private handlePinAttempt(pinAttempt: string): boolean {
    if (!this.gameState) return false;
    if (pinAttempt === this.gameState.config.moderatorPin) {
      this.moderatorVisible = true;
      this.closeModal();
      this.render();
      return true;
    }
    return false;
  }

  private handleUndo() {
    if (!this.gameState) return;
    this.marketEngine.setState(this.gameState);
    const res = this.marketEngine.undo();
    if (!res.restoredLabel) return;

    this.gameState = res.state;
    this.saveToStorage(res.state);
    this.campScene?.updateMarketSummary(res.state);
    this.renderCurrentSceneOnceIfSoftwareGl();
    this.showToast(`تم التراجع عن: ${res.restoredLabel}`);
    this.render();
  }

  private exportJson() {
    if (!this.gameState) return;
    this.marketEngine.setState(this.gameState);
    const json = this.marketEngine.serialize();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (this.gameState.config.sessionName || 'burr-exchange')
      .replace(/[^\p{L}\p{N}_-]+/gu, '_');
    a.href = url;
    a.download = `${safeName}_month_${this.gameState.currentMonthIndex + 1}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('تم تنزيل ملف النسخة الاحتياطية JSON بنجاح.');
  }

  private async importJsonFile(file: File) {
    try {
      const text = await file.text();
      const res = MarketEngine.deserialize(text);
      if (res.error || !res.state) {
        this.showToast(res.error ?? 'تعذر استيراد الملف.');
        return;
      }
      this.loadGameState(res.state);
      this.showToast(`تم استعادة الجلسة "${res.state.config.sessionName}" من الشهر ${res.state.currentMonthIndex + 1}.`);
    } catch {
      this.showToast('تعذّر قراءة ملف JSON المحدد.');
    }
  }

  private openModal(modal: ModalKind) {
    if (
      !this.gameState &&
      modal.type !== 'pre_adoption_plan' &&
      modal.type !== 'saved_sessions' &&
      modal.type !== 'android_apk'
    ) {
      return;
    }
    this.activeModal = modal;
    this.modalRenderer.resetTransientState(modal, this.gameState);
    this.modalRenderer.render(this.activeModal, this.gameState);
  }

  private closeModal() {
    this.activeModal = { type: 'none' };
    this.modalRenderer.render(this.activeModal, this.gameState);
  }

  private showToast(msg: string) {
    this.toastMessage = msg;
    if (this.toastTimeout !== null) clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => {
      this.toastMessage = null;
      this.render();
    }, 4000);
  }

  private saveToStorage(state: GameState) {
    try {
      this.marketEngine.setState(state);
      localStorage.setItem(STORAGE_KEY, this.marketEngine.serialize());
    } catch {
      // Ignore quota errors gracefully
    }
  }

  private loadFromStorage(): GameState | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const res = MarketEngine.deserialize(raw);
      return res.state ?? null;
    } catch {
      return null;
    }
  }

  private renderCurrentSceneOnceIfSoftwareGl() {
    if (detectSoftwareWebGL() && xb.core?.stepFrame) {
      xb.core.stepFrame(16);
    }
  }

  private render() {
    document.body.classList.toggle('zen-3d', this.is3DZenMode);
    if (this.viewMode === 'setup' || !this.gameState) {
      document.body.dataset.state = 'setup';
      this.setupView.render();
    } else {
      document.body.dataset.state = this.gameState.isFinished ? 'finished' : 'playing';
      this.workspace.render(
        this.gameState,
        this.moderatorVisible,
        this.is3DZenMode,
        this.toastMessage
      );
    }
    if (this.activeModal.type !== 'none') {
      this.modalRenderer.render(this.activeModal, this.gameState);
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const root = document.getElementById('root');
  if (root) {
    new BurrExchangeApp(root);
  }
});
