import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAndroidApkPlan, detectInstallEnvironment } from './pwaEnvironment';

test('detectInstallEnvironment identifies Android browser with deferred install prompt', () => {
  const env = detectInstallEnvironment({
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36',
    isStandaloneDisplay: false,
    hasDeferredPrompt: true,
    isOnline: true,
  });

  assert.equal(env.runtimeMode, 'browser');
  assert.equal(env.isInstalled, false);
  assert.equal(env.canPromptInstall, true);
  assert.equal(env.isAndroid, true);
  assert.equal(env.isIOS, false);
  assert.equal(env.isOnline, true);
});

test('detectInstallEnvironment identifies iOS Safari and disables native prompt', () => {
  const env = detectInstallEnvironment({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1',
    isStandaloneDisplay: false,
    navigatorStandalone: false,
    hasDeferredPrompt: false,
    isOnline: true,
  });

  assert.equal(env.runtimeMode, 'browser');
  assert.equal(env.isIOS, true);
  assert.equal(env.isAndroid, false);
  assert.equal(env.canPromptInstall, false);
});

test('detectInstallEnvironment suppresses install prompt when already standalone or inside Capacitor APK', () => {
  const standaloneEnv = detectInstallEnvironment({
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    isStandaloneDisplay: true,
    hasDeferredPrompt: true,
    isOnline: false,
  });
  assert.equal(standaloneEnv.runtimeMode, 'standalone_pwa');
  assert.equal(standaloneEnv.isInstalled, true);
  assert.equal(standaloneEnv.canPromptInstall, false);
  assert.equal(standaloneEnv.isOnline, false);

  const apkEnv = detectInstallEnvironment({
    userAgent: 'Mozilla/5.0 (Linux; Android 14)',
    isStandaloneDisplay: false,
    isCapacitorNative: true,
    hasDeferredPrompt: false,
    isOnline: true,
  });
  assert.equal(apkEnv.runtimeMode, 'capacitor_native');
  assert.equal(apkEnv.isInstalled, true);
});

test('buildAndroidApkPlan exposes valid Capacitor package id, short name <= 12 chars, and APK output path', () => {
  const plan = buildAndroidApkPlan();
  assert.equal(plan.appId, 'com.burrexchange.app');
  assert.ok(plan.shortName.length <= 12);
  assert.equal(plan.webDir, 'dist');
  assert.ok(plan.apkOutputPath.endsWith('app-debug.apk'));
  assert.ok(plan.commands.some((cmd) => cmd.includes('assembleDebug')));
});
