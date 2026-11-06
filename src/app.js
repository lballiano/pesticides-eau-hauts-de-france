
const HDF_DEPARTMENTS = ['02', '59', '60', '62', '80'];
const GEO_CACHE_KEY = 'hdf-communes-contours-v2-postal';

const state = {
  data: null,
  molecule: null,
  year: null,
  scale: 'log',
  layerMode: 'measured',
  showThreshold: false,
  dataOnly: false,
  map: null,
  geoLayer: null,
  geojson: null,
  selectedPostal: null,
};

const el = {
  metrics: document.querySelector('#metrics'),
  molecule: document.querySelector('#moleculeSelect'),
  year: document.querySelector('#yearSelect'),
  layerMode: document.querySelector('#layerModeSelect'),
  scale: document.querySelector('#scaleSelect'),
  threshold: document.querySelector('#thresholdToggle'),
  dataOnly: document.querySelector('#dataOnlyToggle'),
  subtitle: document.querySelector('#subtitle'),
  legendMax: document.querySelector('#legendMax'),
  legendGradient: document.querySelector('.legend-gradient'),
  map: document.querySelector('#map'),
  mapStatus: document.querySelector('#mapStatus'),
  topList: document.querySelector('#topList'),
  departmentChart: document.querySelector('#departmentChart'),
  drawer: document.querySelector('#drawer'),
  drawerContent: document.querySelector('#drawerContent'),
  closeDrawer: document.querySelector('#closeDrawer'),
  downloadCsv: document.querySelector('#downloadCsv'),
  trendChart: document.querySelector('#trendChart'),
  trendSummary: document.querySelector('#trendSummary'),
  trendInsights: document.querySelector('#trendInsights'),
  trendBadge: document.querySelector('#trendBadge'),
  aiSummary: document.querySelector('#aiSummary'),
  aiPriorityList: document.querySelector('#aiPriorityList'),
};

const fmt = new Intl.NumberFormat('en-GB', {
  maximumFractionDigits: 3
});
const intFmt = new Intl.NumberFormat('en-GB');

function moleculeDisplayName(molecule) {
  return molecule === 'Pesticides totaux'
    ? 'Total pesticides'
    : molecule;
}

function thresholdFor(molecule) {
  if (molecule === 'Pesticides totaux') return 0.5;
  if (molecule === 'Chloridazone' || molecule === 'Bentazone') return 0.1;
  return 3;
}

function normalizePostal(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim().replace(/\.0$/, '');
  return text ? text.padStart(5, '0') : '';
}

function postalCode(row) {
  return normalizePostal(row.code_postal || row.postal_code);
}

function communesText(row) {
  const communes = Array.isArray(row.communes) ? row.communes : [];
  if (!communes.length) return row.commune || '—';
  return communes.length <= 3
    ? communes.join(', ')
    : `${communes.slice(0, 3).join(', ')} +${communes.length - 3}`;
}

function primaryCommuneText(row) {
  const communes = Array.isArray(row.communes) ? row.communes : [];
  if (communes.length) return communes[0];
  return row.commune || 'Municipality not specified';
}

function featurePostalCodes(feature) {
  const props = feature.properties || {};
  const values =
    props.codesPostaux ||
    props.codes_postaux ||
    props.codePostal ||
    props.code_postal ||
    [];
  const list = Array.isArray(values) ? values : [values];
  return list.map(normalizePostal).filter(Boolean);
}

function filteredRecords() {
  return state.data.records
    .filter(d =>
      d.molecule === state.molecule &&
      d.year === Number(state.year)
    )
    .map(d => ({ ...d, postal: postalCode(d) }));
}

function allRecordsForSelection() {
  return state.data.records
    .filter(d => d.molecule === state.molecule)
    .map(d => ({ ...d, postal: postalCode(d) }));
}

function recordsByPostal(records = filteredRecords()) {
  const byCode = new Map();

  for (const row of records) {
    const code = postalCode(row);
    const current = byCode.get(code);

    if (!current || row.max > current.max) {
      byCode.set(code, { ...row, postal: code });
    }
  }

  return byCode;
}

function recordForFeature(feature, byPostal = recordsByPostal()) {
  const candidates = featurePostalCodes(feature)
    .map(code => byPostal.get(code))
    .filter(Boolean);

  if (!candidates.length) return null;

  return candidates.sort(
    (a, b) => (b.max || 0) - (a.max || 0)
  )[0];
}

