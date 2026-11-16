/**
 * Renders a crisp SVG progressive line chart strictly covering Months 1..currentMonth.
 * Zero future data is ever plotted.
 */
export function renderProgressiveChartSvg(
  prices: number[],
  commodityName: string,
  unit: string,
  monthLabels?: string[]
): string {
  const width = 640;
  const height = 210;
  const padLeft = 50;
  const padRight = 24;
  const padTop = 20;
  const padBottom = 32;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const minVal = Math.min(...prices);
  const maxVal = Math.max(...prices);
  const spread = Math.max(10, maxVal - minVal);
  const yMin = Math.max(0, Math.floor(minVal - spread * 0.15));
  const yMax = Math.ceil(maxVal + spread * 0.15);
  const yRange = Math.max(1, yMax - yMin);

  const count = prices.length;
  const xFor = (idx: number) =>
    count <= 1
      ? padLeft + plotW / 2
      : padLeft + (idx / (count - 1)) * plotW;
  const yFor = (val: number) =>
    padTop + plotH - ((val - yMin) / yRange) * plotH;

  const points = prices.map((p, i) => ({
    x: Math.round(xFor(i) * 10) / 10,
    y: Math.round(yFor(p) * 10) / 10,
    val: p,
    month: i + 1,
    dateLabel: monthLabels?.[i] ?? '',
  }));

  const linePath = points
    .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`)
    .join(' ');

  const areaPath =
    points.length > 1
      ? `${linePath} L ${points[points.length - 1].x} ${padTop + plotH} L ${points[0].x} ${padTop + plotH} Z`
      : '';

  // 4 horizontal gridlines
  const gridLines = [0, 0.33, 0.66, 1]
    .map((t) => {
      const val = Math.round(yMin + t * yRange);
      const y = Math.round(yFor(val) * 10) / 10;
      return `
        <line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="rgba(245, 240, 230, 0.08)" stroke-dasharray="3 3" />
        <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" fill="#9ca3af" font-size="11" font-family="IBM Plex Mono, monospace">${val}</text>
      `;
    })
    .join('');

  // X-axis month markers (up to ~9 evenly spaced ticks)
  const step = Math.max(1, Math.ceil(count / 9));
  const xLabels = points
    .filter((_, i) => i === 0 || i === count - 1 || i % step === 0)
    .map(
      (pt) =>
        `<text x="${pt.x}" y="${height - 10}" text-anchor="middle" fill="#9ca3af" font-size="11" font-family="IBM Plex Mono, monospace">M${pt.month}</text>`
    )
    .join('');

  const dots = points
    .map((pt, i) => {
      const isLast = i === points.length - 1;
      const titleSuffix = pt.dateLabel ? ` (${pt.dateLabel})` : '';
      return `
        <g>
          <title>الشهر ${pt.month}${titleSuffix}: ${pt.val} ر.س (${unit})</title>
          <circle cx="${pt.x}" cy="${pt.y}" r="${isLast ? 5.5 : 3.5}" fill="${isLast ? '#d4a853' : '#f5f0e6'}" stroke="#0d0f14" stroke-width="1.5" />
          ${
            isLast
              ? `<text x="${pt.x}" y="${Math.max(14, pt.y - 10)}" text-anchor="middle" fill="#d4a853" font-size="12" font-weight="700" font-family="IBM Plex Mono, monospace">${pt.val}</text>`
              : ''
          }
        </g>
      `;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-48 select-none" role="img" aria-label="الرسم البياني لسعر ${commodityName} حتى الشهر ${count}">
      <defs>
        <linearGradient id="chartGoldFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#d4a853" stop-opacity="0.28" />
          <stop offset="100%" stop-color="#d4a853" stop-opacity="0.01" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${areaPath ? `<path d="${areaPath}" fill="url(#chartGoldFill)" />` : ''}
      ${
        points.length > 1
          ? `<path d="${linePath}" fill="none" stroke="#d4a853" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />`
          : ''
      }
      ${xLabels}
      ${dots}
    </svg>
  `;
}
