import {
  CommodityCategory,
  CommoditySpec,
  CorrelationDirection,
  NumericMonthRule,
  PatternFamily,
  ProductPatternConfig,
  SeasonalPeak,
  SessionConfig,
} from './types';

export const TOTAL_MONTHS = 36;
export const STORAGE_KEY = 'burr_exchange_state_v2';
export const SAVED_SESSIONS_STORAGE_KEY = 'burr_exchange_saved_slots_v1';

export const GREGORIAN_MONTH_NAMES = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

export const HIJRI_MONTH_NAMES = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
] as const;

export interface HijriEffectRule {
  commodityId: string;
  impactPct: number;
  title: string;
  reason: string;
}

/**
 * Hijri-calendar seasonal multipliers (1-based Hijri month -> affected products).
 * E.g., Sha'ban pantry prep, Ramadan surge on Dates/Coffee/Flour/Poultry/Rice,
 * Shawwal Eid gifts (Mobile) & post-Ramadan dates dip, Dhu al-Hijjah Hajj/Adha surge on Livestock & Gasoline.
 */
export const HIJRI_MONTH_EFFECTS: Record<number, HijriEffectRule[]> = {
  1: [
    {
      commodityId: 'real_estate',
      impactPct: 0.1,
      title: 'افتتاح العام الهجري الجديد',
      reason: 'بداية السنة الهجرية وتجديد العقود والصفقات العقارية السنوية.',
    },
  ],
  8: [
    {
      commodityId: 'dates',
      impactPct: 0.15,
      title: 'تموين ما قبل رمضان (شعبان)',
      reason: 'بدء تجهيز موائد الضيافة وتخزين التمور استعداداً لشهر رمضان المبارك.',
    },
    {
      commodityId: 'flour',
      impactPct: 0.1,
      title: 'استعدادات المخابز في شعبان',
      reason: 'ارتفاع طلب المطابخ والمخابز على الطحين قبل حلول شهر رمضان.',
    },
  ],
  9: [
    {
      commodityId: 'dates',
      impactPct: 0.38,
      title: 'ذروة موسم التمور في رمضان',
      reason: 'إقبال هائل على التمور لموائد الإفطار والضيافة والصدقات طوال شهر رمضان المبارك.',
    },
    {
      commodityId: 'coffee',
      impactPct: 0.18,
      title: 'انتعاش ليالي السمر الرمضانية',
      reason: 'ارتفاع استهلاك القهوة في المجالس والخيام والزيارات الليلية خلال رمضان.',
    },
    {
      commodityId: 'flour',
      impactPct: 0.15,
      title: 'ذروة المخبوزات واللقيمات الرمضانية',
      reason: 'زيادة الاستهلاك المنزلي والمطاعم من الدقيق في المأكولات الرمضانية.',
    },
    {
      commodityId: 'poultry',
      impactPct: 0.15,
      title: 'ارتفاع طلب موائد الإفطار',
      reason: 'زيادة سحب المطابخ والمخيمات لصناديق الدواجن في الولائم الرمضانية.',
    },
    {
      commodityId: 'rice',
      impactPct: 0.12,
      title: 'توسع ولائم الإفطار والسحور',
      reason: 'زيادة الطلب على خياش الرز لتغطية موائد الإفطار والضيافة.',
    },
  ],
  10: [
    {
      commodityId: 'mobile',
      impactPct: 0.2,
      title: 'موسم عيد الفطر والهدايا (شوال)',
      reason: 'انتعاش شراء الجوالات كهدايا وعيديات مع إجازة عيد الفطر السعيد.',
    },
    {
      commodityId: 'coffee',
      impactPct: 0.12,
      title: 'ضيافة عيد الفطر والاجتماعات',
      reason: 'استمرار الإقبال على القهوة العربية في معايدات وزيارات شهر شوال.',
    },
    {
      commodityId: 'dates',
      impactPct: -0.12,
      title: 'تراجع الطلب بعد رمضان (شوال)',
      reason: 'هدوء الإقبال على التمر وعودة الاستهلاك لمستواه الطبيعي بعد انقضاء رمضان.',
    },
  ],
  12: [
    {
      commodityId: 'livestock',
      impactPct: 0.35,
      title: 'موسم الأضاحي والهدي (ذو الحجة)',
      reason: 'قفزة استثنائية في طلب المواشي والأغنام لتلبية الأضاحي والهدي وولائم العيد.',
    },
    {
      commodityId: 'gasoline',
      impactPct: 0.16,
      title: 'ذروة السفر والرحلات في ذو الحجة',
      reason: 'كثافة التنقلات والرحلات البرية خلال موسم الحج وإجازة عيد الأضحى.',
    },
  ],
};

