import {
  COMMODITIES_CATALOG,
  CORRELATION_LABELS,
  DEFAULT_SESSION_CONFIG,
  DEFAULT_TEAM_NAMES,
  GREGORIAN_MONTH_NAMES,
  HIJRI_MONTH_EFFECTS,
  HIJRI_MONTH_NAMES,
  NUMERIC_RULE_LABELS,
  SEASONAL_EVENT_TEMPLATES,
  SEASONAL_PEAK_LABELS,
  TOTAL_MONTHS,
  buildDefaultCustomMonthlyPrices,
  buildDefaultProductPatternConfigs,
} from '../constants';
import {
  ActivePatternsConfig,
  CommodityMarketSeries,
  CommoditySpec,
  DualCalendarInfo,
  GameSnapshot,
  GameState,
  HijriCommodityImpact,
  HorizonMode,
  MarketState,
  PatternFamily,
  ProductPatternConfig,
  SeasonalEventDirection,
  SeasonalEventRecord,
  SeasonalPeak,
  SecretHintRecord,
  SessionConfig,
  TeamLeaderboardEntry,
  TeamState,
  TradeLogEntry,
  TradeOrderItem,
} from '../types';

const MAX_UNDO_SNAPSHOTS = 60;

export function createSeededRng(seed: number): () => number {
  let s = (seed >>> 0) || 123456789;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function clampPrice(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function isPrimeMonth(monthNumber1Based: number): boolean {
  if (monthNumber1Based < 2) return false;
  for (let d = 2; d * d <= monthNumber1Based; d++) {
    if (monthNumber1Based % d === 0) return false;
  }
  return true;
}

function seasonalPeakToMonthOffset(peak: SeasonalPeak = 'winter'): number {
  switch (peak) {
    case 'winter':
      return 0;
    case 'spring':
      return 3;
    case 'summer':
      return 6;
    case 'autumn':
      return 9;
    case 'custom':
      return 0;
  }
}

function sanitizeCustomMonthlyPrices(
  rawPrices: number[] | undefined,
  basePrice: number
): number[] {
  const fallback = buildDefaultCustomMonthlyPrices(basePrice);
  if (!Array.isArray(rawPrices)) return fallback;
  return Array.from({ length: 12 }, (_, idx) => {
    const v = Number(rawPrices[idx]);
    return Number.isFinite(v) && v >= 1 ? Math.round(v) : fallback[idx];
  });
}

function sanitizeCustomPlanOverrides(
  raw?: Record<string, Record<number, number>>
): Record<string, Record<number, number>> {
  const clean: Record<string, Record<number, number>> = {};
  if (!raw || typeof raw !== 'object') return clean;
  for (const [cid, monthMap] of Object.entries(raw)) {
    if (!monthMap || typeof monthMap !== 'object') continue;
    const perMonth: Record<number, number> = {};
    for (const [mKey, priceVal] of Object.entries(monthMap)) {
      const mIdx = Number(mKey);
      const val = Number(priceVal);
      if (Number.isInteger(mIdx) && mIdx >= 0 && Number.isFinite(val) && val >= 1) {
        perMonth[mIdx] = Math.round(val);
      }
    }
    if (Object.keys(perMonth).length > 0) {
      clean[cid] = perMonth;
    }
  }
  return clean;
}

export function anchorHijriStart(
  startYear: number,
  startMonth: number
): { hijriYear: number; hijriMonth: number } {
  const safeYear = Math.max(2020, Math.min(2045, Math.round(startYear || 2026)));
  const safeMonth = Math.max(1, Math.min(12, Math.round(startMonth || 11)));
  try {
    const dt = new Date(Date.UTC(safeYear, safeMonth - 1, 15));
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const parts = fmt.formatToParts(dt);
    const yearStr = parts.find((p) => p.type === 'year')?.value ?? '';
    const monthStr = parts.find((p) => p.type === 'month')?.value ?? '';
    const hYear = parseInt(yearStr.replace(/\D+/g, ''), 10);
    const hMonth = parseInt(monthStr.replace(/\D+/g, ''), 10);
    if (
      Number.isFinite(hYear) &&
      hYear > 1300 &&
      Number.isFinite(hMonth) &&
      hMonth >= 1 &&
      hMonth <= 12
    ) {
      return { hijriYear: hYear, hijriMonth: hMonth };
    }
  } catch {
    // Fallback below if ICU Islamic calendar is unavailable
  }
  const approxHijriTotalMonths = Math.round(((safeYear + (safeMonth - 1) / 12 - 621.5643) * 365.2425) / 29.530588);
  const hijriYear = Math.max(1400, Math.floor(approxHijriTotalMonths / 12) + 1);
  const hijriMonth = ((approxHijriTotalMonths % 12) + 12) % 12 + 1;
  return { hijriYear, hijriMonth };
}

export function getDualCalendarForMonth(
  source: Partial<
    Pick<
      SessionConfig,
      'startYear' | 'startMonth' | 'startHijriYear' | 'startHijriMonth'
    >
  >,
  monthIndex: number
): DualCalendarInfo {
  const safeIdx = Math.max(0, Math.floor(monthIndex));
  const baseGYear = source.startYear ?? DEFAULT_SESSION_CONFIG.startYear;
  const baseGMonth = source.startMonth ?? DEFAULT_SESSION_CONFIG.startMonth;
  const anchored =
    typeof source.startHijriYear === 'number' && typeof source.startHijriMonth === 'number'
      ? { hijriYear: source.startHijriYear, hijriMonth: source.startHijriMonth }
      : anchorHijriStart(baseGYear, baseGMonth);

  const totalGMonths = baseGYear * 12 + (baseGMonth - 1) + safeIdx;
  const gregorianYear = Math.floor(totalGMonths / 12);
  const gregorianMonth = (totalGMonths % 12) + 1;
  const gregorianMonthName = GREGORIAN_MONTH_NAMES[gregorianMonth - 1] ?? 'يناير';
  const gregorianLabel = `${gregorianMonthName} ${gregorianYear}`;

  const totalHMonths = anchored.hijriYear * 12 + (anchored.hijriMonth - 1) + safeIdx;
  const hijriYear = Math.floor(totalHMonths / 12);
  const hijriMonth = (totalHMonths % 12) + 1;
  const hijriMonthName = HIJRI_MONTH_NAMES[hijriMonth - 1] ?? 'محرم';
  const hijriLabel = `${hijriMonthName} ${hijriYear} هـ`;

  return {
    monthIndex: safeIdx,
    gregorianMonth,
    gregorianYear,
    gregorianMonthName,
    gregorianLabel,
    hijriMonth,
    hijriYear,
    hijriMonthName,
    hijriLabel,
    shortLabel: `${gregorianLabel} · ${hijriLabel}`,
  };
}

export function sanitizeConfig(partial?: Partial<SessionConfig>): SessionConfig {
  const defaultPatterns = buildDefaultProductPatternConfigs();
  const mergedProductConfigs: Record<string, ProductPatternConfig> = { ...defaultPatterns };
  if (partial?.productPatternConfigs) {
    for (const [cid, cfg] of Object.entries(partial.productPatternConfigs)) {
      if (cfg && cfg.pattern) {
        const spec = getCommoditySpec(cid);
        const basePrice = spec?.basePrice ?? 100;
        mergedProductConfigs[cid] = {
          ...defaultPatterns[cid],
          ...cfg,
          customMonthlyPrices: sanitizeCustomMonthlyPrices(
            cfg.customMonthlyPrices ?? defaultPatterns[cid]?.customMonthlyPrices,
            basePrice
          ),
        };
      }
    }
  }

  const horizonMode: HorizonMode =
    partial?.horizonMode === 'unlimited' ? 'unlimited' : '36_months';

  const startYear = Math.max(
    2020,
    Math.min(2040, Math.round(Number(partial?.startYear ?? DEFAULT_SESSION_CONFIG.startYear)))
  );
  const startMonth = Math.max(
    1,
    Math.min(12, Math.round(Number(partial?.startMonth ?? DEFAULT_SESSION_CONFIG.startMonth)))
  );
  const anchoredHijri = anchorHijriStart(startYear, startMonth);

  const merged: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...partial,
    horizonMode,
    startYear,
    startMonth,
    startHijriYear: anchoredHijri.hijriYear,
    startHijriMonth: anchoredHijri.hijriMonth,
    hijriEffectsEnabled: partial?.hijriEffectsEnabled !== false,
    activePatterns: {
      ...DEFAULT_SESSION_CONFIG.activePatterns,
      ...(partial?.activePatterns ?? {}),
    },
    productPatternConfigs: mergedProductConfigs,
    customPlanOverrides: sanitizeCustomPlanOverrides(partial?.customPlanOverrides),
  };

  merged.productCount = Math.max(
    4,
    Math.min(COMMODITIES_CATALOG.length, Math.round(merged.productCount))
  );
  merged.volatilityMultiplier = Math.max(
    0.5,
    Math.min(2.0, Math.round(merged.volatilityMultiplier * 100) / 100)
  );
  merged.seasonalEventsEnabled = partial?.seasonalEventsEnabled !== false;
  const rawImpact = Number(partial?.seasonalEventImpactPct ?? DEFAULT_SESSION_CONFIG.seasonalEventImpactPct);
  merged.seasonalEventImpactPct = Number.isFinite(rawImpact)
    ? Math.max(0.1, Math.min(0.7, Math.round(rawImpact * 100) / 100))
    : DEFAULT_SESSION_CONFIG.seasonalEventImpactPct;
  merged.startingCash = Math.max(500, Math.round(merged.startingCash));
  merged.secretReportCost = Math.max(0, Math.round(merged.secretReportCost));
  merged.supplyDemandThreshold = Math.max(1, Math.round(merged.supplyDemandThreshold));
  merged.totalMonths = TOTAL_MONTHS;
  return merged;
}

export function getCommoditySpec(commodityId: string): CommoditySpec | undefined {
  return COMMODITIES_CATALOG.find((c) => c.id === commodityId);
}

/**
 * Selects `productCount` active commodities and maps each product to one of the 3
 * pricing algorithm patterns (Seasonal, Mathematical/Prime-based, Correlation-based)
 * or 'neutral' if globally disabled.
 */
export function selectActiveCommodities(
  productCount: number,
  activePatterns: ActivePatternsConfig,
  productPatternConfigs?: Record<string, ProductPatternConfig>
): Array<{
  spec: CommoditySpec;
  effectivePattern: PatternFamily;
  appliedConfig: ProductPatternConfig;
}> {
  const count = Math.max(4, Math.min(COMMODITIES_CATALOG.length, Math.round(productCount)));
  const selectedSpecs = COMMODITIES_CATALOG.slice(0, count);
  const selectedIds = new Set(selectedSpecs.map((s) => s.id));

  return selectedSpecs.map((spec) => {
    const rawCfg = productPatternConfigs?.[spec.id] ?? spec.defaultPatternConfig;
    const appliedConfig: ProductPatternConfig = {
      pattern: rawCfg.pattern,
      seasonalPeak: rawCfg.seasonalPeak ?? spec.defaultPatternConfig.seasonalPeak ?? 'winter',
      customMonthlyPrices: sanitizeCustomMonthlyPrices(
        rawCfg.customMonthlyPrices ?? spec.defaultPatternConfig.customMonthlyPrices,
        spec.basePrice
      ),
      numericRule: rawCfg.numericRule ?? spec.defaultPatternConfig.numericRule ?? 'even_up_odd_down',
      linkedCommodityId:
        rawCfg.linkedCommodityId ?? spec.defaultPatternConfig.linkedCommodityId,
      correlationDirection:
        rawCfg.correlationDirection ??
        spec.defaultPatternConfig.correlationDirection ??
        'direct',
      lagMonths: rawCfg.lagMonths ?? spec.defaultPatternConfig.lagMonths ?? 0,
    };

    let effective: PatternFamily = appliedConfig.pattern;

    if (!activePatterns[appliedConfig.pattern]) {
      effective = 'neutral';
    } else if (effective === 'linked_commodity') {
      const targetId = appliedConfig.linkedCommodityId;
      if (!targetId || targetId === spec.id || !selectedIds.has(targetId)) {
        const fallbackTarget = selectedSpecs.find((other) => other.id !== spec.id);
        if (fallbackTarget) {
          appliedConfig.linkedCommodityId = fallbackTarget.id;
        } else {
          effective = activePatterns.seasonal_monthly ? 'seasonal_monthly' : 'neutral';
        }
      }
    }

    return { spec, effectivePattern: effective, appliedConfig };
  });
}

function computePrimaryPriceAtMonth(
  spec: CommoditySpec,
  effectivePattern: PatternFamily,
  appliedConfig: ProductPatternConfig,
  monthIndex: number,
  volatility: number,
  rng: () => number,
  planOverride?: number
): number {
  const noise = (rng() - 0.5) * spec.basePrice * 0.03 * volatility;
  if (typeof planOverride === 'number' && Number.isFinite(planOverride) && planOverride >= 1) {
    return Math.max(1, Math.round(planOverride));
  }

  const amp = spec.basePrice * spec.amplitudeRatio * volatility;
  const monthNum = monthIndex + 1;
  let raw = spec.basePrice;

  switch (effectivePattern) {
    case 'seasonal_monthly': {
      if (appliedConfig.seasonalPeak === 'custom') {
        const customArr = sanitizeCustomMonthlyPrices(
          appliedConfig.customMonthlyPrices,
          spec.basePrice
        );
        return Math.max(1, Math.round(customArr[monthIndex % 12]));
      }
      const peakOffset = seasonalPeakToMonthOffset(appliedConfig.seasonalPeak);
      const angle = (2 * Math.PI * (monthIndex - peakOffset)) / 12;
      raw = spec.basePrice + Math.cos(angle) * amp + noise;
      break;
    }
    case 'numeric_month_rule': {
      const rule = appliedConfig.numericRule ?? 'even_up_odd_down';
      switch (rule) {
        case 'even_up_odd_down': {
          const isEven = monthNum % 2 === 0;
          raw = spec.basePrice + (isEven ? amp * 0.85 : -amp * 0.75) + noise * 0.6;
          break;
        }
        case 'odd_up_even_down': {
          const isOdd = monthNum % 2 === 1;
          raw = spec.basePrice + (isOdd ? amp * 0.85 : -amp * 0.75) + noise * 0.6;
          break;
        }
        case 'multiples_of_3': {
          const isMult3 = monthNum % 3 === 0;
          const modOffset = ((monthNum % 3) - 1.5) * 0.14 * amp;
          raw = spec.basePrice + (isMult3 ? amp * 1.1 : -amp * 0.48 + modOffset) + noise * 0.5;
          break;
        }
        case 'multiples_of_4': {
          const isMult4 = monthNum % 4 === 0;
          const modOffset = ((monthNum % 4) - 1.5) * 0.12 * amp;
          raw = spec.basePrice + (isMult4 ? amp * 1.15 : -amp * 0.48 + modOffset) + noise * 0.5;
          break;
        }
        case 'prime_months': {
          const prime = isPrimeMonth(monthNum);
          raw = spec.basePrice + (prime ? amp * 1.15 : -amp * 0.45) + noise * 0.5;
          break;
        }
      }
      break;
    }
    case 'neutral':
    case 'linked_commodity': {
      raw =
        spec.basePrice +
        Math.sin((monthIndex + 1) * 0.72) * (spec.basePrice * 0.12 * volatility) +
        noise;
      break;
    }
  }

  return clampPrice(raw, spec.minPrice, spec.maxPrice);
}

function generatePrimarySeriesBase(
  spec: CommoditySpec,
  effectivePattern: PatternFamily,
  appliedConfig: ProductPatternConfig,
  startMonth: number,
  endMonthExclusive: number,
  volatility: number,
  rng: () => number,
  planOverridesForCommodity?: Record<number, number>
): number[] {
  const prices: number[] = [];
  for (let m = startMonth; m < endMonthExclusive; m++) {
    prices.push(
      computePrimaryPriceAtMonth(
        spec,
        effectivePattern,
        appliedConfig,
        m,
        volatility,
        rng,
        planOverridesForCommodity?.[m]
      )
    );
  }
  return prices;
}

function computeLinkedPriceAtMonth(
  spec: CommoditySpec,
  appliedConfig: ProductPatternConfig,
  leaderPrices: number[],
  leaderSpec: CommoditySpec,
  monthIndex: number,
  volatility: number,
  rng: () => number,
  planOverride?: number
): number {
  const microNoise = (rng() - 0.5) * spec.basePrice * 0.015 * volatility;
  if (typeof planOverride === 'number' && Number.isFinite(planOverride) && planOverride >= 1) {
    return Math.max(1, Math.round(planOverride));
  }
  const lag = appliedConfig.lagMonths ?? 0;
  const sign = appliedConfig.correlationDirection === 'inverse' ? -1 : 1;
  const leaderAmpRatio = Math.max(0.15, leaderSpec.amplitudeRatio);
  const refIndex = Math.max(0, Math.min(leaderPrices.length - 1, monthIndex - lag));
  const leaderDeltaRatio = (leaderPrices[refIndex] - leaderSpec.basePrice) / leaderSpec.basePrice;
  const scaledRatio = leaderDeltaRatio * (spec.amplitudeRatio / leaderAmpRatio) * sign;
  const target = spec.basePrice * (1 + scaledRatio) + microNoise;
  return clampPrice(target, spec.minPrice, spec.maxPrice);
}

export function generateMarketState(config: SessionConfig): MarketState {
  const rng = createSeededRng(config.seed);
  const active = selectActiveCommodities(
    config.productCount,
    config.activePatterns,
    config.productPatternConfigs
  );
  const seriesById: Record<string, CommodityMarketSeries> = {};
  const totalMonths = config.totalMonths || TOTAL_MONTHS;
  const overrides = config.customPlanOverrides ?? {};

  const pendingLinked: Array<{
    spec: CommoditySpec;
    effectivePattern: PatternFamily;
    appliedConfig: ProductPatternConfig;
  }> = [];

  for (const item of active) {
    if (item.effectivePattern === 'linked_commodity') {
      pendingLinked.push(item);
      continue;
    }
    const basePrices = generatePrimarySeriesBase(
      item.spec,
      item.effectivePattern,
      item.appliedConfig,
      0,
      totalMonths,
      config.volatilityMultiplier,
      rng,
      overrides[item.spec.id]
    );
    seriesById[item.spec.id] = {
      commodityId: item.spec.id,
      effectivePattern: item.effectivePattern,
      appliedPatternConfig: item.appliedConfig,
      basePrices,
      permanentOffsets: new Array(totalMonths).fill(0),
      supplyDemandMargins: new Array(totalMonths).fill(0),
      tempOverrides: {},
    };
  }

  let remaining = [...pendingLinked];
  for (let pass = 0; pass <= pendingLinked.length && remaining.length > 0; pass++) {
    const nextRemaining: typeof remaining = [];
    let resolvedAny = false;

    for (const item of remaining) {
      const leaderId = item.appliedConfig.linkedCommodityId;
      if (leaderId && seriesById[leaderId]) {
        const leaderSpec = getCommoditySpec(leaderId)!;
        const leaderPrices = seriesById[leaderId].basePrices;
        const basePrices: number[] = [];
        for (let m = 0; m < totalMonths; m++) {
          basePrices.push(
            computeLinkedPriceAtMonth(
              item.spec,
              item.appliedConfig,
              leaderPrices,
              leaderSpec,
              m,
              config.volatilityMultiplier,
              rng,
              overrides[item.spec.id]?.[m]
            )
          );
        }
        seriesById[item.spec.id] = {
          commodityId: item.spec.id,
          effectivePattern: 'linked_commodity',
          appliedPatternConfig: item.appliedConfig,
          basePrices,
          permanentOffsets: new Array(totalMonths).fill(0),
          supplyDemandMargins: new Array(totalMonths).fill(0),
          tempOverrides: {},
        };
        resolvedAny = true;
      } else {
        nextRemaining.push(item);
      }
    }

    remaining = nextRemaining;

    if (!resolvedAny && remaining.length > 0) {
      const cycleBreaker = remaining.shift()!;
      const fallbackCfg: ProductPatternConfig = {
        pattern: 'seasonal_monthly',
        seasonalPeak: 'winter',
      };
      const basePrices = generatePrimarySeriesBase(
        cycleBreaker.spec,
        'seasonal_monthly',
        fallbackCfg,
        0,
        totalMonths,
        config.volatilityMultiplier,
        rng,
        overrides[cycleBreaker.spec.id]
      );
      seriesById[cycleBreaker.spec.id] = {
        commodityId: cycleBreaker.spec.id,
        effectivePattern: 'seasonal_monthly',
        appliedPatternConfig: fallbackCfg,
        basePrices,
        permanentOffsets: new Array(totalMonths).fill(0),
        supplyDemandMargins: new Array(totalMonths).fill(0),
        tempOverrides: {},
      };
    }
  }

  const activeCommodityIds = active.map((a) => a.spec.id);
  const currentMonthNetVolume: Record<string, number> = {};
  const lastMonthDemandImpact: Record<string, number> = {};
  for (const id of activeCommodityIds) {
    currentMonthNetVolume[id] = 0;
    lastMonthDemandImpact[id] = 0;
  }

  const seasonalEvents = generateSeasonalEventsForRange(
    seriesById,
    activeCommodityIds,
    config,
    0,
    totalMonths,
    {}
  );

  return {
    activeCommodityIds,
    seriesById,
    currentMonthNetVolume,
    lastMonthDemandImpact,
    seasonalEvents,
    hijriEffectsEnabled: config.hijriEffectsEnabled,
    startYear: config.startYear,
    startMonth: config.startMonth,
    startHijriYear: config.startHijriYear,
    startHijriMonth: config.startHijriMonth,
  };
}

/**
 * Generates deterministic Seasonal Events every 3 months (Month 3, 6, 9, 12, ...),
 * targeting strictly ONE active commodity per event with either an up or down price shock.
 */
function generateSeasonalEventsForRange(
  seriesById: Record<string, CommodityMarketSeries>,
  activeCommodityIds: string[],
  config: SessionConfig,
  startMonth: number,
  endMonthExclusive: number,
  existingEvents: Record<number, SeasonalEventRecord>
): Record<number, SeasonalEventRecord> {
  const result: Record<number, SeasonalEventRecord> = { ...existingEvents };
  if (!config.seasonalEventsEnabled || activeCommodityIds.length === 0) {
    return result;
  }

  const impactPct = Math.max(
    0.1,
    Math.min(0.7, config.seasonalEventImpactPct || DEFAULT_SESSION_CONFIG.seasonalEventImpactPct)
  );

  for (let m = Math.max(0, startMonth); m < endMonthExclusive; m++) {
    // Trigger strictly every 3 months: Month 3 (idx 2), Month 6 (idx 5), Month 9 (idx 8), ...
    if ((m + 1) % 3 !== 0) continue;
    if (result[m]) continue;

    const quarterSeed = ((config.seed ^ ((m + 1) * 7919 + 131)) >>> 0) || 987654321;
    const qRng = createSeededRng(quarterSeed);

    const prevEventCommodityId = result[m - 3]?.commodityId;
    const candidates =
      activeCommodityIds.length > 1 && prevEventCommodityId
        ? activeCommodityIds.filter((id) => id !== prevEventCommodityId)
        : activeCommodityIds;

    let commodityId: string;
    let direction: SeasonalEventDirection;

    // Showcase the flagship realistic scenarios on the default session seed
    if (
      config.seed === DEFAULT_SESSION_CONFIG.seed &&
      m === 2 &&
      activeCommodityIds.includes('livestock')
    ) {
      commodityId = 'livestock';
      direction = 'down';
    } else if (
      config.seed === DEFAULT_SESSION_CONFIG.seed &&
      m === 5 &&
      activeCommodityIds.includes('gasoline')
    ) {
      commodityId = 'gasoline';
      direction = 'up';
    } else {
      const pickedIdx = Math.floor(qRng() * candidates.length) % candidates.length;
      commodityId = candidates[pickedIdx];
      direction = qRng() >= 0.5 ? 'up' : 'down';
    }

    const spec = getCommoditySpec(commodityId);
    const commodityName = spec?.name ?? commodityId;
    const basePrice = seriesById[commodityId]?.basePrices[m] ?? spec?.basePrice ?? 100;

    if (basePrice <= 2) {
      direction = 'up';
    }

    const rawDelta = Math.max(1, Math.round(basePrice * impactPct));
    const priceDelta =
      direction === 'up' ? rawDelta : -Math.min(Math.max(1, basePrice - 1), rawDelta);

    const template = SEASONAL_EVENT_TEMPLATES[commodityId]?.[direction] ?? {
      title:
        direction === 'up'
          ? `طفرة طلب موسمية على ${commodityName}`
          : `فائض عرض موسمي في ${commodityName}`,
      reason:
        direction === 'up'
          ? `أزمة توريد وتدافع المشترين رفعت الطلب بشكل مفاجئ على ${commodityName}.`
          : `تراجع الإقبال مع وفرة المعروض في الأسواق خفضت سعر ${commodityName}.`,
      description:
        direction === 'up'
          ? `موجة طلب استثنائية تدفع سعر ${commodityName} للارتفاع هذا الشهر.`
          : `وفرة مفاجئة في المعروض تخفض سعر ${commodityName} هذا الشهر.`,
    };

    result[m] = {
      monthIndex: m,
      commodityId,
      commodityName,
      direction,
      impactPct,
      priceDelta,
      title: template.title,
      reason: template.reason,
      description: template.description,
    };
  }

  return result;
}

/**
 * Dynamically extends generated price series in 12-month increments when running in 'unlimited' horizon mode.
 */
export function extendMarketHorizonIfNeeded(
  market: MarketState,
  config: SessionConfig,
  requiredLength: number
): MarketState {
  const firstId = market.activeCommodityIds[0];
  if (!firstId) return market;
  const currentLength = market.seriesById[firstId]?.basePrices.length ?? 0;
  if (requiredLength <= currentLength) return market;

  const targetLength = Math.max(
    requiredLength,
    Math.ceil(requiredLength / 12) * 12
  );
  const nextSeriesById = deepClone(market.seriesById);
  const rng = createSeededRng((config.seed ^ (currentLength * 2654435761)) >>> 0);
  const overrides = config.customPlanOverrides ?? {};

  const primaryIds: string[] = [];
  const linkedIds: string[] = [];
  for (const cid of market.activeCommodityIds) {
    const s = nextSeriesById[cid];
    if (!s) continue;
    if (s.effectivePattern === 'linked_commodity') {
      linkedIds.push(cid);
    } else {
      primaryIds.push(cid);
    }
  }

  for (const cid of primaryIds) {
    const s = nextSeriesById[cid];
    const spec = getCommoditySpec(cid);
    if (!s || !spec) continue;
    const carryPerm = s.permanentOffsets[s.permanentOffsets.length - 1] ?? 0;
    const extraBase = generatePrimarySeriesBase(
      spec,
      s.effectivePattern,
      s.appliedPatternConfig,
      currentLength,
      targetLength,
      config.volatilityMultiplier,
      rng,
      overrides[cid]
    );
    s.basePrices.push(...extraBase);
    for (let m = currentLength; m < targetLength; m++) {
      s.permanentOffsets.push(carryPerm);
      s.supplyDemandMargins.push(0);
    }
  }

  let remainingLinked = [...linkedIds];
  for (let pass = 0; pass <= linkedIds.length && remainingLinked.length > 0; pass++) {
    const nextRem: string[] = [];
    let resolvedAny = false;
    for (const cid of remainingLinked) {
      const s = nextSeriesById[cid];
      const spec = getCommoditySpec(cid);
      const leaderId = s?.appliedPatternConfig.linkedCommodityId;
      const leaderSeries = leaderId ? nextSeriesById[leaderId] : undefined;
      const leaderSpec = leaderId ? getCommoditySpec(leaderId) : undefined;
      if (s && spec && leaderSeries && leaderSpec && leaderSeries.basePrices.length >= targetLength) {
        const carryPerm = s.permanentOffsets[s.permanentOffsets.length - 1] ?? 0;
        for (let m = currentLength; m < targetLength; m++) {
          s.basePrices.push(
            computeLinkedPriceAtMonth(
              spec,
              s.appliedPatternConfig,
              leaderSeries.basePrices,
              leaderSpec,
              m,
              config.volatilityMultiplier,
              rng,
              overrides[cid]?.[m]
            )
          );
          s.permanentOffsets.push(carryPerm);
          s.supplyDemandMargins.push(0);
        }
        resolvedAny = true;
      } else {
        nextRem.push(cid);
      }
    }
    remainingLinked = nextRem;
    if (!resolvedAny && remainingLinked.length > 0) {
      const fallbackId = remainingLinked.shift()!;
      const s = nextSeriesById[fallbackId];
      const spec = getCommoditySpec(fallbackId);
      if (s && spec) {
        const carryPerm = s.permanentOffsets[s.permanentOffsets.length - 1] ?? 0;
        const extra = generatePrimarySeriesBase(
          spec,
          'seasonal_monthly',
          { pattern: 'seasonal_monthly', seasonalPeak: 'winter' },
          currentLength,
          targetLength,
          config.volatilityMultiplier,
          rng,
          overrides[fallbackId]
        );
        s.basePrices.push(...extra);
        for (let m = currentLength; m < targetLength; m++) {
          s.permanentOffsets.push(carryPerm);
          s.supplyDemandMargins.push(0);
        }
      }
    }
  }

  const nextSeasonalEvents = generateSeasonalEventsForRange(
    nextSeriesById,
    market.activeCommodityIds,
    config,
    currentLength,
    targetLength,
    market.seasonalEvents ?? {}
  );

  return {
    ...market,
    seriesById: nextSeriesById,
    seasonalEvents: nextSeasonalEvents,
  };
}

export function describePatternRule(
  effectivePattern: PatternFamily,
  cfg?: ProductPatternConfig
): string {
  if (effectivePattern === 'neutral' || !cfg) {
    return 'النمط معطّل في إعدادات الجلسة (حركة سوق متوازنة).';
  }
  switch (effectivePattern) {
    case 'seasonal_monthly': {
      const peak = cfg.seasonalPeak ?? 'winter';
      if (peak === 'custom') {
        return 'تقسيم سعري مخصص لكل شهر من أشهر السنة (ش1–ش12).';
      }
      return `تغير شهري متدرج حسب الفصول (${SEASONAL_PEAK_LABELS[peak]}).`;
    }
    case 'numeric_month_rule': {
      const rule = cfg.numericRule ?? 'even_up_odd_down';
      return NUMERIC_RULE_LABELS[rule];
    }
    case 'linked_commodity': {
      const leaderName = cfg.linkedCommodityId
        ? getCommoditySpec(cfg.linkedCommodityId)?.name ?? cfg.linkedCommodityId
        : 'منتج آخر';
      const dir = cfg.correlationDirection ?? 'direct';
      const lagTxt = cfg.lagMonths === 1 ? ' (بتأخر شهر واحد)' : ' (في نفس الشهر)';
      return `ارتباط ${CORRELATION_LABELS[dir]} مع "${leaderName}"${lagTxt}.`;
    }
  }
}

function buildDynamicSecretClue(
  series: CommodityMarketSeries,
  tier: number,
  currPrice: number,
  nextPrice: number | null
): string {
  if (series.effectivePattern === 'neutral') {
    return tier === 0
      ? 'تم تعطيل الخوارزمية الخاصة لهذه السلعة؛ تتحرك بهدوء حول متوسطها الأساسي.'
      : 'يتحرك سعرها حالياً وفق توازن العرض والطلب من صفقات الفرق فقط.';
  }

  const cfg = series.appliedPatternConfig;
  let baseClue = '';

  if (series.effectivePattern === 'seasonal_monthly') {
    const peak = cfg.seasonalPeak ?? 'winter';
    if (peak === 'custom') {
      baseClue =
        tier === 0
          ? 'نمط شهري مخصص: تتبع هذه السلعة جدول أسعار مبرمجاً يختلف من شهر إلى آخر على مدار السنة.'
          : 'دورة الأسعار المخصصة لهذه السلعة تتكرر سنوياً كل 12 شهراً (من ش1 إلى ش12).';
    } else if (tier === 0) {
      baseClue =
        'نمط موسمي فصلي: يتدرج سعر هذه السلعة صعوداً وهبوطاً عبر فصول السنة الأربعة كل شهر.';
    } else {
      baseClue = `تصل هذه السلعة إلى أعلى مستوياتها السعرية في ${SEASONAL_PEAK_LABELS[peak]}، وتنخفض في الفصل المقابل.`;
    }
  } else if (series.effectivePattern === 'numeric_month_rule') {
    const rule = cfg.numericRule ?? 'even_up_odd_down';
    if (tier === 0) {
      baseClue =
        'نمط رقمي يعتمد على رقم الشهر التراكمي وليس على فصول السنة أو السلع الأخرى.';
    } else {
      baseClue = `القاعدة الحسابية المكتشفة: ${NUMERIC_RULE_LABELS[rule]}.`;
    }
  } else if (series.effectivePattern === 'linked_commodity') {
    const leaderName = cfg.linkedCommodityId
      ? getCommoditySpec(cfg.linkedCommodityId)?.name ?? cfg.linkedCommodityId
      : 'سلعة أخرى';
    const dir = cfg.correlationDirection ?? 'direct';
    const lagTxt = cfg.lagMonths === 1 ? 'بتأخر شهر واحد' : 'في الشهر نفسه';
    if (tier === 0) {
      baseClue = `ارتباط سعري: هذه السلعة لا تتحرك بمعزل عن السوق، بل تتبع حركة "${leaderName}".`;
    } else {
      baseClue = `طبيعة الارتباط مع "${leaderName}": علاقة ${dir === 'direct' ? 'طردية (ترتفع معها وتنخفض معها)' : 'عكسية (ترتفع عند هبوطها وتنخفض عند صعودها)'} ${lagTxt}.`;
    }
  }

  if (nextPrice !== null && nextPrice < currPrice * 0.76) {
    baseClue += ' تنبيه استخباراتي: المؤشرات السرية ترصد احتمال هبوط ملحوظ في الشهر القادم!';
  } else if (nextPrice !== null && nextPrice > currPrice * 1.24) {
    baseClue += ' تنبيه استخباراتي: المؤشرات ترصد قفزة سعرية صاعدة في الشهر القادم!';
  }

  return baseClue;
}

export function createInitialGameState(
  partialConfig?: Partial<SessionConfig>,
  teamNames?: string[]
): GameState {
  const config = sanitizeConfig(partialConfig);
  const market = generateMarketState(config);

  const names =
    teamNames && teamNames.length >= 2
      ? teamNames.slice(0, 6).map((n, i) => n.trim() || DEFAULT_TEAM_NAMES[i])
      : DEFAULT_TEAM_NAMES.slice(0, 4);

  const teams: TeamState[] = names.map((name, idx) => ({
    id: `team_${idx + 1}`,
    name,
    cash: config.startingCash,
    holdings: {},
    unlockedHints: [],
    netWorthHistory: [config.startingCash],
  }));

  return {
    version: 2,
    config,
    currentMonthIndex: 0,
    isFinished: false,
    market,
    teams,
    tradeLog: [],
    undoStack: [],
    lastSavedAt: Date.now(),
  };
}

export function getSeasonalEventDelta(
  market: MarketState,
  commodityId: string,
  monthIndex: number
): number {
  const ev = market.seasonalEvents?.[monthIndex];
  if (!ev || ev.commodityId !== commodityId) return 0;
  return ev.priceDelta;
}

export function getActiveHijriImpacts(
  market: MarketState,
  monthIndex: number
): HijriCommodityImpact[] {
  if (market.hijriEffectsEnabled === false) return [];
  const dual = getDualCalendarForMonth(market, monthIndex);
  const rules = HIJRI_MONTH_EFFECTS[dual.hijriMonth] ?? [];
  const impacts: HijriCommodityImpact[] = [];

  for (const rule of rules) {
    const series = market.seriesById[rule.commodityId];
    if (!series) continue;
    const spec = getCommoditySpec(rule.commodityId);
    const clampedMonth = Math.max(0, Math.min(series.basePrices.length - 1, monthIndex));
    const base = series.basePrices[clampedMonth] ?? spec?.basePrice ?? 100;
    const rawDelta = Math.round(base * rule.impactPct);
    const priceDelta =
      rule.impactPct >= 0
        ? Math.max(1, rawDelta)
        : -Math.min(Math.max(1, base - 1), Math.abs(rawDelta));

    impacts.push({
      hijriMonth: dual.hijriMonth,
      hijriMonthName: dual.hijriMonthName,
      commodityId: rule.commodityId,
      commodityName: spec?.name ?? rule.commodityId,
      impactPct: rule.impactPct,
      priceDelta,
      title: rule.title,
      reason: rule.reason,
    });
  }

  return impacts;
}

export function getHijriPriceDelta(
  market: MarketState,
  commodityId: string,
  monthIndex: number
): number {
  if (market.hijriEffectsEnabled === false) return 0;
  const dual = getDualCalendarForMonth(market, monthIndex);
  const rules = HIJRI_MONTH_EFFECTS[dual.hijriMonth];
  if (!rules || rules.length === 0) return 0;
  const rule = rules.find((r) => r.commodityId === commodityId);
  if (!rule) return 0;
  const series = market.seriesById[commodityId];
  if (!series) return 0;
  const clampedMonth = Math.max(0, Math.min(series.basePrices.length - 1, monthIndex));
  const base = series.basePrices[clampedMonth] ?? 100;
  const rawDelta = Math.round(base * rule.impactPct);
  return rule.impactPct >= 0
    ? Math.max(1, rawDelta)
    : -Math.min(Math.max(1, base - 1), Math.abs(rawDelta));
}

export function getActiveSeasonalEvent(
  market: MarketState,
  monthIndex: number
): SeasonalEventRecord | null {
  return market.seasonalEvents?.[monthIndex] ?? null;
}

export function getPlayedSeasonalEvents(gameState: GameState): SeasonalEventRecord[] {
  const events = gameState.market.seasonalEvents ?? {};
  return Object.values(events)
    .filter((ev) => ev.monthIndex <= gameState.currentMonthIndex)
    .sort((a, b) => b.monthIndex - a.monthIndex);
}

export function getNextSeasonalEventMonth(gameState: GameState): number | null {
  if (!gameState.config.seasonalEventsEnabled) return null;
  const currMonthNum = gameState.currentMonthIndex + 1;
  const remainder = currMonthNum % 3;
  const nextMonthNum = remainder === 0 ? currMonthNum : currMonthNum + (3 - remainder);
  if (
    gameState.config.horizonMode !== 'unlimited' &&
    nextMonthNum > (gameState.config.totalMonths || TOTAL_MONTHS)
  ) {
    return null;
  }
  return nextMonthNum;
}

export function getEffectivePrice(
  market: MarketState,
  commodityId: string,
  monthIndex: number
): number {
  const series = market.seriesById[commodityId];
  if (!series) return 0;
  const clampedMonth = Math.max(0, Math.min(series.basePrices.length - 1, monthIndex));

  const tempOverride = series.tempOverrides[clampedMonth];
  if (typeof tempOverride === 'number' && Number.isFinite(tempOverride)) {
    return Math.max(1, Math.round(tempOverride));
  }

  const base = series.basePrices[clampedMonth] ?? 0;
  const perm = series.permanentOffsets[clampedMonth] ?? 0;
  const demand = series.supplyDemandMargins[clampedMonth] ?? 0;
  const seasonalDelta = getSeasonalEventDelta(market, commodityId, clampedMonth);
  const hijriDelta = getHijriPriceDelta(market, commodityId, clampedMonth);
  return Math.max(1, Math.round(base + perm + demand + seasonalDelta + hijriDelta));
}

export function getPreviousMonthDelta(
  market: MarketState,
  commodityId: string,
  currentMonthIndex: number
): { current: number; previous: number | null; delta: number; deltaPct: number } {
  const current = getEffectivePrice(market, commodityId, currentMonthIndex);
  if (currentMonthIndex <= 0) {
    return { current, previous: null, delta: 0, deltaPct: 0 };
  }
  const previous = getEffectivePrice(market, commodityId, currentMonthIndex - 1);
  const delta = current - previous;
  const deltaPct = previous > 0 ? Math.round((delta / previous) * 1000) / 10 : 0;
  return { current, previous, delta, deltaPct };
}

export function getVisibleHistory(gameState: GameState, commodityId: string): number[] {
  const series = gameState.market.seriesById[commodityId];
  if (!series) return [];
  const maxIdx =
    gameState.config.horizonMode === 'unlimited'
      ? series.basePrices.length - 1
      : Math.min(gameState.config.totalMonths - 1, series.basePrices.length - 1);
  const end = Math.max(0, Math.min(maxIdx, gameState.currentMonthIndex));
  const result: number[] = [];
  for (let m = 0; m <= end; m++) {
    result.push(getEffectivePrice(gameState.market, commodityId, m));
  }
  return result;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function pushUndoSnapshot(state: GameState, label: string): GameSnapshot[] {
  const snapshot: GameSnapshot = {
    label,
    currentMonthIndex: state.currentMonthIndex,
    isFinished: state.isFinished,
    market: deepClone(state.market),
    teams: deepClone(state.teams),
    tradeLog: deepClone(state.tradeLog),
  };
  const nextStack = [...state.undoStack, snapshot];
  if (nextStack.length > MAX_UNDO_SNAPSHOTS) {
    return nextStack.slice(nextStack.length - MAX_UNDO_SNAPSHOTS);
  }
  return nextStack;
}

export function computeTeamAssetsValue(
  team: TeamState,
  market: MarketState,
  monthIndex: number
): number {
  let total = 0;
  for (const [commodityId, qty] of Object.entries(team.holdings)) {
    if (qty > 0 && market.seriesById[commodityId]) {
      total += qty * getEffectivePrice(market, commodityId, monthIndex);
    }
  }
  return Math.round(total);
}

export function getLeaderboard(gameState: GameState): TeamLeaderboardEntry[] {
  const entries = gameState.teams.map((team) => {
    const assetsValue = computeTeamAssetsValue(
      team,
      gameState.market,
      gameState.currentMonthIndex
    );
    const netWorth = team.cash + assetsValue;
    const prevNetWorth =
      team.netWorthHistory.length >= 2
        ? team.netWorthHistory[team.netWorthHistory.length - 2]
        : gameState.config.startingCash;
    return {
      team,
      assetsValue,
      netWorth,
      netWorthDelta: netWorth - prevNetWorth,
      rank: 1,
    };
  });

  entries.sort((a, b) => b.netWorth - a.netWorth);
  return entries.map((entry, idx) => ({ ...entry, rank: idx + 1 }));
}

export function executeTrade(
  gameState: GameState,
  teamId: string,
  orders: TradeOrderItem[]
): { state: GameState; error?: string } {
  if (gameState.isFinished) {
    return { state: gameState, error: 'انتهت الجلسة؛ يمكنك التراجع أو بدء جلسة جديدة.' };
  }

  const teamIdx = gameState.teams.findIndex((t) => t.id === teamId);
  if (teamIdx === -1) {
    return { state: gameState, error: 'الفريق غير موجود.' };
  }

  const validOrders = orders.filter((o) => Number.isInteger(o.quantity) && o.quantity !== 0);
  if (validOrders.length === 0) {
    return { state: gameState, error: 'لم يتم تحديد أي كمية للبيع أو الشراء.' };
  }

  const team = gameState.teams[teamIdx];
  let cashDelta = 0;
  const nextHoldings = { ...team.holdings };
  const newLogs: TradeLogEntry[] = [];
  const nextNetVolume = { ...gameState.market.currentMonthNetVolume };

  for (const order of validOrders) {
    const spec = getCommoditySpec(order.commodityId);
    if (!spec || !gameState.market.seriesById[order.commodityId]) {
      return { state: gameState, error: `السلعة ${order.commodityId} غير نشطة في هذه الجلسة.` };
    }
    const currentHolding = nextHoldings[order.commodityId] ?? 0;
    const resultingHolding = currentHolding + order.quantity;
    if (resultingHolding < 0) {
      return {
        state: gameState,
        error: `لا يملك ${team.name} كمية كافية من "${spec.name}" للبيع (المتاح: ${currentHolding}).`,
      };
    }

    const price = getEffectivePrice(
      gameState.market,
      order.commodityId,
      gameState.currentMonthIndex
    );
    const orderCost = order.quantity * price;
    cashDelta -= orderCost;

    if (resultingHolding === 0) {
      delete nextHoldings[order.commodityId];
    } else {
      nextHoldings[order.commodityId] = resultingHolding;
    }

    nextNetVolume[order.commodityId] = (nextNetVolume[order.commodityId] ?? 0) + order.quantity;
    newLogs.push({
      id: `tr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      monthIndex: gameState.currentMonthIndex,
      teamId: team.id,
      teamName: team.name,
      commodityId: spec.id,
      commodityName: spec.name,
      quantity: order.quantity,
      unitPrice: price,
      totalAmount: Math.abs(orderCost),
      timestamp: Date.now(),
    });
  }

  const nextCash = team.cash + cashDelta;
  if (nextCash < 0) {
    return {
      state: gameState,
      error: `السيولة النقدية لـ ${team.name} غير كافية (${team.cash} ريال المتاحة).`,
    };
  }

  const undoStack = pushUndoSnapshot(gameState, `صفقة: ${team.name}`);
  const nextTeams = gameState.teams.map((t, idx) =>
    idx === teamIdx ? { ...t, cash: nextCash, holdings: nextHoldings } : t
  );

  return {
    state: {
      ...gameState,
      teams: nextTeams,
      market: {
        ...gameState.market,
        currentMonthNetVolume: nextNetVolume,
      },
      tradeLog: [...newLogs, ...gameState.tradeLog],
      undoStack,
      lastSavedAt: Date.now(),
    },
  };
}

export function purchaseSecretReport(
  gameState: GameState,
  teamId: string,
  commodityId: string
): { state: GameState; hint?: SecretHintRecord; error?: string } {
  if (gameState.isFinished) {
    return { state: gameState, error: 'انتهت المحاكاة.' };
  }
  const teamIdx = gameState.teams.findIndex((t) => t.id === teamId);
  if (teamIdx === -1) return { state: gameState, error: 'الفريق غير موجود.' };

  const spec = getCommoditySpec(commodityId);
  const series = gameState.market.seriesById[commodityId];
  if (!spec || !series) return { state: gameState, error: 'السلعة غير نشطة.' };

  const team = gameState.teams[teamIdx];
  const cost = gameState.config.secretReportCost;
  if (team.cash < cost) {
    return {
      state: gameState,
      error: `السيولة غير كافية لشراء التقرير السري (المطلوب ${cost} ريال).`,
    };
  }

  const existingForCommodity = team.unlockedHints.filter((h) => h.commodityId === commodityId);
  if (existingForCommodity.length >= 2) {
    return {
      state: gameState,
      error: `حصل ${team.name} بالفعل على كامل التقارير السرية المتاحة لـ "${spec.name}".`,
    };
  }

  const nextMonth = gameState.currentMonthIndex + 1;
  const workingMarket =
    gameState.config.horizonMode === 'unlimited'
      ? extendMarketHorizonIfNeeded(gameState.market, gameState.config, nextMonth + 1)
      : gameState.market;
  const workingSeries = workingMarket.seriesById[commodityId] ?? series;
  const maxMonthBound =
    gameState.config.horizonMode === 'unlimited'
      ? workingSeries.basePrices.length
      : gameState.config.totalMonths;

  const currP = getEffectivePrice(workingMarket, commodityId, gameState.currentMonthIndex);
  const nextP =
    nextMonth < maxMonthBound ? getEffectivePrice(workingMarket, commodityId, nextMonth) : null;

  const clueText = buildDynamicSecretClue(
    workingSeries,
    existingForCommodity.length,
    currP,
    nextP
  );

  const hint: SecretHintRecord = {
    id: `hint_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    commodityId,
    commodityName: spec.name,
    monthIndex: gameState.currentMonthIndex,
    text: clueText,
    cost,
  };

  const undoStack = pushUndoSnapshot(gameState, `تقرير سري: ${team.name} - ${spec.name}`);
  const nextTeams = gameState.teams.map((t, idx) =>
    idx === teamIdx
      ? {
          ...t,
          cash: t.cash - cost,
          unlockedHints: [hint, ...t.unlockedHints],
        }
      : t
  );

  return {
    state: {
      ...gameState,
      market: workingMarket,
      teams: nextTeams,
      undoStack,
      lastSavedAt: Date.now(),
    },
    hint,
  };
}

export function applyManualPriceOverride(
  gameState: GameState,
  commodityId: string,
  newPrice: number,
  mode: 'temporary' | 'permanent'
): { state: GameState; error?: string } {
  const series = gameState.market.seriesById[commodityId];
  const spec = getCommoditySpec(commodityId);
  if (!series || !spec) {
    return { state: gameState, error: 'السلعة غير موجودة.' };
  }
  if (!Number.isFinite(newPrice) || newPrice < 1) {
    return { state: gameState, error: 'يجب إدخال سعر صحيح أكبر من صفر.' };
  }

  const targetPrice = Math.round(newPrice);
  const undoStack = pushUndoSnapshot(
    gameState,
    `تعديل سعر ${spec.name} (${mode === 'temporary' ? 'مؤقت' : 'دائم'})`
  );

  const nextSeries = deepClone(series);
  const m = gameState.currentMonthIndex;

  if (mode === 'temporary') {
    nextSeries.tempOverrides[m] = targetPrice;
  } else {
    delete nextSeries.tempOverrides[m];
    const currentNonTemp =
      (nextSeries.basePrices[m] ?? 0) +
      (nextSeries.permanentOffsets[m] ?? 0) +
      (nextSeries.supplyDemandMargins[m] ?? 0) +
      getSeasonalEventDelta(gameState.market, commodityId, m) +
      getHijriPriceDelta(gameState.market, commodityId, m);
    const delta = targetPrice - currentNonTemp;
    for (let i = m; i < nextSeries.permanentOffsets.length; i++) {
      nextSeries.permanentOffsets[i] = (nextSeries.permanentOffsets[i] ?? 0) + delta;
    }
  }

  return {
    state: {
      ...gameState,
      market: {
        ...gameState.market,
        seriesById: {
          ...gameState.market.seriesById,
          [commodityId]: nextSeries,
        },
      },
      undoStack,
      lastSavedAt: Date.now(),
    },
  };
}

export interface MonthlyPlanEdit {
  commodityId: string;
  monthIndex: number;
  price: number;
}

/**
 * Applies a batch of monthly product price adjustments in the active session (with single Undo snapshot).
 */
export function applyMonthlyPlanBatchOverrides(
  gameState: GameState,
  edits: MonthlyPlanEdit[]
): { state: GameState; updatedCount: number; error?: string } {
  const validEdits = edits.filter(
    (e) =>
      gameState.market.seriesById[e.commodityId] &&
      Number.isInteger(e.monthIndex) &&
      e.monthIndex >= 0 &&
      Number.isFinite(e.price) &&
      e.price >= 1
  );
  if (validEdits.length === 0) {
    return { state: gameState, updatedCount: 0, error: 'لم يتم إجراء أي تعديل سعري.' };
  }

  const maxEditedMonth = Math.max(...validEdits.map((e) => e.monthIndex));
  const preparedMarket =
    gameState.config.horizonMode === 'unlimited'
      ? extendMarketHorizonIfNeeded(gameState.market, gameState.config, maxEditedMonth + 2)
      : gameState.market;

  const nextSeriesById = deepClone(preparedMarket.seriesById);
  const nextCustomOverrides = deepClone(gameState.config.customPlanOverrides ?? {});
  let updatedCount = 0;

  for (const edit of validEdits) {
    const s = nextSeriesById[edit.commodityId];
    if (!s || edit.monthIndex >= s.basePrices.length) continue;
    const targetPrice = Math.max(1, Math.round(edit.price));
    const currentEffective = getEffectivePrice(preparedMarket, edit.commodityId, edit.monthIndex);
    if (currentEffective === targetPrice) continue;

    delete s.tempOverrides[edit.monthIndex];
    s.permanentOffsets[edit.monthIndex] = 0;
    s.supplyDemandMargins[edit.monthIndex] = 0;
    const seasonalDelta = getSeasonalEventDelta(
      preparedMarket,
      edit.commodityId,
      edit.monthIndex
    );
    const desiredWithoutSeasonal = targetPrice - seasonalDelta;
    const hijriDual = getDualCalendarForMonth(preparedMarket, edit.monthIndex);
    const hijriRule =
      preparedMarket.hijriEffectsEnabled === false
        ? undefined
        : (HIJRI_MONTH_EFFECTS[hijriDual.hijriMonth] ?? []).find(
            (r) => r.commodityId === edit.commodityId
          );

    if (desiredWithoutSeasonal >= 1) {
      if (!hijriRule) {
        s.basePrices[edit.monthIndex] = desiredWithoutSeasonal;
      } else {
        const approxBase = Math.max(
          1,
          Math.round(desiredWithoutSeasonal / (1 + hijriRule.impactPct))
        );
        let solvedBase = approxBase;
        let solved = false;
        for (const offset of [0, -1, 1, -2, 2]) {
          const candidate = Math.max(1, approxBase + offset);
          const rawDelta = Math.round(candidate * hijriRule.impactPct);
          const hDelta =
            hijriRule.impactPct >= 0
              ? Math.max(1, rawDelta)
              : -Math.min(Math.max(1, candidate - 1), Math.abs(rawDelta));
          if (candidate + hDelta === desiredWithoutSeasonal) {
            solvedBase = candidate;
            solved = true;
            break;
          }
        }
        s.basePrices[edit.monthIndex] = solvedBase;
        if (!solved) {
          s.tempOverrides[edit.monthIndex] = targetPrice;
        }
      }
    } else {
      s.basePrices[edit.monthIndex] = targetPrice;
      s.tempOverrides[edit.monthIndex] = targetPrice;
    }

    if (!nextCustomOverrides[edit.commodityId]) {
      nextCustomOverrides[edit.commodityId] = {};
    }
    nextCustomOverrides[edit.commodityId][edit.monthIndex] = targetPrice;
    updatedCount++;
  }

  if (updatedCount === 0) {
    return { state: gameState, updatedCount: 0 };
  }

  const undoStack = pushUndoSnapshot(
    gameState,
    `تعديل خطة الأسعار الشهرية (${updatedCount} تحديث)`
  );

  const nextMarket: MarketState = {
    ...preparedMarket,
    seriesById: nextSeriesById,
  };

  // Keep current teams' current netWorthHistory snapshot synced if currentMonthIndex was edited
  const nextTeams = gameState.teams.map((team) => {
    const nw =
      team.cash + computeTeamAssetsValue(team, nextMarket, gameState.currentMonthIndex);
    const hist = [...team.netWorthHistory];
    if (hist.length > 0) {
      hist[hist.length - 1] = nw;
    } else {
      hist.push(nw);
    }
    return { ...team, netWorthHistory: hist };
  });

  return {
    state: {
      ...gameState,
      config: {
        ...gameState.config,
        customPlanOverrides: nextCustomOverrides,
      },
      market: nextMarket,
      teams: nextTeams,
      undoStack,
      lastSavedAt: Date.now(),
    },
    updatedCount,
  };
}

/**
 * Grants positive cash additions (e.g. 1000, 2000, 3000, or custom) to selected teams at any point.
 */
export function grantTeamCash(
  gameState: GameState,
  grantsByTeamId: Record<string, number>,
  label = 'إضافة سيولة للفرق'
): { state: GameState; totalGranted: number; error?: string } {
  if (gameState.isFinished) {
    return { state: gameState, totalGranted: 0, error: 'الجلسة منتهية.' };
  }

  let totalGranted = 0;
  for (const team of gameState.teams) {
    const amount = Number(grantsByTeamId[team.id] ?? 0);
    if (!Number.isFinite(amount) || amount < 0) {
      return {
        state: gameState,
        totalGranted: 0,
        error: 'يجب أن تكون مبالغ السيولة المضافة أرقاماً موجبة صحيحة.',
      };
    }
    totalGranted += Math.round(amount);
  }

  if (totalGranted <= 0) {
    return { state: gameState, totalGranted: 0, error: 'لم يتم تحديد أي مبلغ لإضافته للفرق.' };
  }

  const undoStack = pushUndoSnapshot(gameState, label);
  const nextTeams = gameState.teams.map((team) => {
    const add = Math.max(0, Math.round(Number(grantsByTeamId[team.id] ?? 0)));
    if (add <= 0) return team;
    const nextCash = team.cash + add;
    const nw =
      nextCash + computeTeamAssetsValue(team, gameState.market, gameState.currentMonthIndex);
    const hist = [...team.netWorthHistory];
    if (hist.length > 0) {
      hist[hist.length - 1] = nw;
    } else {
      hist.push(nw);
    }
    return {
      ...team,
      cash: nextCash,
      netWorthHistory: hist,
    };
  });

  return {
    state: {
      ...gameState,
      teams: nextTeams,
      undoStack,
      lastSavedAt: Date.now(),
    },
    totalGranted,
  };
}

export function advanceMonth(
  gameState: GameState,
  teamCashGrants?: Record<string, number>
): GameState {
  if (gameState.isFinished) return gameState;

  const undoStack = pushUndoSnapshot(
    gameState,
    `الانتقال من الشهر ${gameState.currentMonthIndex + 1}`
  );

  const isUnlimited = gameState.config.horizonMode === 'unlimited';
  const fixedTotalMonths = gameState.config.totalMonths || TOTAL_MONTHS;
  const nextMonth = gameState.currentMonthIndex + 1;
  const finished = !isUnlimited && nextMonth >= fixedTotalMonths;

  const extendedMarket = isUnlimited
    ? extendMarketHorizonIfNeeded(gameState.market, gameState.config, nextMonth + 4)
    : gameState.market;

  const nextSeriesById = deepClone(extendedMarket.seriesById);
  const nextNetVolume: Record<string, number> = {};
  const nextLastImpact: Record<string, number> = {};

  if (!finished) {
    const threshold = gameState.config.supplyDemandThreshold;
    const stepPct = gameState.config.supplyDemandStepPct;

    for (const id of extendedMarket.activeCommodityIds) {
      const netVol = extendedMarket.currentMonthNetVolume[id] ?? 0;
      const series = nextSeriesById[id];
      nextNetVolume[id] = 0;

      if (Math.abs(netVol) >= threshold && series) {
        const direction = Math.sign(netVol);
        const excessRatio = Math.min(2, (Math.abs(netVol) - threshold) / threshold);
        const intensity = 1 + excessRatio * 0.5;
        const baseNext = series.basePrices[nextMonth] ?? 100;
        const margin = Math.round(baseNext * stepPct * direction * intensity);

        series.supplyDemandMargins[nextMonth] =
          (series.supplyDemandMargins[nextMonth] ?? 0) + margin;
        if (nextMonth + 1 < series.basePrices.length) {
          series.supplyDemandMargins[nextMonth + 1] =
            (series.supplyDemandMargins[nextMonth + 1] ?? 0) + Math.round(margin * 0.35);
        }
        nextLastImpact[id] = margin;
      } else {
        nextLastImpact[id] = 0;
      }
    }
  } else {
    for (const id of extendedMarket.activeCommodityIds) {
      nextNetVolume[id] = 0;
      nextLastImpact[id] = 0;
    }
  }

  const targetEvalMonth = finished ? gameState.currentMonthIndex : nextMonth;
  const nextMarket: MarketState = {
    ...extendedMarket,
    seriesById: nextSeriesById,
    currentMonthNetVolume: nextNetVolume,
    lastMonthDemandImpact: nextLastImpact,
  };

  const nextTeams = gameState.teams.map((team) => {
    const rawGrant = !finished && teamCashGrants ? Number(teamCashGrants[team.id] ?? 0) : 0;
    const grant = Number.isFinite(rawGrant) && rawGrant > 0 ? Math.round(rawGrant) : 0;
    const nextCash = team.cash + grant;
    const assetsVal = computeTeamAssetsValue(team, nextMarket, targetEvalMonth);
    const nw = nextCash + assetsVal;
    return {
      ...team,
      cash: nextCash,
      netWorthHistory: [...team.netWorthHistory, nw],
    };
  });

  return {
    ...gameState,
    currentMonthIndex: finished ? gameState.currentMonthIndex : nextMonth,
    isFinished: finished,
    market: nextMarket,
    teams: nextTeams,
    undoStack,
    lastSavedAt: Date.now(),
  };
}

export function endUnlimitedSession(gameState: GameState): GameState {
  if (gameState.isFinished) return gameState;
  const undoStack = pushUndoSnapshot(gameState, 'إنهاء الجلسة وإعلان النتائج');
  return {
    ...gameState,
    isFinished: true,
    undoStack,
    lastSavedAt: Date.now(),
  };
}

export function resetSessionFromBeginning(
  gameState: GameState,
  options?: { regeneratePrices?: boolean }
): GameState {
  const undoStack = pushUndoSnapshot(
    gameState,
    options?.regeneratePrices
      ? 'إعادة البورصة من البداية (أسعار جديدة)'
      : 'إعادة البورصة من البداية'
  );

  let nextConfig = gameState.config;
  let nextMarket: MarketState;

  if (options?.regeneratePrices) {
    const newSeed = ((gameState.config.seed + 7919) >>> 0) || 303030;
    nextConfig = {
      ...gameState.config,
      seed: newSeed === gameState.config.seed ? newSeed + 1 : newSeed,
    };
    nextMarket = generateMarketState(nextConfig);
  } else {
    const nextSeriesById = deepClone(gameState.market.seriesById);
    const nextNetVolume: Record<string, number> = {};
    const nextLastImpact: Record<string, number> = {};
    for (const cid of gameState.market.activeCommodityIds) {
      nextNetVolume[cid] = 0;
      nextLastImpact[cid] = 0;
      const s = nextSeriesById[cid];
      if (s) {
        s.permanentOffsets = new Array(s.basePrices.length).fill(0);
        s.supplyDemandMargins = new Array(s.basePrices.length).fill(0);
        s.tempOverrides = {};
      }
    }
    nextMarket = {
      ...gameState.market,
      seriesById: nextSeriesById,
      currentMonthNetVolume: nextNetVolume,
      lastMonthDemandImpact: nextLastImpact,
      hijriEffectsEnabled: gameState.config.hijriEffectsEnabled,
      startYear: gameState.config.startYear,
      startMonth: gameState.config.startMonth,
      startHijriYear: gameState.config.startHijriYear,
      startHijriMonth: gameState.config.startHijriMonth,
    };
  }

  const nextTeams: TeamState[] = gameState.teams.map((t) => ({
    ...t,
    cash: nextConfig.startingCash,
    holdings: {},
    unlockedHints: [],
    netWorthHistory: [nextConfig.startingCash],
  }));

  return {
    ...gameState,
    config: nextConfig,
    currentMonthIndex: 0,
    isFinished: false,
    market: nextMarket,
    teams: nextTeams,
    tradeLog: [],
    undoStack,
    lastSavedAt: Date.now(),
  };
}

export function undoLastAction(gameState: GameState): { state: GameState; restoredLabel?: string } {
  if (gameState.undoStack.length === 0) {
    return { state: gameState };
  }
  const nextUndoStack = gameState.undoStack.slice(0, -1);
  const snapshot = gameState.undoStack[gameState.undoStack.length - 1];

  return {
    state: {
      ...gameState,
      currentMonthIndex: snapshot.currentMonthIndex,
      isFinished: snapshot.isFinished,
      market: deepClone(snapshot.market),
      teams: deepClone(snapshot.teams),
      tradeLog: deepClone(snapshot.tradeLog),
      undoStack: nextUndoStack,
      lastSavedAt: Date.now(),
    },
    restoredLabel: snapshot.label,
  };
}

export function getYearAndMonthDisplay(monthIndex: number): {
  year: number;
  monthInYear: number;
  absoluteMonth: number;
} {
  const safeIndex = Math.max(0, monthIndex);
  return {
    year: Math.floor(safeIndex / 12) + 1,
    monthInYear: (safeIndex % 12) + 1,
    absoluteMonth: safeIndex + 1,
  };
}

export function serializeGameState(gameState: GameState): string {
  return JSON.stringify(gameState, null, 2);
}

export function deserializeGameState(jsonString: string): {
  state?: GameState;
  error?: string;
} {
  try {
    const parsed = JSON.parse(jsonString) as Partial<GameState>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !parsed.config ||
      !parsed.market ||
      !Array.isArray(parsed.market.activeCommodityIds) ||
      !Array.isArray(parsed.teams) ||
      typeof parsed.currentMonthIndex !== 'number'
    ) {
      return { error: 'ملف الجلسة غير صالح أو تنسيقه غير مكتمل.' };
    }

    const catalogIds = new Set(COMMODITIES_CATALOG.map((c) => c.id));
    const hasUnknownCommodity = parsed.market.activeCommodityIds.some((id) => !catalogIds.has(id));
    if (hasUnknownCommodity || parsed.market.activeCommodityIds.length === 0) {
      return { error: 'ملف الجلسة يعود لقائمة سلع سابقة ولا يطابق القائمة الحالية.' };
    }

    for (const cid of parsed.market.activeCommodityIds) {
      const series = parsed.market.seriesById[cid];
      const spec = getCommoditySpec(cid);
      if (series && !series.appliedPatternConfig && spec) {
        series.appliedPatternConfig = { ...spec.defaultPatternConfig };
      }
    }

    const config = sanitizeConfig(parsed.config);
    const maxMonth =
      config.horizonMode === 'unlimited'
        ? Math.max(0, Math.round(parsed.currentMonthIndex))
        : Math.max(0, Math.min(TOTAL_MONTHS - 1, Math.round(parsed.currentMonthIndex)));

    const sanitizedEvents: Record<number, SeasonalEventRecord> = {};
    if (parsed.market.seasonalEvents && typeof parsed.market.seasonalEvents === 'object') {
      for (const [k, ev] of Object.entries(parsed.market.seasonalEvents)) {
        if (!ev) continue;
        const idx = Number(k);
        const tpl = SEASONAL_EVENT_TEMPLATES[ev.commodityId]?.[ev.direction];
        sanitizedEvents[idx] = {
          ...ev,
          reason: ev.reason || tpl?.reason || ev.description || '',
        };
      }
    }

    const rawMarket: MarketState = {
      ...parsed.market,
      seasonalEvents: sanitizedEvents,
      hijriEffectsEnabled:
        parsed.market.hijriEffectsEnabled ?? config.hijriEffectsEnabled,
      startYear: parsed.market.startYear ?? config.startYear,
      startMonth: parsed.market.startMonth ?? config.startMonth,
      startHijriYear: parsed.market.startHijriYear ?? config.startHijriYear,
      startHijriMonth: parsed.market.startHijriMonth ?? config.startHijriMonth,
    };

    const market =
      config.horizonMode === 'unlimited'
        ? extendMarketHorizonIfNeeded(rawMarket, config, maxMonth + 4)
        : rawMarket;

    const restored: GameState = {
      version: parsed.version ?? 2,
      config,
      currentMonthIndex: maxMonth,
      isFinished: Boolean(parsed.isFinished),
      market,
      teams: parsed.teams,
      tradeLog: Array.isArray(parsed.tradeLog) ? parsed.tradeLog : [],
      undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [],
      lastSavedAt: Date.now(),
    };
    return { state: restored };
  } catch {
    return { error: 'تعذّر قراءة ملف JSON؛ تأكد من سلامة الملف.' };
  }
}

/**
 * Core MarketEngine service encapsulating product initialization, the 3 pricing algorithm
 * patterns (Seasonal incl. Custom Monthly Split, Mathematical/Prime-based, Correlation-based),
 * unlimited & 36-month horizons, monthly plan editing, pre-month team funding, trading,
 * supply/demand adjustments, secret intelligence reports, manual overrides, undo, and persistence.
 */
export class MarketEngine {
  public static readonly CATALOG: readonly CommoditySpec[] = COMMODITIES_CATALOG;
  public static readonly isPrimeMonth = isPrimeMonth;

  private state: GameState;

  constructor(
    initialState?: GameState,
    partialConfig?: Partial<SessionConfig>,
    teamNames?: string[]
  ) {
    this.state = initialState ?? createInitialGameState(partialConfig, teamNames);
  }

  public getState(): GameState {
    return this.state;
  }

  public setState(state: GameState): void {
    this.state = state;
  }

  public initializeSession(
    partialConfig?: Partial<SessionConfig>,
    teamNames?: string[]
  ): GameState {
    this.state = createInitialGameState(partialConfig, teamNames);
    return this.state;
  }

  public getProducts(): CommoditySpec[] {
    return this.state.market.activeCommodityIds
      .map((id) => getCommoditySpec(id))
      .filter((s): s is CommoditySpec => Boolean(s));
  }

  public getProductPattern(commodityId: string): {
    effectivePattern: PatternFamily;
    config: ProductPatternConfig;
    ruleSummary: string;
  } | null {
    const series = this.state.market.seriesById[commodityId];
    if (!series) return null;
    return {
      effectivePattern: series.effectivePattern,
      config: series.appliedPatternConfig,
      ruleSummary: describePatternRule(series.effectivePattern, series.appliedPatternConfig),
    };
  }

  public getPrice(commodityId: string, monthIndex = this.state.currentMonthIndex): number {
    return getEffectivePrice(this.state.market, commodityId, monthIndex);
  }

  public getPreviousDelta(commodityId: string) {
    return getPreviousMonthDelta(
      this.state.market,
      commodityId,
      this.state.currentMonthIndex
    );
  }

  public getVisibleHistory(commodityId: string): number[] {
    return getVisibleHistory(this.state, commodityId);
  }

  public getLeaderboard(): TeamLeaderboardEntry[] {
    return getLeaderboard(this.state);
  }

  public getActiveSeasonalEvent(
    monthIndex = this.state.currentMonthIndex
  ): SeasonalEventRecord | null {
    return getActiveSeasonalEvent(this.state.market, monthIndex);
  }

  public getPlayedSeasonalEvents(): SeasonalEventRecord[] {
    return getPlayedSeasonalEvents(this.state);
  }

  public getNextSeasonalEventMonth(): number | null {
    return getNextSeasonalEventMonth(this.state);
  }

  public executeTrade(
    teamId: string,
    orders: TradeOrderItem[]
  ): { state: GameState; error?: string } {
    const res = executeTrade(this.state, teamId, orders);
    if (!res.error) this.state = res.state;
    return res;
  }

  public purchaseSecretReport(
    teamId: string,
    commodityId: string
  ): { state: GameState; hint?: SecretHintRecord; error?: string } {
    const res = purchaseSecretReport(this.state, teamId, commodityId);
    if (!res.error) this.state = res.state;
    return res;
  }

  public applyManualPriceOverride(
    commodityId: string,
    newPrice: number,
    mode: 'temporary' | 'permanent'
  ): { state: GameState; error?: string } {
    const res = applyManualPriceOverride(this.state, commodityId, newPrice, mode);
    if (!res.error) this.state = res.state;
    return res;
  }

  public applyMonthlyPlanBatchOverrides(
    edits: MonthlyPlanEdit[]
  ): { state: GameState; updatedCount: number; error?: string } {
    const res = applyMonthlyPlanBatchOverrides(this.state, edits);
    if (!res.error && res.updatedCount > 0) this.state = res.state;
    return res;
  }

  public grantTeamCash(
    grantsByTeamId: Record<string, number>,
    label?: string
  ): { state: GameState; totalGranted: number; error?: string } {
    const res = grantTeamCash(this.state, grantsByTeamId, label);
    if (!res.error) this.state = res.state;
    return res;
  }

  public advanceMonth(teamCashGrants?: Record<string, number>): GameState {
    this.state = advanceMonth(this.state, teamCashGrants);
    return this.state;
  }

  public endSession(): GameState {
    this.state = endUnlimitedSession(this.state);
    return this.state;
  }

  public ensureHorizonLength(requiredLength: number): GameState {
    if (this.state.config.horizonMode !== 'unlimited') return this.state;
    const nextMarket = extendMarketHorizonIfNeeded(
      this.state.market,
      this.state.config,
      requiredLength
    );
    if (nextMarket !== this.state.market) {
      this.state = {
        ...this.state,
        market: nextMarket,
      };
    }
    return this.state;
  }

  public getDualCalendar(monthIndex = this.state.currentMonthIndex): DualCalendarInfo {
    return getDualCalendarForMonth(this.state.config, monthIndex);
  }

  public getActiveHijriImpacts(
    monthIndex = this.state.currentMonthIndex
  ): HijriCommodityImpact[] {
    return getActiveHijriImpacts(this.state.market, monthIndex);
  }

  public resetFromBeginning(options?: { regeneratePrices?: boolean }): GameState {
    this.state = resetSessionFromBeginning(this.state, options);
    return this.state;
  }

  public undo(): { state: GameState; restoredLabel?: string } {
    const res = undoLastAction(this.state);
    this.state = res.state;
    return res;
  }

  public serialize(): string {
    return serializeGameState(this.state);
  }

  public static deserialize(jsonString: string): {
    engine?: MarketEngine;
    state?: GameState;
    error?: string;
  } {
    const res = deserializeGameState(jsonString);
    if (res.error || !res.state) {
      return { error: res.error };
    }
    return {
      engine: new MarketEngine(res.state),
      state: res.state,
    };
  }
}
