export type PatternFamily =
  | 'seasonal_monthly'
  | 'numeric_month_rule'
  | 'linked_commodity'
  | 'neutral';

export type SeasonalPeak = 'winter' | 'spring' | 'summer' | 'autumn' | 'custom';

export type NumericMonthRule =
  | 'even_up_odd_down'
  | 'odd_up_even_down'
  | 'multiples_of_3'
  | 'multiples_of_4'
  | 'prime_months';

export type CorrelationDirection = 'direct' | 'inverse';

export type HorizonMode = '36_months' | 'unlimited';

export type SeasonalEventDirection = 'up' | 'down';

export interface DualCalendarInfo {
  monthIndex: number;
  gregorianMonth: number; // 1..12
  gregorianYear: number;
  gregorianMonthName: string;
  gregorianLabel: string;
  hijriMonth: number; // 1..12
  hijriYear: number;
  hijriMonthName: string;
  hijriLabel: string;
  shortLabel: string;
}

export interface HijriCommodityImpact {
  hijriMonth: number;
  hijriMonthName: string;
  commodityId: string;
  commodityName: string;
  impactPct: number; // signed ratio, e.g. 0.38 for +38%, -0.12 for -12%
  priceDelta: number; // signed SAR delta
  title: string;
  reason: string;
}

export interface SavedSessionSlot {
  id: string;
  label: string;
  savedAt: number;
  sessionName: string;
  monthNumber: number;
  gregorianLabel: string;
  hijriLabel: string;
  teamCount: number;
  leaderName: string;
  stateJson: string;
}

export interface SeasonalEventRecord {
  monthIndex: number; // 0-based: 2, 5, 8, 11... (Month 3, 6, 9, 12...)
  commodityId: string;
  commodityName: string;
  direction: SeasonalEventDirection;
  impactPct: number; // e.g. 0.50 for 50%
  priceDelta: number; // signed delta applied strictly to this commodity
  title: string;
  reason: string;
  description: string;
}

export interface ProductPatternConfig {
  pattern: Exclude<PatternFamily, 'neutral'>;
  seasonalPeak?: SeasonalPeak;
  /** Used when seasonalPeak === 'custom': 12 monthly prices (Month 1..Month 12 of the year) */
  customMonthlyPrices?: number[];
  numericRule?: NumericMonthRule;
  linkedCommodityId?: string;
  correlationDirection?: CorrelationDirection;
  lagMonths?: 0 | 1;
}

export type CommodityCategory =
  | 'fuel_energy'
  | 'food_livestock'
  | 'construction_realty'
  | 'tech_electronics';

export interface CommoditySpec {
  id: string;
  name: string;
  unit: string;
  category: CommodityCategory;
  basePrice: number;
  minPrice: number;
  maxPrice: number;
  amplitudeRatio: number;
  defaultPatternConfig: ProductPatternConfig;
}

export interface ActivePatternsConfig {
  seasonal_monthly: boolean;
  numeric_month_rule: boolean;
  linked_commodity: boolean;
}

export interface SessionConfig {
  sessionName: string;
  productCount: number; // 4..14
  volatilityMultiplier: number; // 0.5..2.0
  activePatterns: ActivePatternsConfig;
  productPatternConfigs: Record<string, ProductPatternConfig>;
  /** Custom pre-adoption monthly plan overrides: commodityId -> monthIndex (0-based) -> price */
  customPlanOverrides?: Record<string, Record<number, number>>;
  horizonMode: HorizonMode;
  seasonalEventsEnabled: boolean;
  seasonalEventImpactPct: number; // 0.10..0.70 (default 0.50)
  startYear: number;
  startMonth: number; // 1..12
  startHijriYear: number;
  startHijriMonth: number; // 1..12
  hijriEffectsEnabled: boolean;
  startingCash: number;
  secretReportCost: number;
  supplyDemandThreshold: number;
  supplyDemandStepPct: number;
  moderatorPin: string;
  seed: number;
  totalMonths: number; // 36 for 3-year plan (or initial generated block for unlimited)
}

export interface CommodityMarketSeries {
  commodityId: string;
  effectivePattern: PatternFamily;
  appliedPatternConfig: ProductPatternConfig;
  basePrices: number[];
  permanentOffsets: number[];
  supplyDemandMargins: number[];
  tempOverrides: Record<number, number>; // monthIndex -> manual temp price
}

export interface MarketState {
  activeCommodityIds: string[];
  seriesById: Record<string, CommodityMarketSeries>;
  currentMonthNetVolume: Record<string, number>;
  lastMonthDemandImpact: Record<string, number>;
  seasonalEvents: Record<number, SeasonalEventRecord>;
  hijriEffectsEnabled?: boolean;
  startYear?: number;
  startMonth?: number;
  startHijriYear?: number;
  startHijriMonth?: number;
}

export interface SecretHintRecord {
  id: string;
  commodityId: string;
  commodityName: string;
  monthIndex: number;
  text: string;
  cost: number;
}

export interface TradeLogEntry {
  id: string;
  monthIndex: number;
  teamId: string;
  teamName: string;
  commodityId: string;
  commodityName: string;
  quantity: number; // positive = buy, negative = sell
  unitPrice: number;
  totalAmount: number;
  timestamp: number;
}

export interface TeamState {
  id: string;
  name: string;
  cash: number;
  holdings: Record<string, number>;
  unlockedHints: SecretHintRecord[];
  netWorthHistory: number[];
}

export interface GameSnapshot {
  label: string;
  currentMonthIndex: number;
  isFinished: boolean;
  market: MarketState;
  teams: TeamState[];
  tradeLog: TradeLogEntry[];
}

export interface GameState {
  version: number;
  config: SessionConfig;
  currentMonthIndex: number; // 0-based (0 = Month 1)
  isFinished: boolean;
  market: MarketState;
  teams: TeamState[];
  tradeLog: TradeLogEntry[];
  undoStack: GameSnapshot[];
  lastSavedAt: number;
}

export interface TradeOrderItem {
  commodityId: string;
  quantity: number; // positive = buy, negative = sell
}

export interface TeamLeaderboardEntry {
  team: TeamState;
  assetsValue: number;
  netWorth: number;
  netWorthDelta: number;
  rank: number;
}