export const CATEGORY_LABELS: Record<CommodityCategory, string> = {
  fuel_energy: 'الطاقة والوقود',
  food_livestock: 'الأغذية والمواشي',
  construction_realty: 'البناء والعقار',
  tech_electronics: 'التقنية واللوازم',
};

export const PATTERN_LABELS: Record<PatternFamily, string> = {
  seasonal_monthly: 'النمط الأول: موسمي فصلي (تغير شهري)',
  numeric_month_rule: 'النمط الثاني: قاعدة رقم الشهر (زوجي/فردي/مضاعفات/أولي)',
  linked_commodity: 'النمط الثالث: ارتباط بمنتج آخر (طردي/عكسي)',
  neutral: 'حركة سوق متوازنة',
};

export const PATTERN_SHORT_LABELS: Record<Exclude<PatternFamily, 'neutral'>, string> = {
  seasonal_monthly: 'نمط 1 · موسمي فصلي',
  numeric_month_rule: 'نمط 2 · قاعدة رقم الشهر',
  linked_commodity: 'نمط 3 · مرتبط بمنتج',
};

export const PATTERN_DESCRIPTIONS: Record<Exclude<PatternFamily, 'neutral'>, string> = {
  seasonal_monthly: 'يرتفع وينخفض حسب فصول السنة الأربعة ولكن التغير يتم شهرياً بانتظام.',
  numeric_month_rule:
    'يتغير حسب رقم الشهر: زوجي/فردي، مضاعفات 3 أو 4، أو يزيد في الأشهر ذات الأعداد الأولية.',
  linked_commodity: 'حركته مرتبطة بمنتج آخر بشكل طردي (معه) أو عكسي (ضده).',
};

export const SEASONAL_PEAK_LABELS: Record<SeasonalPeak, string> = {
  winter: 'ذروة الشتاء (شهور 12، 1، 2)',
  spring: 'ذروة الربيع (شهور 3، 4، 5)',
  summer: 'ذروة الصيف (شهور 6، 7، 8)',
  autumn: 'ذروة الخريف (شهور 9، 10، 11)',
  custom: 'أخرى (تقسيم الأسعار لكل شهر ش1–ش12)',
};

export const NUMERIC_RULE_LABELS: Record<NumericMonthRule, string> = {
  even_up_odd_down: 'يزيد في الزوجي وينخفض في الفردي',
  odd_up_even_down: 'يزيد في الفردي وينخفض في الزوجي',
  multiples_of_3: 'يزيد في مضاعفات 3 (3، 6، 9، 12...)',
  multiples_of_4: 'يزيد في مضاعفات 4 (4، 8، 12، 16...)',
  prime_months: 'يزيد في الأشهر الأولية (2، 3، 5، 7، 11، 13...)',
};

export const CORRELATION_LABELS: Record<CorrelationDirection, string> = {
  direct: 'طردي (يرتفع بارتفاعه)',
  inverse: 'عكسي (يرتفع بانخفاضه)',
};

export function buildDefaultCustomMonthlyPrices(basePrice: number): number[] {
  const arr: number[] = [];
  for (let m = 0; m < 12; m++) {
    const wave = Math.cos((2 * Math.PI * m) / 12) * 0.22;
    arr.push(Math.max(1, Math.round(basePrice * (1 + wave))));
  }
  return arr;
}

/**
 * Exact 14 commodities requested by user, spanning all 3 pattern families and sub-rules.
 */
