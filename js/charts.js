/* ===== charts.js — 圖表層：純 SVG 繪製 ===== */
'use strict';

const MozeCharts = (() => {
  const COLORS = MozeData.CHART_COLORS;
  const NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  }

  function clearSVG(container) {
    if (!container) return null;
    container.innerHTML = '';
    return container;
  }

  function resolveDonutSize(container, opts = {}) {
    const base = opts.size || 220;
    const maxSize = opts.maxSize || 320;
    const minSize = opts.minSize || 220;
    const containerWidth = container && container.clientWidth ? container.clientWidth : 0;
    if (!containerWidth) return Math.max(minSize, Math.min(base, maxSize));
    return Math.max(minSize, Math.min(containerWidth - 24, maxSize));
  }

  function renderEmptyDonut(container, opts = {}) {
    const size = resolveDonutSize(container, opts);
    const cx = size / 2, cy = size / 2;
    const outerR = size / 2 - 10;
    const innerR = outerR * 0.6;
    const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, container);
    svg.style.pointerEvents = 'none';

    el('circle', {
      cx, cy, r: outerR,
      fill: 'none',
      stroke: 'rgba(255,255,255,.18)',
      'stroke-width': outerR - innerR
    }, svg);
    el('circle', {
      cx, cy, r: innerR - 1,
      fill: 'rgba(255,255,255,.05)'
    }, svg);

    el('text', { x: cx, y: cy - 6, fill: '#a5a7b1', 'font-size': '14', 'text-anchor': 'middle' }, svg).textContent = opts.centerLabel || '合計';
    el('text', { x: cx, y: cy + 14, fill: '#707382', 'font-size': '16', 'font-weight': 'bold', 'text-anchor': 'middle' }, svg).textContent = '$0';

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = '<span class="legend-dot" style="background:rgba(255,255,255,.14)"></span><span class="legend-label">目前沒有資料</span><span class="legend-value">$0 (0.0%)</span>';
    legend.appendChild(item);
    container.appendChild(legend);
  }

  /* ===== 1. 圓環圖 ===== */
  function donut(container, data, opts = {}) {
    if (!clearSVG(container)) return;
    if (!data.length) {
      renderEmptyDonut(container, opts);
      return;
    }

    const size = resolveDonutSize(container, opts);
    const cx = size / 2, cy = size / 2;
    const outerR = size / 2 - 10;
    const innerR = outerR * 0.6;
    const total = data.reduce((s, d) => s + d.amount, 0) || 1;
    const svg = el('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}` }, container);
    svg.style.pointerEvents = 'none';

    if (data.length === 1 || data[0].amount / total >= 0.9999) {
      el('circle', {
        cx, cy, r: (outerR + innerR) / 2,
        fill: 'none',
        stroke: COLORS[0],
        'stroke-width': outerR - innerR,
      }, svg);
      el('circle', {
        cx, cy, r: innerR - 1,
        fill: 'rgba(15,16,20,.88)'
      }, svg);
    } else {
      let startAngle = -Math.PI / 2;
      data.forEach((d, i) => {
        const pct = d.amount / total;
        const angle = pct * 2 * Math.PI;
        const endAngle = startAngle + angle;
        const largeArc = angle > Math.PI ? 1 : 0;
        const x1o = cx + outerR * Math.cos(startAngle);
        const y1o = cy + outerR * Math.sin(startAngle);
        const x2o = cx + outerR * Math.cos(endAngle);
        const y2o = cy + outerR * Math.sin(endAngle);
        const x1i = cx + innerR * Math.cos(endAngle);
        const y1i = cy + innerR * Math.sin(endAngle);
        const x2i = cx + innerR * Math.cos(startAngle);
        const y2i = cy + innerR * Math.sin(startAngle);
        const path = `M${x1o},${y1o} A${outerR},${outerR} 0 ${largeArc} 1 ${x2o},${y2o} L${x1i},${y1i} A${innerR},${innerR} 0 ${largeArc} 0 ${x2i},${y2i} Z`;
        el('path', {
          d: path,
          fill: COLORS[i % COLORS.length],
          opacity: '0.98',
          stroke: 'rgba(15,16,20,.88)',
          'stroke-width': 2
        }, svg);
        startAngle = endAngle;
      });
    }

    el('text', { x: cx, y: cy - 6, fill: '#fff', 'font-size': '14', 'text-anchor': 'middle' }, svg).textContent = opts.centerLabel || '合計';
    el('text', { x: cx, y: cy + 14, fill: '#f6c342', 'font-size': '16', 'font-weight': 'bold', 'text-anchor': 'middle' }, svg).textContent = MozeData.formatMoney(total);

    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    data.forEach((d, i) => {
      const item = document.createElement('div');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-dot" style="background:${COLORS[i % COLORS.length]}"></span>
        <span class="legend-label">${d.icon || ''}${d.name}</span>
        <span class="legend-value">${MozeData.formatMoney(d.amount)} (${(d.pct * 100).toFixed(1)}%)</span>`;
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  /* ===== 2. 橫向長條圖 ===== */
  function horizontalBars(container, data, opts = {}) {
    if (!clearSVG(container)) return;
    if (!data.length) { container.innerHTML = '<p style="color:#888;text-align:center">無資料</p>'; return; }

    const maxVal = Math.max(...data.map(d => d.amount)) || 1;
    const barH = 28, gap = 8, labelW = 100, valueW = 80;
    const chartW = opts.width || 500;
    const barArea = chartW - labelW - valueW - 20;
    const h = data.length * (barH + gap) + gap;

    const svg = el('svg', { width: '100%', height: h, viewBox: `0 0 ${chartW} ${h}` }, container);
    svg.style.pointerEvents = 'none';
    svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');

    data.forEach((d, i) => {
      const y = gap + i * (barH + gap);
      const w = (d.amount / maxVal) * barArea;
      el('text', { x: labelW - 8, y: y + barH / 2 + 4, fill: '#ccc', 'font-size': '12', 'text-anchor': 'end' }, svg).textContent = `${d.icon || ''}${d.name}`;
      el('rect', { x: labelW, y: y, width: Math.max(2, w), height: barH, rx: 4, fill: COLORS[i % COLORS.length], opacity: '0.85' }, svg);
      el('text', { x: labelW + Math.max(2, w) + 6, y: y + barH / 2 + 4, fill: '#aaa', 'font-size': '11' }, svg).textContent = MozeData.formatMoney(d.amount);
    });
  }

  /* ===== 3. 直條圖 ===== */
  function verticalBars(container, data, opts = {}) {
    if (!clearSVG(container)) return;
    if (!data.length) { container.innerHTML = '<p style="color:#888;text-align:center">無資料</p>'; return; }

    const W = opts.width || 500, H = opts.height || 220;
    const padL = 50, padR = 10, padT = 20, padB = 50;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const maxVal = Math.max(...data.map(d => d.amount)) || 1;
    const barW = Math.min(40, (chartW / data.length) * 0.6);
    const gap = chartW / data.length;

    const svg = el('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMinYMin meet' }, container);
    svg.style.pointerEvents = 'none';

    el('line', { x1: padL, y1: padT, x2: padL, y2: padT + chartH, stroke: '#444', 'stroke-width': 1 }, svg);
    el('line', { x1: padL, y1: padT + chartH, x2: padL + chartW, y2: padT + chartH, stroke: '#444', 'stroke-width': 1 }, svg);

    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH - (i / 4) * chartH;
      el('line', { x1: padL, y1: y, x2: padL + chartW, y2: y, stroke: '#333', 'stroke-width': 0.5 }, svg);
      el('text', { x: padL - 6, y: y + 4, fill: '#888', 'font-size': '10', 'text-anchor': 'end' }, svg).textContent = MozeData.formatMoney((maxVal * i / 4));
    }

    data.forEach((d, i) => {
      const x = padL + i * gap + (gap - barW) / 2;
      const h = (d.amount / maxVal) * chartH;
      const y = padT + chartH - h;
      el('rect', { x, y, width: barW, height: Math.max(1, h), rx: 3, fill: COLORS[i % COLORS.length], opacity: '0.85' }, svg);
      const label = el('text', { x: x + barW / 2, y: padT + chartH + 16, fill: '#aaa', 'font-size': '10', 'text-anchor': 'middle' }, svg);
      label.textContent = d.label || d.name || '';
    });
  }

  /* ===== 4. 折線圖（含面積填色） ===== */
  function lineChart(container, points, opts = {}) {
    if (!clearSVG(container)) return;
    if (!points.length) { container.innerHTML = '<p style="color:#888;text-align:center">無資料</p>'; return; }

    const W = opts.width || 500, H = opts.height || 200;
    const padL = 55, padR = 15, padT = 15, padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const vals = points.map(p => p.value);
    const maxV = Math.max(...vals, 1);
    const minV = Math.min(...vals, 0);
    const range = maxV - minV || 1;
    const color = opts.color || '#4fc3f7';

    const svg = el('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMinYMin meet' }, container);
    svg.style.pointerEvents = 'none';

    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH - (i / 4) * chartH;
      el('line', { x1: padL, y1: y, x2: padL + chartW, y2: y, stroke: '#333', 'stroke-width': 0.5 }, svg);
      const v = minV + (range * i / 4);
      el('text', { x: padL - 6, y: y + 4, fill: '#888', 'font-size': '10', 'text-anchor': 'end' }, svg).textContent = MozeData.formatMoney(v);
    }

    const coords = points.map((p, i) => {
      const x = padL + (i / Math.max(1, points.length - 1)) * chartW;
      const y = padT + chartH - ((p.value - minV) / range) * chartH;
      return { x, y };
    });

    const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
    const areaD = pathD + ` L${coords[coords.length - 1].x},${padT + chartH} L${coords[0].x},${padT + chartH} Z`;

    const gradId = 'grad-' + Math.random().toString(36).slice(2, 6);
    const defs = el('defs', {}, svg);
    const grad = el('linearGradient', { id: gradId, x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': '0.4' }, grad);
    el('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': '0.02' }, grad);

    el('path', { d: areaD, fill: `url(#${gradId})` }, svg);
    el('path', { d: pathD, fill: 'none', stroke: color, 'stroke-width': 2 }, svg);

    coords.forEach((c, i) => {
      el('circle', { cx: c.x, cy: c.y, r: 2.5, fill: color }, svg);
    });

    const step = Math.max(1, Math.floor(points.length / 6));
    points.forEach((p, i) => {
      if (i % step === 0 || i === points.length - 1) {
        const x = coords[i].x;
        const label = p.label || p.date || '';
        el('text', { x, y: padT + chartH + 16, fill: '#888', 'font-size': '9', 'text-anchor': 'middle' }, svg).textContent = label.slice(5);
      }
    });
  }

  /* ===== 5. 組合走勢圖（直條 + 折線） ===== */
  function comboChart(container, dayData, opts = {}) {
    if (!clearSVG(container)) return;
    if (!dayData.length) { container.innerHTML = '<p style="color:#888;text-align:center">無資料</p>'; return; }

    const W = opts.width || 600, H = opts.height || 250;
    const padL = 58, padR = 58, padT = 15, padB = 40;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;

    const expenses = dayData.map(d => d.expense || 0);
    const cumVals = dayData.map(d => d.cumulative || 0);
    const maxExp = Math.max(...expenses, 1);
    const allVals = [...cumVals];
    const maxCum = Math.max(...allVals, 1);
    const minCum = Math.min(...allVals, 0);
    const cumRange = maxCum - minCum || 1;

    const svg = el('svg', { width: '100%', height: H, viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMinYMin meet' }, container);
    svg.style.pointerEvents = 'none';

    for (let i = 0; i <= 4; i++) {
      const y = padT + chartH - (i / 4) * chartH;
      el('line', { x1: padL, y1: y, x2: padL + chartW, y2: y, stroke: '#333', 'stroke-width': 0.5 }, svg);
      el('text', {
        x: padL - 8,
        y: y + 4,
        fill: '#888',
        'font-size': '10',
        'text-anchor': 'end'
      }, svg).textContent = MozeData.formatMoney(maxExp * i / 4);
      el('text', {
        x: padL + chartW + 8,
        y: y + 4,
        fill: '#888',
        'font-size': '10',
        'text-anchor': 'start'
      }, svg).textContent = MozeData.formatMoney(minCum + (cumRange * i / 4));
    }

    el('line', { x1: padL, y1: padT, x2: padL, y2: padT + chartH, stroke: '#444', 'stroke-width': 1 }, svg);
    el('line', { x1: padL + chartW, y1: padT, x2: padL + chartW, y2: padT + chartH, stroke: '#444', 'stroke-width': 1 }, svg);
    el('line', { x1: padL, y1: padT + chartH, x2: padL + chartW, y2: padT + chartH, stroke: '#444', 'stroke-width': 1 }, svg);

    const n = dayData.length;
    const barW = Math.max(2, chartW / n * 0.6);
    const gap = chartW / n;

    dayData.forEach((d, i) => {
      const x = padL + i * gap + (gap - barW) / 2;
      const h = (d.expense / maxExp) * chartH;
      const y = padT + chartH - h;
      el('rect', { x, y, width: barW, height: Math.max(0, h), fill: '#f6c342', opacity: '0.7', rx: 1 }, svg);
    });

    const coords = dayData.map((d, i) => {
      const x = padL + i * gap + gap / 2;
      const y = padT + chartH - ((d.cumulative - minCum) / cumRange) * chartH;
      return { x, y };
    });

    if (coords.length > 1) {
      const pathD = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
      el('path', { d: pathD, fill: 'none', stroke: '#4fc3f7', 'stroke-width': 2 }, svg);
      coords.forEach(c => el('circle', { cx: c.x, cy: c.y, r: 2, fill: '#4fc3f7' }, svg));
    }

    const step = Math.max(1, Math.floor(n / 8));
    dayData.forEach((d, i) => {
      if (i % step === 0 || i === n - 1) {
        const x = padL + i * gap + gap / 2;
        el('text', { x, y: padT + chartH + 16, fill: '#888', 'font-size': '9', 'text-anchor': 'middle' }, svg).textContent = (d.date || '').slice(5);
      }
    });

    const legendDiv = document.createElement('div');
    legendDiv.style.cssText = 'display:flex;gap:16px;justify-content:center;margin-top:4px;font-size:12px;color:#aaa';
    legendDiv.innerHTML = '<span><span style="display:inline-block;width:10px;height:10px;background:#f6c342;border-radius:2px;margin-right:4px"></span>每日支出</span><span><span style="display:inline-block;width:10px;height:3px;background:#4fc3f7;border-radius:2px;margin-right:4px;vertical-align:middle"></span>累計淨額</span>';
    container.appendChild(legendDiv);
  }

  /* ===== 6. 帳戶餘額趨勢折線圖 ===== */
  function accountTrend(container, balData, opts = {}) {
    const points = balData.map(d => ({ date: d.date, label: d.date, value: d.balance }));
    lineChart(container, points, { ...opts, color: opts.color || '#81c784' });
  }

  /* ===== 7. 月份橫向長條 ===== */
  function monthlyBars(container, monthData, opts = {}) {
    if (!clearSVG(container)) return;
    if (!monthData.length) { container.innerHTML = '<p style="color:#888;text-align:center">無資料</p>'; return; }

    const maxVal = Math.max(...monthData.map(d => d.amount)) || 1;
    const barH = 26, gap = 6, labelW = 70, valueW = 80;
    const chartW = opts.width || 500;
    const barArea = chartW - labelW - valueW - 20;
    const h = monthData.length * (barH + gap) + gap;

    const svg = el('svg', { width: '100%', height: h, viewBox: `0 0 ${chartW} ${h}`, preserveAspectRatio: 'xMinYMin meet' }, container);
    svg.style.pointerEvents = 'none';

    monthData.forEach((d, i) => {
      const y = gap + i * (barH + gap);
      const w = (d.amount / maxVal) * barArea;
      el('text', { x: labelW - 8, y: y + barH / 2 + 4, fill: '#ccc', 'font-size': '11', 'text-anchor': 'end' }, svg).textContent = d.month;
      el('rect', { x: labelW, y: y, width: Math.max(2, w), height: barH, rx: 4, fill: COLORS[i % COLORS.length], opacity: '0.8' }, svg);
      el('text', { x: labelW + Math.max(2, w) + 6, y: y + barH / 2 + 4, fill: '#aaa', 'font-size': '11' }, svg).textContent = MozeData.formatMoney(d.amount);
    });
  }

  return { donut, horizontalBars, verticalBars, lineChart, comboChart, accountTrend, monthlyBars };
})();
