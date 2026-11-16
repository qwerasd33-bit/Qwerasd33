import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import {
  InstallEnvironmentState,
  detectInstallEnvironment,
} from './pwaEnvironment';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type StateListener = (state: InstallEnvironmentState) => void;

class PwaInstallService {
  private deferredPrompt: BeforeInstallPromptEvent | null = null;
  private listeners = new Set<StateListener>();
  private initialized = false;

  public init() {
    if (this.initialized || typeof window === 'undefined') return;
    this.initialized = true;

    try {
      registerSW({
        immediate: true,
        onOfflineReady() {
          // App shell cached for offline session play
        },
      });
    } catch {
      // Ignore if running in environments where SW registration is blocked
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      this.notify();
    });

    window.addEventListener('appinstalled', () => {
      this.deferredPrompt = null;
      this.notify();
    });

    window.addEventListener('online', () => this.notify());
    window.addEventListener('offline', () => this.notify());

    const mediaQuery = window.matchMedia?.('(display-mode: standalone)');
    mediaQuery?.addEventListener?.('change', () => this.notify());
  }

  public getState(): InstallEnvironmentState {
    if (typeof window === 'undefined') {
      return {
        runtimeMode: 'browser',
        isInstalled: false,
        canPromptInstall: false,
        isAndroid: false,
        isIOS: false,
        isOnline: true,
      };
    }

    const isStandaloneDisplay =
      window.matchMedia?.('(display-mode: standalone)')?.matches ?? false;
    const navigatorStandalone = (
      window.navigator as unknown as { standalone?: boolean }
    ).standalone;

    let isCapacitorNative = false;
    try {
      isCapacitorNative = Capacitor.isNativePlatform();
    } catch {
      isCapacitorNative = false;
    }

    return detectInstallEnvironment({
      userAgent: window.navigator.userAgent ?? '',
      isStandaloneDisplay,
      navigatorStandalone,
      isCapacitorNative,
      hasDeferredPrompt: Boolean(this.deferredPrompt),
      isOnline: window.navigator.onLine ?? true,
    });
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferredPrompt) return 'unavailable';
    await this.deferredPrompt.prompt();
    const { outcome } = await this.deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      this.deferredPrompt = null;
    }
    this.notify();
    return outcome;
  }

  private notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const pwaInstallService = new PwaInstallService();
