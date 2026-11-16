export type RuntimeAppMode = 'capacitor_native' | 'standalone_pwa' | 'browser';

export interface InstallEnvironmentInput {
  userAgent: string;
  isStandaloneDisplay: boolean;
  navigatorStandalone?: boolean;
  isCapacitorNative?: boolean;
  hasDeferredPrompt: boolean;
  isOnline: boolean;
}

export interface InstallEnvironmentState {
  runtimeMode: RuntimeAppMode;
  isInstalled: boolean;
  canPromptInstall: boolean;
  isAndroid: boolean;
  isIOS: boolean;
  isOnline: boolean;
}

export interface AndroidApkBuildPlan {
  appId: string;
  appName: string;
  shortName: string;
  webDir: string;
  apkOutputPath: string;
  commands: string[];
  workflowPath: string;
}

export function detectInstallEnvironment(
  input: InstallEnvironmentInput
): InstallEnvironmentState {
  const ua = (input.userAgent || '').toLowerCase();
  const isAndroid = /android/.test(ua);
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isCapacitorNative = Boolean(input.isCapacitorNative);
  const isStandalone =
    isCapacitorNative ||
    input.isStandaloneDisplay ||
    input.navigatorStandalone === true;

  const runtimeMode: RuntimeAppMode = isCapacitorNative
    ? 'capacitor_native'
    : isStandalone
      ? 'standalone_pwa'
      : 'browser';

  return {
    runtimeMode,
    isInstalled: isStandalone,
    canPromptInstall: !isStandalone && input.hasDeferredPrompt,
    isAndroid,
    isIOS,
    isOnline: input.isOnline,
  };
}

export function buildAndroidApkPlan(
  appId = 'com.burrexchange.app',
  appName = 'بورصة البر والفعاليات'
): AndroidApkBuildPlan {
  return {
    appId,
    appName,
    shortName: 'بورصة البر',
    webDir: 'dist',
    apkOutputPath: 'android/app/build/outputs/apk/debug/app-debug.apk',
    workflowPath: '.github/workflows/build-android-apk.yml',
    commands: [
      'npm install',
      'npm run build',
      'npx cap sync android',
      'cd android && ./gradlew assembleDebug',
    ],
  };
}