export const COMMODITIES_CATALOG: CommoditySpec[] = [
  {
    id: 'firewood',
    name: 'حطب',
    unit: 'حزمة',
    category: 'fuel_energy',
    basePrice: 95,
    minPrice: 40,
    maxPrice: 195,
    amplitudeRatio: 0.42,
    defaultPatternConfig: {
      pattern: 'seasonal_monthly',
      seasonalPeak: 'winter',
    },
  },
  {
    id: 'dates',
    name: 'تمر',
    unit: 'كيلو',
    category: 'food_livestock',
    basePrice: 75,
    minPrice: 35,
    maxPrice: 150,
    amplitudeRatio: 0.36,
    defaultPatternConfig: {
      pattern: 'seasonal_monthly',
      seasonalPeak: 'autumn',
    },
  },
  {
    id: 'mobile',
    name: 'جوال',
    unit: 'جهاز',
    category: 'tech_electronics',
    basePrice: 1200,
    minPrice: 680,
    maxPrice: 1980,
    amplitudeRatio: 0.28,
    defaultPatternConfig: {
      pattern: 'numeric_month_rule',
      numericRule: 'multiples_of_4',
    },
  },
  {
    id: 'coffee',
    name: 'قهوة',
    unit: 'خيشة',
    category: 'food_livestock',
    basePrice: 110,
    minPrice: 55,
    maxPrice: 215,
    amplitudeRatio: 0.3,
    defaultPatternConfig: {
      pattern: 'numeric_month_rule',
      numericRule: 'odd_up_even_down',
    },
  },
  {
    id: 'flour',
    name: 'طحين',
    unit: 'كيس',
    category: 'food_livestock',
    basePrice: 48,
    minPrice: 22,
    maxPrice: 100,
    amplitudeRatio: 0.32,
    defaultPatternConfig: {
      pattern: 'numeric_month_rule',
      numericRule: 'even_up_odd_down',
    },
  },
  {
    id: 'livestock',
    name: 'غنم',
    unit: 'رأس',
    category: 'food_livestock',
    basePrice: 850,
    minPrice: 480,
    maxPrice: 1480,
    amplitudeRatio: 0.34,
    defaultPatternConfig: {
      pattern: 'seasonal_monthly',
      seasonalPeak: 'spring',
    },
  },
  {
    id: 'rice',
    name: 'رز',
    unit: 'خيشة',
    category: 'food_livestock',
    basePrice: 140,
    minPrice: 72,
    maxPrice: 260,
    amplitudeRatio: 0.32,
    defaultPatternConfig: {
      pattern: 'linked_commodity',
      linkedCommodityId: 'flour',
      correlationDirection: 'direct',
      lagMonths: 0,
    },
  },
  {
    id: 'solar_panels',
    name: 'الواح طاقة شمسية',
    unit: 'لوح',
    category: 'fuel_energy',
    basePrice: 640,
    minPrice: 320,
    maxPrice: 1180,
    amplitudeRatio: 0.38,
    defaultPatternConfig: {
      pattern: 'seasonal_monthly',
      seasonalPeak: 'summer',
    },
  },
  {
    id: 'gasoline',
    name: 'بنزين',
    unit: 'جركل',
    category: 'fuel_energy',
    basePrice: 62,
    minPrice: 26,
    maxPrice: 130,
    amplitudeRatio: 0.4,
    defaultPatternConfig: {
      pattern: 'linked_commodity',
      linkedCommodityId: 'solar_panels',
      correlationDirection: 'inverse',
      lagMonths: 0,
    },
  },
  {
    id: 'steel',
    name: 'حديد',
    unit: 'طن',
    category: 'construction_realty',
    basePrice: 320,
    minPrice: 165,
    maxPrice: 580,
    amplitudeRatio: 0.34,
    defaultPatternConfig: {
      pattern: 'numeric_month_rule',
      numericRule: 'prime_months',
    },
  },
  {
    id: 'cement',
    name: 'اسمنت',
    unit: 'كيس',
    category: 'construction_realty',
    basePrice: 85,
    minPrice: 40,
    maxPrice: 165,
    amplitudeRatio: 0.34,
    defaultPatternConfig: {
      pattern: 'linked_commodity',
      linkedCommodityId: 'steel',
      correlationDirection: 'direct',
      lagMonths: 0,
    },
  },
  {
    id: 'real_estate',
    name: 'عقارات',
    unit: 'سهم',
    category: 'construction_realty',
    basePrice: 1500,
    minPrice: 820,
    maxPrice: 2650,
    amplitudeRatio: 0.3,
    defaultPatternConfig: {
      pattern: 'linked_commodity',
      linkedCommodityId: 'cement',
      correlationDirection: 'direct',
      lagMonths: 1,
    },
  },
  {
    id: 'poultry',
    name: 'دواجن',
    unit: 'صندوق',
    category: 'food_livestock',
    basePrice: 56,
    minPrice: 26,
    maxPrice: 115,
    amplitudeRatio: 0.34,
    defaultPatternConfig: {
      pattern: 'numeric_month_rule',
      numericRule: 'multiples_of_3',
    },
  },
  {
    id: 'gas',
    name: 'غاز',
    unit: 'أسطوانة',
    category: 'fuel_energy',
    basePrice: 52,
    minPrice: 22,
    maxPrice: 108,
    amplitudeRatio: 0.38,
    defaultPatternConfig: {
      pattern: 'linked_commodity',
      linkedCommodityId: 'firewood',
      correlationDirection: 'inverse',
      lagMonths: 0,
    },
  },
];