function maxValue(records = filteredRecords()) {
  return Math.max(
    0,
    ...records.map(d => Number(d.max) || 0)
  );
}

function colorFor(value, max) {
  if (!value || !max) return '#dbe1ea';

  let t = state.scale === 'linear'
    ? value / max
    : Math.log1p(value) / Math.log1p(max);

  t = Math.max(0, Math.min(1, t));

  const stops = [
    [236, 244, 255],
    [184, 209, 245],
    [112, 158, 222],
    [43, 94, 170],
  ];

  const scaled = t * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - idx;

  const rgb = stops[idx].map((c, i) =>
    Math.round(c + (stops[idx + 1][i] - c) * local)
  );

  return `rgb(${rgb.join(',')})`;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function slopeFor(rows) {
  if (rows.length < 2) return 0;

  const xs = rows.map(r => Number(r.year));
  const ys = rows.map(r => Number(r.max) || 0);

  const xMean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const yMean = ys.reduce((a, b) => a + b, 0) / ys.length;

  const num = xs.reduce(
    (sum, x, i) => sum + (x - xMean) * (ys[i] - yMean),
    0
  );

  const den = xs.reduce(
    (sum, x) => sum + (x - xMean) ** 2,
    0
  );

  return den ? num / den : 0;
}

// --------------------------------------------------
// AI monitoring priority scoring
// --------------------------------------------------

function aiPriorityForPostal(postal) {
  const code = normalizePostal(postal);

  const rows = allRecordsForSelection()
    .filter(d => d.postal === code)
    .sort((a, b) => a.year - b.year);

  if (!rows.length) return null;

  const threshold = thresholdFor(state.molecule);
  const selectedYear = Number(state.year);

  const pastRows = rows.filter(r => r.year <= selectedYear);
  const usableRows = pastRows.length ? pastRows : rows;

  const latest = usableRows[usableRows.length - 1];
  const latestMax = Number(latest.max) || 0;

  const historicalMax = Math.max(
    ...usableRows.map(r => Number(r.max) || 0)
  );

  const exceedYears = usableRows.filter(
    r => (Number(r.max) || 0) > threshold
  ).length;

  const exceedRate = exceedYears / usableRows.length;
  const slope = slopeFor(usableRows);

  const values = usableRows.map(r => Number(r.max) || 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;

  const variance = values.reduce(
    (sum, v) => sum + (v - mean) ** 2,
    0
  ) / values.length;

  const volatility = mean ? Math.sqrt(variance) / mean : 0;
  const agePenalty = Math.max(0, selectedYear - latest.year);
  const scarcity = usableRows.length < 3 ? 1 : 0;

  const proximityComponent = clamp(
    Math.max(latestMax, historicalMax * 0.75) / threshold,
    0,
    1.25
  ) / 1.25;

  const trendComponent = clamp(
    (slope * 4) / Math.max(threshold, 0.001),
    0,
    1
  );

  const volatilityComponent = clamp(
    volatility / 1.2,
    0,
    1
  );

  const uncertaintyComponent = clamp(
    (scarcity * 0.7) + (agePenalty * 0.15),
    0,
    1
  );

  const score = Math.round(
    (38 * proximityComponent) +
    (25 * exceedRate) +
    (22 * trendComponent) +
    (8 * volatilityComponent) +
    (7 * uncertaintyComponent)
  );

  let level = 'low';

  if (score >= 70) level = 'high';
  else if (score >= 40) level = 'moderate';

  const reasons = [];

  if (latestMax > threshold) {
    reasons.push('recent exceedance');
  } else if (historicalMax > threshold) {
    reasons.push('historical exceedance');
  }

  if (trendComponent > 0.35) {
    reasons.push('upward trend');
  }

  if (volatilityComponent > 0.45) {
    reasons.push('high variability');
  }

  if (uncertaintyComponent > 0.45) {
    reasons.push('limited or outdated data');
  }

  if (!reasons.length) {
    reasons.push('stable history or below reference level');
  }

  return {
    postal: code,
    score: clamp(score, 0, 100),
    level,
    latestYear: latest.year,
    latestMax,
    historicalMax,
    exceedYears,
    observedYears: usableRows.length,
    slope,
    reasons,
    communes: latest.communes || [],
    department: latest.department,
  };
}

function aiPriorityByPostal() {
  const postals = [
    ...new Set(
      allRecordsForSelection()
        .map(d => d.postal)
        .filter(Boolean)
    )
  ];

  const map = new Map();

  for (const postal of postals) {
    const risk = aiPriorityForPostal(postal);
    if (risk) map.set(postal, risk);
  }

  return map;
}

function aiRiskForFeature(
  feature,
  riskMap = aiPriorityByPostal()
) {
  const candidates = featurePostalCodes(feature)
    .map(code => riskMap.get(code))
    .filter(Boolean);

  if (!candidates.length) return null;

  return candidates.sort(
    (a, b) => b.score - a.score
  )[0];
}

function aiColorFor(score) {
  if (score === null || score === undefined) {
    return '#d4d8df';
  }

  const t = clamp(score / 100, 0, 1);

  const stops = [
    [237, 247, 237],
    [191, 220, 181],
    [249, 213, 146],
    [228, 132, 88],
    [155, 54, 73],
  ];

  const scaled = t * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const local = scaled - idx;

  const rgb = stops[idx].map((c, i) =>
    Math.round(c + (stops[idx + 1][i] - c) * local)
  );

  return `rgb(${rgb.join(',')})`;
}

// --------------------------------------------------
// AI priority panel
// --------------------------------------------------

function renderAiPanel() {
  if (!el.aiPriorityList) return;

  const risks = [...aiPriorityByPostal().values()]
    .sort((a, b) => b.score - a.score);

  const high = risks.filter(r => r.score >= 70).length;

  const moderate = risks.filter(
    r => r.score >= 40 && r.score < 70
  ).length;

  el.aiSummary.textContent =
    `${moleculeDisplayName(state.molecule)} · ` +
    `${risks.length} postal codes analyzed · ` +
    `${high} high priority · ` +
    `${moderate} moderate priority.`;

  const top = risks.slice(0, 8);

  if (!top.length) {
    el.aiPriorityList.innerHTML =
      '<p class="muted">Insufficient data to calculate an AI priority score.</p>';
    return;
  }

  el.aiPriorityList.innerHTML = top.map(r => `
    <button class="ai-item" data-postal="${r.postal}">
      <span class="ai-score">${r.score}</span>
      <span>
        <strong>${primaryCommuneText(r)}</strong>
        <small>
          Postal code ${r.postal} · priority ${r.level} ·
          ${r.reasons.join(', ')}
        </small>
      </span>
      <span class="pill ${r.score >= 70 ? 'danger' : ''}">
        ${fmt.format(r.latestMax)} µg/L
      </span>
    </button>
  `).join('');

  el.aiPriorityList.querySelectorAll('.ai-item').forEach(btn => {
    btn.addEventListener(
      'click',
      () => openDrawer(btn.dataset.postal)
    );
  });
}

// --------------------------------------------------
// Controls and metrics
// --------------------------------------------------

function renderControls() {
  el.molecule.innerHTML = state.data.summary.molecules
    .map(m => `
      <option value="${m}">${moleculeDisplayName(m)}</option>
    `)
    .join('');

  el.year.innerHTML = state.data.summary.years
    .map(y => `<option value="${y}">${y}</option>`)
    .join('');

  el.molecule.value = state.molecule;
  el.year.value = state.year;
}

function renderMetrics() {
  const rows = filteredRecords();
  const codesPostaux = new Set(rows.map(d => d.postal)).size;
  const max = maxValue(rows);
  const threshold = thresholdFor(state.molecule);

  const exceed = rows.filter(
    d => d.max > threshold
  ).length;

  const highAi = [...aiPriorityByPostal().values()]
    .filter(r => r.score >= 70).length;

  const cards = [
    [state.year, 'selected year'],
    [
      codesPostaux ? intFmt.format(codesPostaux) : '0',
      'postal codes with data'
    ],
    [
      `${fmt.format(max)} µg/L`,
      'maximum concentration'
    ],
    [
      intFmt.format(exceed),
      `measurements above ${fmt.format(threshold)} µg/L`
    ],
    [
      intFmt.format(highAi),
      'high AI priorities'
    ],
  ];

  el.metrics.innerHTML = cards.map(([value, label]) => `
    <article class="metric-card">
      <div class="metric-value">${value}</div>
      <div class="metric-label">${label}</div>
    </article>
  `).join('');
}

// --------------------------------------------------
// Map initialization and geographic data
// --------------------------------------------------

function initMap() {
  state.map = L.map(el.map, {
    zoomControl: false,
    attributionControl: false,
    scrollWheelZoom: true,
    minZoom: 7,
    maxZoom: 11,
  });

  L.control.zoom({
    position: 'bottomright'
  }).addTo(state.map);

  state.map.setView([50.25, 2.75], 8);
}

async function loadGeojson() {
  const cached = localStorage.getItem(GEO_CACHE_KEY);

  if (cached) return JSON.parse(cached);

  const collections = await Promise.all(
    HDF_DEPARTMENTS.map(async dep => {
      const url =
        `https://geo.api.gouv.fr/departements/${dep}/communes` +
        `?fields=code,nom,codeDepartement,codesPostaux,centre,contour` +
        `&format=geojson&geometry=contour`;

      const res = await fetch(url);

      if (!res.ok) {
        throw new Error(
          `Geo API error for department ${dep}`
        );
      }

      return res.json();
    })
  );

  const geojson = {
    type: 'FeatureCollection',
    features: collections.flatMap(c => c.features || []),
  };

  try {
    localStorage.setItem(
      GEO_CACHE_KEY,
      JSON.stringify(geojson)
    );
  } catch (_) {}

  return geojson;
}

// --------------------------------------------------
// Map styling
// --------------------------------------------------

function styleFeature(feature) {
  const byPostal = recordsByPostal();
  const row = recordForFeature(feature, byPostal);

  const max = maxValue();
  const threshold = thresholdFor(state.molecule);

  const hasData = Boolean(row);
  const exceed = hasData && row.max > threshold;

  if (state.layerMode === 'ai') {
    const risk = aiRiskForFeature(feature);
    const hasRisk = Boolean(risk);

    return {
      color: risk?.score >= 70
        ? '#ffffff'
        : 'rgba(255,255,255,.55)',

      weight: risk?.score >= 70 ? 1.7 : 0.55,

      fillColor: hasRisk
        ? aiColorFor(risk.score)
        : '#d4d8df',

      fillOpacity: hasRisk
        ? 0.9
        : (state.dataOnly ? 0.02 : 0.38),

      opacity: hasRisk || !state.dataOnly ? 1 : 0.05,
    };
  }

  return {
    color: exceed && state.showThreshold
      ? '#ffffff'
      : 'rgba(255,255,255,.55)',

    weight: exceed && state.showThreshold
      ? 1.6
      : 0.55,

    fillColor: hasData
      ? colorFor(row.max, max)
      : '#d4d8df',

    fillOpacity: hasData
      ? 0.92
      : (state.dataOnly ? 0.02 : 0.42),

    opacity: hasData || !state.dataOnly ? 1 : 0.05,
  };
}

// --------------------------------------------------
// Map interactions and tooltips
// --------------------------------------------------

function bindFeature(feature, layer) {
  layer.on({
    mouseover: e => {
      e.target.setStyle({
        weight: 2.2,
        color: '#111827'
      });

      const row = recordForFeature(feature);
      const html = tooltipHtml(feature, row);

      layer.bindTooltip(html, {
        sticky: true,
        direction: 'top',
        opacity: 0.96
      }).openTooltip();
    },

    mouseout: e => {
      if (state.geoLayer) {
        state.geoLayer.resetStyle(e.target);
      }
    },

    click: () => {
      if (state.layerMode === 'ai') {
        const risk = aiRiskForFeature(feature);

        openDrawer(
          risk ? risk.postal : featurePostalCodes(feature)[0],
          feature.properties.nom
        );

        return;
      }

      const row = recordForFeature(feature);

      openDrawer(
        row ? row.postal : featurePostalCodes(feature)[0],
        feature.properties.nom
      );
    },
  });
}

function tooltipHtml(feature, row) {
  if (state.layerMode === 'ai') {
    const risk = aiRiskForFeature(feature);

    if (!risk) {
      return `
        <strong>${feature.properties.nom}</strong>
        <br>
        <span>No AI data available</span>
      `;
    }

    const badge = risk.score >= 70
      ? '<span class="tooltip-badge">high priority</span>'
      : '';

    return `
      <strong>${feature.properties.nom}</strong>${badge}
      <br>
      ${moleculeDisplayName(state.molecule)} · AI priority
      <br>
      <b>score ${risk.score}/100</b> · ${risk.level}
      <br>
      <span>
        postal code ${risk.postal} · ${risk.reasons.join(', ')}
      </span>
    `;
  }

  if (!row) {
    return `
      <strong>${feature.properties.nom}</strong>
      <br>
      <span>No measurements in ${state.year}</span>
    `;
  }

  const threshold = thresholdFor(state.molecule);

  const badge = row.max > threshold
    ? '<span class="tooltip-badge">exceedance</span>'
    : '';

  return `
    <strong>${feature.properties.nom}</strong>${badge}
    <br>
    ${moleculeDisplayName(state.molecule)} · ${state.year}
    <br>
    <b>${fmt.format(row.max)} µg/L</b> max
    <br>
    <span>
      postal code ${row.postal} ·
      source municipalities: ${communesText(row)} ·
      dept. ${row.department}
    </span>
  `;
}

// --------------------------------------------------
// Render map
// --------------------------------------------------

function renderMap() {
  if (!state.geojson || !state.map) return;

  const rows = filteredRecords();
  const max = maxValue(rows);
  const threshold = thresholdFor(state.molecule);

  el.legendMax.textContent = state.layerMode === 'ai'
    ? 'score 100'
    : `${fmt.format(max)} µg/L`;

  el.legendGradient.classList.toggle(
    'ai-gradient',
    state.layerMode === 'ai'
  );

  el.subtitle.textContent = state.layerMode === 'ai'
    ? `${moleculeDisplayName(state.molecule)} · explainable AI layer · monitoring priority by postal code`
    : `${moleculeDisplayName(state.molecule)} · ${state.year} · ${rows.length} records aggregated by postal code · reference ${fmt.format(threshold)} µg/L`;

  if (state.geoLayer) {
    state.geoLayer.remove();
  }

  state.geoLayer = L.geoJSON(state.geojson, {
    style: styleFeature,
    onEachFeature: bindFeature,
  }).addTo(state.map);

  try {
    state.map.fitBounds(
      state.geoLayer.getBounds(),
      { padding: [12, 12] }
    );
  } catch (_) {}
}

// --------------------------------------------------
// Highest concentrations
// --------------------------------------------------

function renderTopList() {
  const threshold = thresholdFor(state.molecule);

  const rows = [...recordsByPostal().values()]
    .sort((a, b) => b.max - a.max)
    .slice(0, 10);

  if (!rows.length) {
    el.topList.innerHTML =
      '<p class="muted">No data available for this selection.</p>';
    return;
  }

  el.topList.innerHTML = rows.map((r, i) => `
    <button class="top-item" data-postal="${r.postal}">
      <span class="rank">${i + 1}</span>

      <span>
        <strong>${primaryCommuneText(r)}</strong>
        <small>
          Postal code ${r.postal} · dept. ${r.department}
        </small>
      </span>

      <span class="pill ${r.max > threshold ? 'danger' : ''}">
        ${fmt.format(r.max)}
      </span>
    </button>
  `).join('');

  el.topList.querySelectorAll('.top-item').forEach(btn => {
    btn.addEventListener(
      'click',
      () => openDrawer(btn.dataset.postal)
    );
  });
}

// --------------------------------------------------
// Department comparison
// --------------------------------------------------

function renderDepartmentChart() {
  const threshold = thresholdFor(state.molecule);
  const rows = filteredRecords();
  const byDept = new Map();

  for (const r of rows) {
    const cur = byDept.get(r.department) || {
      department: r.department,
      max: 0,
      count: 0,
      exceed: 0
    };

    cur.max = Math.max(cur.max, r.max || 0);
    cur.count += 1;

    if (r.max > threshold) {
      cur.exceed += 1;
    }

    byDept.set(r.department, cur);
  }

  const values = [...byDept.values()]
    .sort((a, b) => b.max - a.max);

  const top = Math.max(
    0,
    ...values.map(v => v.max)
  );

  el.departmentChart.innerHTML = values.map(v => `
    <div class="department-row">
      <strong>${v.department}</strong>

      <div class="bar-track">
        <div
          class="bar"
          style="width:${top ? Math.max(3, (v.max / top) * 100) : 0}%"
        ></div>
      </div>

      <span>${fmt.format(v.max)}</span>

      <small>
        ${v.exceed} above the reference level ·
        ${v.count} records
      </small>
    </div>
  `).join('');
}

// --------------------------------------------------
// Municipality detail drawer
// --------------------------------------------------

function openDrawer(postal, fallbackName = '') {
  const code = normalizePostal(postal);

  const rows = allRecordsForSelection()
    .filter(d => d.postal === code)
    .sort((a, b) =>
      b.year - a.year || b.max - a.max
    );

  const yearRow = rows.find(
    d => d.year === Number(state.year)
  );

  const displayName = yearRow
    ? primaryCommuneText(yearRow)
    : (fallbackName || `Postal code ${code || '—'}`);

  const threshold = thresholdFor(state.molecule);
  const aiRisk = aiPriorityForPostal(code);

  el.drawerContent.innerHTML = `
    <h3>${displayName}</h3>

    <p class="drawer-subtitle">
      Postal code ${code} · aggregated by postal code ·
      ${moleculeDisplayName(state.molecule)}
    </p>

    ${yearRow ? `
      <div class="highlight-card">
        <span class="card-label">${state.year}</span>
        <strong>${fmt.format(yearRow.max)} µg/L</strong>
        <small>
          max · average ${fmt.format(yearRow.avg || 0)} µg/L ·
          ${yearRow.count} sample(s)
        </small>
      </div>
    ` : `
      <p class="muted">
        No measurements available for ${state.year}.
      </p>
    `}

    <div class="pill ${yearRow?.max > threshold ? 'danger' : ''}">
      reference ${fmt.format(threshold)} µg/L
    </div>

    ${aiRisk ? `
      <div class="ai-drawer-card">
        <span class="card-label">AI Analysis</span>

        <strong>
          Priority: ${aiRisk.level} · score ${aiRisk.score}/100
        </strong>

        <small>
          ${aiRisk.reasons.join(', ')} ·
          ${aiRisk.observedYears} year(s) with observations
        </small>
      </div>
    ` : ''}

    <h4>Measurement history</h4>

    ${rows.length ? `
      <div class="mini-trend">
        ${rows
          .slice()
          .sort((a, b) => a.year - b.year)
          .map(r => `
            <span
              title="${r.year} · ${fmt.format(r.max)} µg/L"
              style="height:${Math.max(
                8,
                Math.min(
                  100,
                  (r.max / Math.max(
                    ...rows.map(x => x.max || 0),
                    0.001
                  )) * 100
                )
              )}%"
            ></span>
          `)
          .join('')}
      </div>
    ` : ''}

    ${rows.length ? rows.map(r => `
      <div class="detail-row">
        <strong>${r.year}</strong>
        <span>${fmt.format(r.max)} µg/L max</span>
        <small>
          ${communesText(r)} ·
          dept. ${r.department} ·
          ${r.count} measurement(s)
        </small>
      </div>
    `).join('') : `
      <p class="muted">No local details available.</p>
    `}
  `;

  el.drawer.classList.add('open');
}

// --------------------------------------------------
// Time-series calculations
// --------------------------------------------------

function yearlyTrend() {
  const rows = allRecordsForSelection();
  const byYear = new Map();

  for (const r of rows) {
    const cur = byYear.get(r.year) || {
      year: r.year,
      max: 0,
      weightedSum: 0,
      samples: 0,
      codesPostaux: new Set(),
      exceed: 0
    };

    cur.max = Math.max(
      cur.max,
      Number(r.max) || 0
    );

    const count = Number(r.count) || 1;

    cur.weightedSum += (Number(r.avg) || 0) * count;
    cur.samples += count;
    cur.codesPostaux.add(r.postal);

    if (
      (Number(r.max) || 0) >
      thresholdFor(state.molecule)
    ) {
      cur.exceed += 1;
    }

    byYear.set(r.year, cur);
  }

  return [...byYear.values()]
    .sort((a, b) => a.year - b.year)
    .map(d => ({
      ...d,
      avg: d.samples
        ? d.weightedSum / d.samples
        : 0,
      postalCount: d.codesPostaux.size,
    }));
}

function trendSentence(first, last) {
  if (!first || !last) {
    return 'Not enough data to interpret the trend.';
  }

  const delta = last.max - first.max;
  const pct = first.max
    ? (delta / first.max) * 100
    : null;

  if (Math.abs(delta) < 0.001) {
    return 'The maximum concentration remains broadly stable over the available period.';
  }

  const direction = delta > 0
    ? 'increased'
    : 'decreased';

  const pctText = pct === null
    ? ''
    : ` (${pct > 0 ? '+' : ''}${fmt.format(pct)} %)`;

  return `The maximum concentration ${direction} between ${first.year} and ${last.year}${pctText}.`;
}

// --------------------------------------------------
// Render time-series chart
// --------------------------------------------------

function renderTrend() {
  if (!el.trendChart) return;

  const trend = yearlyTrend();

  if (!trend.length) {
    el.trendChart.innerHTML =
      '<p class="muted">No time-series data available for this molecule.</p>';

    el.trendSummary.textContent =
      'No trend can be calculated.';

    el.trendInsights.innerHTML = '';
    return;
  }

  const width = 860;
  const height = 280;

  const pad = {
    top: 26,
    right: 28,
    bottom: 44,
    left: 58
  };

  const maxY = Math.max(
    ...trend.map(d => d.max),
    0.01
  );

  const minYear = Math.min(
    ...trend.map(d => d.year)
  );

  const maxYear = Math.max(
    ...trend.map(d => d.year)
  );

  const x = year =>
    pad.left +
    ((year - minYear) / Math.max(1, maxYear - minYear)) *
    (width - pad.left - pad.right);

  const y = value =>
    height -
    pad.bottom -
    (value / maxY) *
    (height - pad.top - pad.bottom);

  const points = trend
    .map(d => `${x(d.year)},${y(d.max)}`)
    .join(' ');

  const avgPoints = trend
    .map(d => `${x(d.year)},${y(d.avg)}`)
    .join(' ');

  const threshold = thresholdFor(state.molecule);
  const thresholdY = y(Math.min(threshold, maxY));

  const yTicks = [
    0,
    maxY / 2,
    maxY
  ];

  const first = trend[0];
  const last = trend[trend.length - 1];

  const peak = trend.reduce(
    (a, b) => b.max > a.max ? b : a,
    trend[0]
  );

  el.trendBadge.textContent =
    `${minYear}–${maxYear}`;

  el.trendSummary.textContent =
    `${moleculeDisplayName(state.molecule)} · ` +
    `${trend.length} years of data available. ` +
    `${trendSentence(first, last)}`;

  el.trendChart.innerHTML = `
    <svg
      viewBox="0 0 ${width} ${height}"
      role="img"
      aria-label="Annual concentration trends"
    >
      <line
        x1="${pad.left}"
        y1="${height - pad.bottom}"
        x2="${width - pad.right}"
        y2="${height - pad.bottom}"
        class="axis"
      />

      <line
        x1="${pad.left}"
        y1="${pad.top}"
        x2="${pad.left}"
        y2="${height - pad.bottom}"
        class="axis"
      />

      ${yTicks.map(t => `
        <g>
          <line
            x1="${pad.left}"
            y1="${y(t)}"
            x2="${width - pad.right}"
            y2="${y(t)}"
            class="grid"
          />
          <text
            x="${pad.left - 10}"
            y="${y(t) + 4}"
            text-anchor="end"
          >
            ${fmt.format(t)}
          </text>
        </g>
      `).join('')}

      ${threshold <= maxY ? `
        <line
          x1="${pad.left}"
          y1="${thresholdY}"
          x2="${width - pad.right}"
          y2="${thresholdY}"
          class="threshold-line"
        />
        <text
          x="${width - pad.right}"
          y="${thresholdY - 6}"
          text-anchor="end"
          class="threshold-text"
        >
          ref. ${fmt.format(threshold)} µg/L
        </text>
      ` : ''}

      <polyline
        points="${avgPoints}"
        class="avg-line"
      />

      <polyline
        points="${points}"
        class="max-line"
      />

      ${trend.map(d => `
        <g class="dot-group">
          <circle
            cx="${x(d.year)}"
            cy="${y(d.max)}"
            r="5"
            class="dot"
          >
            <title>
              ${d.year} ·
              max ${fmt.format(d.max)} µg/L ·
              average ${fmt.format(d.avg)} µg/L ·
              ${d.postalCount} postal codes
            </title>
          </circle>

          <text
            x="${x(d.year)}"
            y="${height - 16}"
            text-anchor="middle"
          >
            ${d.year}
          </text>
        </g>
      `).join('')}
    </svg>
  `;

  el.trendInsights.innerHTML = `
    <article>
      <strong>${fmt.format(peak.max)} µg/L</strong>
      <span>regional peak in ${peak.year}</span>
    </article>

    <article>
      <strong>${fmt.format(last.avg)} µg/L</strong>
      <span>weighted average in ${last.year}</span>
    </article>

    <article>
      <strong>${intFmt.format(last.postalCount)}</strong>
      <span>postal codes monitored in ${last.year}</span>
    </article>

    <article>
      <strong>${intFmt.format(last.exceed)}</strong>
      <span>
        records above the reference level in ${last.year}
      </span>
    </article>
  `;
}

// --------------------------------------------------
// CSV export
// --------------------------------------------------

function downloadCsv() {
  const rows = filteredRecords()
    .sort((a, b) => b.max - a.max);

  const headers = [
    'molecule',
    'year',
    'code_postal',
    'department',
    'communes',
    'max_ug_l',
    'avg_ug_l',
    'sample_count'
  ];

  const csv = [
    headers.join(','),
    ...rows.map(r => [
      r.molecule,
      r.year,
      r.postal,
      r.department,
      `"${communesText(r).replaceAll('"', '""')}"`,
      r.max,
      r.avg,
      r.count,
    ].join(','))
  ].join('\n');

  const blob = new Blob(
    ['\ufeff' + csv],
    { type: 'text/csv;charset=utf-8' }
  );

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;

  a.download =
    `${state.year}-` +
    `${state.molecule.toLowerCase().replaceAll(' ', '-').replaceAll('/', '-')}` +
    `-code-postal.csv`;

  a.click();
  URL.revokeObjectURL(url);
}

// --------------------------------------------------
// Update all visualizations
// --------------------------------------------------

function renderAll() {
  renderMetrics();
  renderMap();
  renderTopList();
  renderDepartmentChart();
  renderTrend();
  renderAiPanel();
}

// --------------------------------------------------
// Event listeners
// --------------------------------------------------

el.molecule.addEventListener('change', e => {
  state.molecule = e.target.value;
  renderAll();
});

el.layerMode.addEventListener('change', e => {
  state.layerMode = e.target.value;
  renderAll();
});

el.year.addEventListener('change', e => {
  state.year = Number(e.target.value);
  renderAll();
});

el.scale.addEventListener('change', e => {
  state.scale = e.target.value;
  renderAll();
});

el.threshold.addEventListener('change', e => {
  state.showThreshold = e.target.checked;
  renderAll();
});

el.dataOnly.addEventListener('change', e => {
  state.dataOnly = e.target.checked;
  renderAll();
});

el.closeDrawer.addEventListener('click', () => {
  el.drawer.classList.remove('open');
});

el.downloadCsv.addEventListener('click', downloadCsv);

// --------------------------------------------------
// Application initialization
// --------------------------------------------------

autoInit();

async function autoInit() {
  const res = await fetch('./data/pesticides.json');

  state.data = await res.json();

  state.molecule = state.data.summary.molecules.includes(
    'Chloridazone desphenyl'
  )
    ? 'Chloridazone desphenyl'
    : state.data.summary.molecules[0];

  state.year = Math.max(
    ...state.data.summary.years
  );

  renderControls();
  initMap();
  renderMetrics();
  renderTopList();
  renderDepartmentChart();
  renderTrend();
  renderAiPanel();

  try {
    state.geojson = await loadGeojson();

    el.mapStatus.hidden = true;

    renderMap();
  } catch (error) {
    console.error(error);

    el.mapStatus.innerHTML =
      `Local measurement data has loaded, but municipality ` +
      `boundaries could not be retrieved. ` +
      `Check your internet connection and try again.`;
  }
}
