import { SAVED_SESSIONS_STORAGE_KEY } from '../constants';
import { GameState, SavedSessionSlot } from '../types';
import {
  deserializeGameState,
  getDualCalendarForMonth,
  getLeaderboard,
  serializeGameState,
} from './MarketEngine';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const memoryFallbackMap = new Map<string, string>();
const memoryFallbackStorage: StorageLike = {
  getItem: (key) => memoryFallbackMap.get(key) ?? null,
  setItem: (key, value) => {
    memoryFallbackMap.set(key, value);
  },
  removeItem: (key) => {
    memoryFallbackMap.delete(key);
  },
};

function getStorage(customStorage?: StorageLike): StorageLike {
  if (customStorage) return customStorage;
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch {
    // Ignore security/sandbox access errors and use memory fallback
  }
  return memoryFallbackStorage;
}

function writeSlots(slots: SavedSessionSlot[], customStorage?: StorageLike): void {
  const storage = getStorage(customStorage);
  storage.setItem(SAVED_SESSIONS_STORAGE_KEY, JSON.stringify(slots));
}

export function listSavedSessions(customStorage?: StorageLike): SavedSessionSlot[] {
  try {
    const raw = getStorage(customStorage).getItem(SAVED_SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedSessionSlot[])
      .filter((s) => s && typeof s.id === 'string' && typeof s.stateJson === 'string')
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export function saveSessionSlot(
  state: GameState,
  customLabel?: string,
  overwriteId?: string,
  customStorage?: StorageLike
): SavedSessionSlot {
  const slots = listSavedSessions(customStorage);
  const dual = getDualCalendarForMonth(state.config, state.currentMonthIndex);
  const leaderboard = getLeaderboard(state);
  const monthNumber = state.currentMonthIndex + 1;
  const sessionName = state.config.sessionName?.trim() || 'جلسة بدون اسم';
  const cleanedLabel = customLabel?.trim();
  const existing = overwriteId ? slots.find((s) => s.id === overwriteId) : undefined;
  const label =
    cleanedLabel ||
    existing?.label ||
    `${sessionName} — ش${monthNumber} (${dual.hijriMonthName})`;

  const slot: SavedSessionSlot = {
    id: existing?.id ?? `slot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label,
    savedAt: Date.now(),
    sessionName,
    monthNumber,
    gregorianLabel: dual.gregorianLabel,
    hijriLabel: dual.hijriLabel,
    teamCount: state.teams.length,
    leaderName: leaderboard[0]?.team.name ?? '',
    stateJson: serializeGameState(state),
  };

  const nextSlots = [slot, ...slots.filter((s) => s.id !== slot.id)].slice(0, 25);
  writeSlots(nextSlots, customStorage);
  return slot;
}

export function loadSavedSessionState(
  slotId: string,
  customStorage?: StorageLike
): { state?: GameState; slot?: SavedSessionSlot; error?: string } {
  const slots = listSavedSessions(customStorage);
  const slot = slots.find((s) => s.id === slotId);
  if (!slot) {
    return { error: 'لم يتم العثور على الجلسة المحفوظة المطلوبة.' };
  }
  const parsed = deserializeGameState(slot.stateJson);
  if (parsed.error || !parsed.state) {
    return { error: parsed.error ?? 'تعذّر استرجاع بيانات الجلسة المحفوظة.' };
  }
  return { state: parsed.state, slot };
}

export function deleteSavedSessionSlot(slotId: string, customStorage?: StorageLike): SavedSessionSlot[] {
  const next = listSavedSessions(customStorage).filter((s) => s.id !== slotId);
  writeSlots(next, customStorage);
  return next;
}

export function clearAllSavedSessions(customStorage?: StorageLike): void {
  getStorage(customStorage).removeItem(SAVED_SESSIONS_STORAGE_KEY);
}