export function buildDefaultProductPatternConfigs(): Record<string, ProductPatternConfig> {
  const map: Record<string, ProductPatternConfig> = {};
  for (const spec of COMMODITIES_CATALOG) {
    map[spec.id] = {
      ...spec.defaultPatternConfig,
      customMonthlyPrices: buildDefaultCustomMonthlyPrices(spec.basePrice),
    };
  }
  return map;
}

export const SEASONAL_EVENT_TEMPLATES: Record<
  string,
  {
    up: { title: string; reason: string; description: string };
    down: { title: string; reason: string; description: string };
  }
> = {
  firewood: {
    up: {
      title: 'عاصفة شتوية وموجة صقيع قاسية',
      reason: 'انخفاض درجات الحرارة بشكل مفاجئ أدى لتدافع المتنزهين وأصحاب المخيمات على شراء الحطب للتدفئة.',
      description: 'موجة صقيع ترفع الطلب على التدفئة وتدفع سعر الحطب للصعود بقوة.',
    },
    down: {
      title: 'موجة دفء مبكرة ووفرة حطب مستورد',
      reason: 'اعتدال الأجواء قبل موعده مع دخول كميات كبيرة من الحطب المستورد تسبب بتكدس المعروض.',
      description: 'تراجع الحاجة للتدفئة وزيادة المعروض يخفضان سعر الحطب هذا الشهر.',
    },
  },
  dates: {
    up: {
      title: 'مهرجانات الضيافة وتأخر قوافل التوريد',
      reason: 'إقامة فعاليات ومناسبات كبرى مع تعثر النقل من المزارع أدى لشح التمور الفاخرة في السوق.',
      description: 'زيادة الطلب في المجالس والفعاليات ترفع سعر التمر بشكل حاد.',
    },
    down: {
      title: 'طفرة حصاد غير مسبوقة وفائض في الأسواق',
      reason: 'تزامن جني المحصول في معظم المزارع أدى لإغراق السوق بكميات تفوق الاستهلاك.',
      description: 'تدفق المحصول الجديد بكثافة يهبط بسعر التمر هذا الشهر.',
    },
  },
  mobile: {
    up: {
      title: 'أزمة رقائق عالمية وتعطل سلاسل الشحن',
      reason: 'نقص أشباه الموصلات وتأخر الشحنات البحرية أحدث فجوة في معروض الأجهزة الذكية.',
      description: 'شح الأجهزة الجديدة في المتاجر يقفز بسعر الجوالات.',
    },
    down: {
      title: 'إطلاق جيل جديد وتصفية شاملة للمخزون',
      reason: 'طرح الشركات الموديلات الأحدث دفع التجار لإعلان خصومات كبرى لتصريف الجوالات الحالية.',
      description: 'منافسة التخفيضات وتصفيات السوق تضغط على سعر الجوال للانخفاض.',
    },
  },
  coffee: {
    up: {
      title: 'جفاف في مناطق زراعة البن وتأخر الموانئ',
      reason: 'تضرر محاصيل البن العالمية وبطء التخليص الجمركي قلّصا الكميات المتاحة في الأسواق.',
      description: 'نقص حبوب البن مع نشاط مجالس السمر يرفع سعر القهوة بقوة.',
    },
    down: {
      title: 'وصول بواخر استيراد ضخمة ومنافسة الموردين',
      reason: 'تكدس شحنات البن الواردة في المستودعات دفع التجار لخفض الأسعار لتسريع البيع.',
      description: 'وفرة خياش القهوة في الأسواق تخفض سعرها هذا الشهر.',
    },
  },
  flour: {
    up: {
      title: 'أزمة في إمدادات القمح وتكاليف المطاحن',
      reason: 'ارتفاع تكاليف استيراد القمح وصعوبة الشحن أثقلا تكلفة الإنتاج لدى المطاحن.',
      description: 'ضغط الإمدادات الغذائية يرفع سعر كيس الطحين بشكل ملحوظ.',
    },
    down: {
      title: 'دعم تمويني وموسم حصاد قمح قياسي',
      reason: 'طرح احتياطيات إضافية من الحبوب بعد موسم حصاد وفير غطّى احتياجات السوق بالكامل.',
      description: 'زيادة المعروض من الدقيق تؤدي لانخفاض حاد في سعر الطحين.',
    },
  },
  livestock: {
    up: {
      title: 'موسم الولائم والمناسبات الكبرى وشح المراعي',
      reason: 'تضاعف الطلب على الذبائح للولائم والمناسبات تزامن مع قلة المواشي الجاهزة للبيع.',
      description: 'إقبال متسارع في سوق المواشي يرفع سعر رأس الغنم بقوة.',
    },
    down: {
      title: 'انتشار مرض الجرب بين المواشي',
      reason: 'تفشي مرض الجرب بين قطعان المواشي في المراعي والحظائر أدى لعزوف المشترين وتراجع الطلب بشدة.',
      description: 'انتشار مرض الجرب بين المواشي يهوي بأسعار الغنم هذا الشهر.',
    },
  },
  rice: {
    up: {
      title: 'قيود تصدير عالمية على الأرز وارتفاع أجور الشحن',
      reason: 'قرارات الحد من التصدير في الدول المنتجة للأرز خلقت ندرة مؤقتة في الأسواق المحلية.',
      description: 'نقص المعروض من خياش الرز وزيادة تكلفة الشحن يرفعان السعر.',
    },
    down: {
      title: 'فك تكدس الموانئ وتدفق شحنات الأرز المؤجلة',
      reason: 'وصول شحنات متعددة متأخرة في وقت واحد أحدث فائضاً كبيراً لدى تجار الجملة.',
      description: 'كثرة المعروض وتنافس التجار يخفضان سعر الرز هذا الشهر.',
    },
  },
  solar_panels: {
    up: {
      title: 'توسع تجهيز المخيمات بالطاقة النظيفة وشح الألواح',
      reason: 'تحول واسع لتشغيل الفعاليات بالطاقة الشمسية استنفد المخزون المتاح من الألواح.',
      description: 'الطلب المتسارع على الطاقة الشمسية يقفز بسعر اللوح.',
    },
    down: {
      title: 'اختراق تقني ودخول ألواح اقتصادية عالية الكفاءة',
      reason: 'طرح جيل جديد بتكلفة تصنيع أقل أجبر التجار على خفض أسعار الألواح المتوفرة.',
      description: 'توفر بدائل أرخص وأعلى كفاءة يخفض سعر ألواح الطاقة الشمسية.',
    },
  },
  gasoline: {
    up: {
      title: 'أزمة عالمية في أسعار النفط',
      reason: 'اضطرابات حادة في أسواق النفط العالمية وتوقف بعض خطوط الإمداد رفعا تكلفة الوقود عالمياً.',
      description: 'أزمة عالمية في أسعار النفط تقفز بسعر البنزين بشكل حاد.',
    },
    down: {
      title: 'وفرة إنتاج النفط الخام وتراجع تكاليف التكرير',
      reason: 'زيادة الضخ في الأسواق العالمية مع هدوء حركة الرحلات خفّضا تكلفة الوقود.',
      description: 'انحسار تكلفة الخام ووفرة الإمدادات يخفضان سعر البنزين.',
    },
  },
  steel: {
    up: {
      title: 'طفرة مشاريع كبرى وارتفاع خام الحديد عالمياً',
      reason: 'انطلاق حملات تجهيز مواقع الفعاليات والمظلات بالتوازي مع غلاء خام الحديد المستورد.',
      description: 'تضاعف السحب الإنشائي يرفع سعر طن الحديد بقوة.',
    },
    down: {
      title: 'تباطؤ البناء وإغراق السوق بالحديد المستورد',
      reason: 'تأجيل مشاريع عمرانية مع تدفق كميات مستوردة منخفضة التكلفة ضغطا على الأسعار.',
      description: 'ركود السحب ووفرة الحديد يهبطان بالسعر هذا الشهر.',
    },
  },
  cement: {
    up: {
      title: 'توقف صيانة طارئ في مصانع الأسمنت الرئيسية',
      reason: 'أعمال الصيانة المفاجئة في خطوط الإنتاج قلّصت التوريد اليومي مع استمرار أعمال البناء.',
      description: 'نقص الإنتاج المباشر يرفع سعر كيس الأسمنت.',
    },
    down: {
      title: 'افتتاح مصانع جديدة وزيادة الطاقة الإنتاجية',
      reason: 'بدء تشغيل خطوط إنتاج إضافية رفع المعروض في المستودعات وأشعل المنافسة.',
      description: 'فائض إنتاج الأسمنت يخفض أسعاره في السوق.',
    },
  },
  real_estate: {
    up: {
      title: 'اعتماد مناطق سياحية وبرية استثمارية كبرى',
      reason: 'الإعلان عن تطوير طرق ومرافق للفعاليات والمخيمات رفع جاذبية وتقييم العقارات.',
      description: 'إقبال استثماري واسع يدفع أسعار الأسهم العقارية للصعود.',
    },
    down: {
      title: 'تشديد التمويل وموجة بيع لجني الأرباح',
      reason: 'ارتفاع تكلفة التمويل واتجاه المستثمرين لتسييل المحافظ ضغطا على القيمة السوقية.',
      description: 'عمليات جني الأرباح تهبط بأسعار العقارات هذا الشهر.',
    },
  },
  poultry: {
    up: {
      title: 'غلاء الأعلاف المستوردة وتراجع إنتاج المزارع',
      reason: 'ارتفاع تكلفة الأعلاف مع موجة حر أثرت في الإنتاج قلّلا توريد الدواجن للمطابخ والمخيمات.',
      description: 'انخفاض الإمدادات يرفع سعر صندوق الدواجن بشكل حاد.',
    },
    down: {
      title: 'طفرة إنتاج محلية وعروض تصريف مبردة',
      reason: 'دخول مزارع جديدة بطاقة كاملة أحدث وفرة يومية كبيرة في الدواجن الطازجة.',
      description: 'وفرة الإنتاج المحلي تخفض سعر الدواجن هذا الشهر.',
    },
  },
  gas: {
    up: {
      title: 'أزمة محطات التعبئة وذروة طلب التخييم',
      reason: 'ازدحام محطات التعبئة وإقبال المخيمات على التدفئة والطبخ رفعا الطلب على الأسطوانات.',
      description: 'الضغط على التوزيع يرفع سعر أسطوانة الغاز.',
    },
    down: {
      title: 'توسعة شبكة التوزيع وتوافر فائض الأسطوانات',
      reason: 'تشغيل مراكز تعبئة جديدة غطى كامل الاحتياج وزاد المخزون لدى الموزعين.',
      description: 'انتظام الإمدادات يخفض سعر أسطوانة الغاز هذا الشهر.',
    },
  },
};

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  sessionName: 'كشتة الربع — الموسم الأول',
  productCount: COMMODITIES_CATALOG.length,
  volatilityMultiplier: 1.0,
  activePatterns: {
    seasonal_monthly: true,
    numeric_month_rule: true,
    linked_commodity: true,
  },
  productPatternConfigs: buildDefaultProductPatternConfigs(),
  customPlanOverrides: {},
  horizonMode: '36_months',
  seasonalEventsEnabled: true,
  seasonalEventImpactPct: 0.5,
  startYear: 2026,
  startMonth: 11,
  startHijriYear: 1448,
  startHijriMonth: 6,
  hijriEffectsEnabled: true,
  startingCash: 5000,
  secretReportCost: 500,
  supplyDemandThreshold: 10,
  supplyDemandStepPct: 0.08,
  moderatorPin: '',
  seed: 202611,
  totalMonths: TOTAL_MONTHS,
};

export const DEFAULT_TEAM_NAMES = [
  'فريق السمر',
  'فريق الشهباء',
  'فريق النسيم',
  'فريق القمرية',
  'فريق الصقور',
  'فريق الرمال',
];
