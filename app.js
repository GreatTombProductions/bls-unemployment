(function() {
    'use strict';

    const $ = s => document.querySelector(s);
    const $$ = s => document.querySelectorAll(s);
    const BASE = 'data/';
    const GEOCODE_URL = 'https://nominatim.openstreetmap.org/search';

    let reference = null;       // national + state reference
    let stateIndex = null;      // list of all states
    const searchCache = {};     // letter → index entries
    const detailCache = {};     // fips → detail
    const stateCache = {};      // state_abbr → {counties, state_rate}
    let proximityData = [];     // [{f, n, s, lat, lng, r}]
    let currentView = 'intro';
    let currentResults = [];

    // ── Init ──
    async function init() {
        try {
            const [refResp, stResp] = await Promise.all([
                fetch(BASE + 'reference.json'),
                fetch(BASE + 'states.json')
            ]);
            reference = await refResp.json();
            stateIndex = await stResp.json();
            renderIntro();
            populateStates();
            loadProximity();
        } catch (e) {
            console.error('Init error:', e);
        }

        // Tab switching
        $$('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.tab').forEach(t => t.classList.remove('active'));
                $$('.search-panel').forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                $(`#${tab.dataset.tab}-search`).classList.add('active');
                showIntro();
            });
        });

        // County name search
        let debounce;
        $('#search-input').addEventListener('input', e => {
            clearTimeout(debounce);
            debounce = setTimeout(() => searchCounty(e.target.value.trim()), 200);
        });

        // State select
        $('#state-select').addEventListener('change', e => {
            if (e.target.value) {
                loadState(e.target.value);
            } else {
                showIntro();
            }
        });

        // Nearby search
        $('#nearby-btn').addEventListener('click', searchNearby);
        $('#addr-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') searchNearby();
        });

        // Back button
        $('#back-btn').addEventListener('click', () => {
            $('#detail').classList.add('hidden');
            if (currentView === 'state' && $('#state-select').value) {
                $('#state-results').classList.remove('hidden');
            } else if (currentView === 'nearby') {
                $('#nearby-results').classList.remove('hidden');
            } else {
                $('#search-results').classList.remove('hidden');
            }
            window.scrollTo(0, 0);
        });
    }

    // ── Load proximity data ──
    async function loadProximity() {
        try {
            const resp = await fetch(BASE + 'proximity.json');
            proximityData = await resp.json();
        } catch (e) { /* non-critical */ }
    }

    // ── Render intro stats ──
    function renderIntro() {
        if (!reference) return;
        const el = $('#intro-stats');
        el.innerHTML = `
            <div class="hero-stat">
                <span class="hero-number">${reference.national_rate}%</span>
                <span class="hero-label">US Unemployment Rate</span>
                <span class="hero-date">${reference.latest_month}</span>
            </div>
            <p class="hero-desc">Search county unemployment rates, browse by state, or find rates near any address.</p>
        `;
    }

    function showIntro() {
        $('#intro').classList.remove('hidden');
        $('#detail').classList.add('hidden');
        $('#search-results').innerHTML = '';
        $('#state-results').innerHTML = '';
        $('#nearby-results').innerHTML = '';
        currentView = 'intro';
    }

    // ── Populate state dropdown ──
    function populateStates() {
        if (!stateIndex) return;
        const select = $('#state-select');
        stateIndex.forEach(st => {
            const opt = document.createElement('option');
            opt.value = st.a;
            opt.textContent = `${st.n} (${st.c} counties, ${st.r != null ? st.r + '%' : 'N/A'})`;
            select.appendChild(opt);
        });
    }

    // ── County name search ──
    async function searchCounty(query) {
        if (query.length < 2) {
            $('#search-results').innerHTML = '';
            if (query.length === 0) showIntro();
            return;
        }

        const letter = query[0].toLowerCase();
        const shardKey = /^[a-z]$/.test(letter) ? letter : 'other';

        // Load index shard if not cached
        if (!searchCache[shardKey]) {
            try {
                const resp = await fetch(`${BASE}index-${shardKey}.json`);
                searchCache[shardKey] = await resp.json();
            } catch (e) {
                $('#search-results').innerHTML = '<p class="no-results">No data available.</p>';
                return;
            }
        }

        const entries = searchCache[shardKey];
        const q = query.toLowerCase();
        const matches = entries.filter(e =>
            e.n.toLowerCase().includes(q) || e.s.toLowerCase() === q
        ).slice(0, 50);

        currentResults = matches;
        currentView = 'name';
        renderCountyList(matches, $('#search-results'));
        $('#intro').classList.add('hidden');
    }

    // ── State browse ──
    async function loadState(abbr) {
        if (!stateCache[abbr]) {
            try {
                const resp = await fetch(`${BASE}states/${abbr}.json`);
                stateCache[abbr] = await resp.json();
            } catch (e) {
                $('#state-results').innerHTML = '<p class="no-results">No data available for this state.</p>';
                return;
            }
        }

        const st = stateCache[abbr];
        currentResults = st.county_data;
        currentView = 'state';

        let html = `<h3>${st.name}</h3>`;
        if (st.state_rate != null) {
            html += `<p class="state-rate">State unemployment rate: <strong>${st.state_rate}%</strong> (${st.latest_month})</p>`;
        }
        html += renderCountyTable(st.county_data);
        $('#state-results').innerHTML = html;
        $('#intro').classList.add('hidden');
    }

    // ── Nearby search ──
    async function searchNearby() {
        const addr = $('#addr-input').value.trim();
        if (!addr) return;

        $('#nearby-results').innerHTML = '<p class="loading">Geocoding address…</p>';
        $('#intro').classList.add('hidden');

        let coords;
        try {
            const resp = await fetch(`${GEOCODE_URL}?q=${encodeURIComponent(addr)}&format=json&limit=1&countrycodes=us`);
            const data = await resp.json();
            if (!data.length) {
                $('#nearby-results').innerHTML = '<p class="no-results">Address not found. Try a different format (e.g., "Portland, OR" or "90210").</p>';
                return;
            }
            coords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        } catch (e) {
            $('#nearby-results').innerHTML = '<p class="no-results">Geocoding failed. Try again.</p>';
            return;
        }

        if (!proximityData.length) {
            $('#nearby-results').innerHTML = '<p class="no-results">Proximity search is not yet available for the current data coverage. Try searching by county name or browsing by state instead.</p>';
            return;
        }

        const radius = parseFloat($('#radius-select').value);
        const results = [];

        for (const county of proximityData) {
            const d = haversine(coords.lat, coords.lng, county.lat, county.lng);
            if (d <= radius) {
                results.push({ ...county, distance: d });
            }
        }

        results.sort((a, b) => a.distance - b.distance);
        currentResults = results.map(r => ({
            n: r.n, s: r.s, f: r.f, r: r.r, d: r.distance
        }));
        currentView = 'nearby';

        if (!results.length) {
            $('#nearby-results').innerHTML = `<p class="no-results">No counties found within ${radius} miles. Try increasing the radius.</p>`;
            return;
        }

        let html = `<p class="result-count">${results.length} count${results.length !== 1 ? 'ies' : 'y'} within ${radius} miles of "${addr}"</p>`;
        html += '<div class="county-list">';
        results.forEach(r => {
            html += `
                <div class="county-row" data-fips="${r.f}">
                    <span class="county-name">${esc(r.n)}, ${r.s}</span>
                    <span class="county-meta">${r.d.toFixed(1)} mi</span>
                    <span class="county-rate ${rateClass(r.r)}">${r.r != null ? r.r + '%' : 'N/A'}</span>
                </div>`;
        });
        html += '</div>';
        $('#nearby-results').innerHTML = html;

        // Click handlers
        $$('#nearby-results .county-row').forEach(row => {
            row.addEventListener('click', () => loadDetail(row.dataset.fips));
        });
    }

    // ── Render county list ──
    function renderCountyList(matches, container) {
        if (!matches.length) {
            container.innerHTML = '<p class="no-results">No counties found. Try a different search.</p>';
            return;
        }
        container.innerHTML = renderCountyTable(matches);

        container.querySelectorAll('.county-row').forEach(row => {
            row.addEventListener('click', () => loadDetail(row.dataset.fips));
        });
    }

    function renderCountyTable(entries) {
        let html = '<div class="county-list">';
        entries.forEach(e => {
            const displayName = e.s ? `${e.n}, ${e.s}` : e.n;
            html += `
                <div class="county-row" data-fips="${e.f}">
                    <span class="county-name">${esc(displayName)}</span>
                    <span class="county-meta">${e.p ? fmtPop(e.p) : ''}</span>
                    <span class="county-rate ${rateClass(e.r)}">${e.r != null ? e.r + '%' : 'N/A'}
                        ${e.y != null ? (e.y > 0 ? ' ↑' : e.y < 0 ? ' ↓' : ' →') : ''}
                    </span>
                    ${e.d != null ? `<span class="county-meta">${e.d.toFixed(1)} mi</span>` : ''}
                </div>`;
        });
        html += '</div>';
        return html;
    }

    // ── County detail ──
    async function loadDetail(fips) {
        const shard = md5slice(fips, 2);
        if (!detailCache[shard]) {
            try {
                const resp = await fetch(`${BASE}details/${shard}.json`);
                detailCache[shard] = await resp.json();
            } catch (e) {
                return;
            }
        }

        const d = detailCache[shard][fips];
        if (!d) return;

        $('#detail-content').innerHTML = renderDetail(d);
        $('#detail').classList.remove('hidden');
        $('#search-results').classList.add('hidden');
        $('#state-results').classList.add('hidden');
        $('#nearby-results').classList.add('hidden');
        $('#intro').classList.add('hidden');
        window.scrollTo(0, 0);

        // Draw chart
        if (d.months && d.months.length > 1) {
            setTimeout(() => drawChart(d), 100);
        }
    }

    function renderDetail(d) {
        let html = `
            <h2>${esc(d.name)}, ${esc(d.state)}</h2>
            <div class="detail-stats">
                <div class="stat-card primary">
                    <span class="stat-value ${rateClass(d.latest_rate)}">${d.latest_rate}%</span>
                    <span class="stat-label">Unemployment Rate</span>
                    <span class="stat-date">${d.latest_month}${d.preliminary ? ' (preliminary)' : ''}</span>
                </div>`;

        if (d.state_rate != null) {
            const diff = d.latest_rate - d.state_rate;
            const diffStr = diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1);
            html += `
                <div class="stat-card">
                    <span class="stat-value small">${d.state_rate}%</span>
                    <span class="stat-label">${d.state_name} Average</span>
                    <span class="stat-diff ${diff > 0 ? 'worse' : 'better'}">${diffStr} vs state</span>
                </div>`;
        }

        if (d.national_rate != null) {
            const ndiff = d.latest_rate - d.national_rate;
            const ndiffStr = ndiff > 0 ? `+${ndiff.toFixed(1)}` : ndiff.toFixed(1);
            html += `
                <div class="stat-card">
                    <span class="stat-value small">${d.national_rate}%</span>
                    <span class="stat-label">National Average</span>
                    <span class="stat-diff ${ndiff > 0 ? 'worse' : 'better'}">${ndiffStr} vs US</span>
                </div>`;
        }

        html += `</div>`;

        // Trend info
        if (d.yoy_change != null) {
            const yoyStr = d.yoy_change > 0 ? `up ${d.yoy_change.toFixed(1)}` : d.yoy_change < 0 ? `down ${Math.abs(d.yoy_change).toFixed(1)}` : 'unchanged';
            html += `<p class="trend-note">Year-over-year: <strong>${yoyStr} percentage points</strong> from same month last year.</p>`;
        }

        // Range
        html += `<p class="range-note">Range: ${d.min_rate}% (${d.min_month}) — ${d.max_rate}% (${d.max_month})</p>`;

        // Population
        if (d.population) {
            html += `<p class="pop-note">Population: ${d.population.toLocaleString()}</p>`;
        }

        // Chart canvas
        html += `<div class="chart-container"><canvas id="trend-chart"></canvas></div>`;

        return html;
    }

    // ── Chart ──
    function drawChart(detail) {
        const canvas = $('#trend-chart');
        if (!canvas) return;

        const container = canvas.parentElement;
        const width = container.clientWidth;
        const height = 250;
        canvas.width = width * 2;
        canvas.height = height * 2;
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';

        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);

        const months = detail.months;
        const padding = { top: 20, right: 60, bottom: 40, left: 50 };
        const chartW = width - padding.left - padding.right;
        const chartH = height - padding.top - padding.bottom;

        // Find value range
        const values = months.map(m => m.v);
        const minVal = Math.floor(Math.min(...values));
        const maxVal = Math.ceil(Math.max(...values));
        const range = maxVal - minVal || 1;

        // Scales
        const xScale = i => padding.left + (i / (months.length - 1)) * chartW;
        const yScale = v => padding.top + chartH - ((v - minVal) / range) * chartH;

        // Grid lines
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        for (let v = minVal; v <= maxVal; v++) {
            const y = yScale(v);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(padding.left + chartW, y);
            ctx.stroke();

            ctx.fillStyle = '#6b7280';
            ctx.font = '11px system-ui';
            ctx.textAlign = 'right';
            ctx.fillText(v + '%', padding.left - 8, y + 4);
        }

        // State reference line (dashed)
        if (detail.state_rate != null) {
            const sy = yScale(detail.state_rate);
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(padding.left, sy);
            ctx.lineTo(padding.left + chartW, sy);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#f59e0b';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText(`State (${detail.state_rate}%)`, padding.left + chartW + 4, sy + 4);
        }

        // National reference line (dotted)
        if (detail.national_rate != null) {
            const ny = yScale(detail.national_rate);
            ctx.strokeStyle = '#9ca3af';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 4]);
            ctx.beginPath();
            ctx.moveTo(padding.left, ny);
            ctx.lineTo(padding.left + chartW, ny);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = '#9ca3af';
            ctx.font = '10px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText(`US (${detail.national_rate}%)`, padding.left + chartW + 4, ny + 4);
        }

        // Line chart
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2.5;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        months.forEach((m, i) => {
            const x = xScale(i);
            const y = yScale(m.v);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Data points
        months.forEach((m, i) => {
            const x = xScale(i);
            const y = yScale(m.v);
            ctx.fillStyle = '#2563eb';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
        });

        // X-axis labels (every 3 months)
        ctx.fillStyle = '#6b7280';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'center';
        months.forEach((m, i) => {
            if (i % 3 === 0 || i === months.length - 1) {
                const x = xScale(i);
                ctx.fillText(`${m.y}-${String(m.m).padStart(2,'0')}`, x, padding.top + chartH + 16);
            }
        });
    }

    // ── Helpers ──
    function haversine(lat1, lng1, lat2, lng2) {
        const R = 3959; // miles
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLng = (lng2 - lng1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function rateClass(rate) {
        if (rate == null) return '';
        if (rate <= 3.5) return 'good';
        if (rate <= 5.5) return 'ok';
        if (rate <= 8.0) return 'warn';
        return 'high';
    }

    function fmtPop(p) {
        if (p >= 1e6) return (p / 1e6).toFixed(1) + 'M';
        if (p >= 1e3) return (p / 1e3).toFixed(0) + 'K';
        return p.toString();
    }

    function esc(s) {
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    // MD5 implementation for client-side shard resolution
    function md5slice(str, len) {
        // Simple hash for shard resolution (must match Python's hashlib.md5)
        // Use SubtleCrypto if available, fall back to simple hash
        return md5js(str).substring(0, len);
    }

    // Pure JS MD5 (RFC 1321) — must match Python hashlib.md5
    function md5js(input) {
        // Standard MD5 implementation
        function md5cycle(x, k) {
            var a = x[0], b = x[1], c = x[2], d = x[3];
            a = ff(a, b, c, d, k[0], 7, -680876936);
            d = ff(d, a, b, c, k[1], 12, -389564586);
            c = ff(c, d, a, b, k[2], 17, 606105819);
            b = ff(b, c, d, a, k[3], 22, -1044525330);
            a = ff(a, b, c, d, k[4], 7, -176418897);
            d = ff(d, a, b, c, k[5], 12, 1200080426);
            c = ff(c, d, a, b, k[6], 17, -1473231341);
            b = ff(b, c, d, a, k[7], 22, -45705983);
            a = ff(a, b, c, d, k[8], 7, 1770035416);
            d = ff(d, a, b, c, k[9], 12, -1958414417);
            c = ff(c, d, a, b, k[10], 17, -42063);
            b = ff(b, c, d, a, k[11], 22, -1990404162);
            a = ff(a, b, c, d, k[12], 7, 1804603682);
            d = ff(d, a, b, c, k[13], 12, -40341101);
            c = ff(c, d, a, b, k[14], 17, -1502002290);
            b = ff(b, c, d, a, k[15], 22, 1236535329);
            a = gg(a, b, c, d, k[1], 5, -165796510);
            d = gg(d, a, b, c, k[6], 9, -1069501632);
            c = gg(c, d, a, b, k[11], 14, 643717713);
            b = gg(b, c, d, a, k[0], 20, -373897302);
            a = gg(a, b, c, d, k[5], 5, -701558691);
            d = gg(d, a, b, c, k[10], 9, 38016083);
            c = gg(c, d, a, b, k[15], 14, -660478335);
            b = gg(b, c, d, a, k[4], 20, -405537848);
            a = gg(a, b, c, d, k[9], 5, 568446438);
            d = gg(d, a, b, c, k[14], 9, -1019803690);
            c = gg(c, d, a, b, k[3], 14, -187363961);
            b = gg(b, c, d, a, k[8], 20, 1163531501);
            a = gg(a, b, c, d, k[13], 5, -1444681467);
            d = gg(d, a, b, c, k[2], 9, -51403784);
            c = gg(c, d, a, b, k[7], 14, 1735328473);
            b = gg(b, c, d, a, k[12], 20, -1926607734);
            a = hh(a, b, c, d, k[5], 4, -378558);
            d = hh(d, a, b, c, k[8], 11, -2022574463);
            c = hh(c, d, a, b, k[11], 16, 1839030562);
            b = hh(b, c, d, a, k[14], 23, -35309556);
            a = hh(a, b, c, d, k[1], 4, -1530992060);
            d = hh(d, a, b, c, k[4], 11, 1272893353);
            c = hh(c, d, a, b, k[7], 16, -155497632);
            b = hh(b, c, d, a, k[10], 23, -1094730640);
            a = hh(a, b, c, d, k[13], 4, 681279174);
            d = hh(d, a, b, c, k[0], 11, -358537222);
            c = hh(c, d, a, b, k[3], 16, -722521979);
            b = hh(b, c, d, a, k[6], 23, 76029189);
            a = hh(a, b, c, d, k[9], 4, -640364487);
            d = hh(d, a, b, c, k[12], 11, -421815835);
            c = hh(c, d, a, b, k[15], 16, 530742520);
            b = hh(b, c, d, a, k[2], 23, -995338651);
            a = ii(a, b, c, d, k[0], 6, -198630844);
            d = ii(d, a, b, c, k[7], 10, 1126891415);
            c = ii(c, d, a, b, k[14], 15, -1416354905);
            b = ii(b, c, d, a, k[5], 21, -57434055);
            a = ii(a, b, c, d, k[12], 6, 1700485571);
            d = ii(d, a, b, c, k[3], 10, -1894986606);
            c = ii(c, d, a, b, k[10], 15, -1051523);
            b = ii(b, c, d, a, k[1], 21, -2054922799);
            a = ii(a, b, c, d, k[8], 6, 1873313359);
            d = ii(d, a, b, c, k[15], 10, -30611744);
            c = ii(c, d, a, b, k[6], 15, -1560198380);
            b = ii(b, c, d, a, k[13], 21, 1309151649);
            a = ii(a, b, c, d, k[4], 6, -145523070);
            d = ii(d, a, b, c, k[11], 10, -1120210379);
            c = ii(c, d, a, b, k[2], 15, 718787259);
            b = ii(b, c, d, a, k[9], 21, -343485551);
            x[0] = add32(a, x[0]);
            x[1] = add32(b, x[1]);
            x[2] = add32(c, x[2]);
            x[3] = add32(d, x[3]);
        }

        function cmn(q, a, b, x, s, t) {
            a = add32(add32(a, q), add32(x, t));
            return add32((a << s) | (a >>> (32 - s)), b);
        }

        function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
        function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
        function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
        function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }

        function md5blk(s) {
            var md5blks = [], i;
            for (i = 0; i < 64; i += 4) {
                md5blks[i>>2] = s.charCodeAt(i) + (s.charCodeAt(i+1) << 8) +
                    (s.charCodeAt(i+2) << 16) + (s.charCodeAt(i+3) << 24);
            }
            return md5blks;
        }

        function md5blk_array(a) {
            var md5blks = [], i;
            for (i = 0; i < 64; i += 4) {
                md5blks[i>>2] = a[i] + (a[i+1] << 8) + (a[i+2] << 16) + (a[i+3] << 24);
            }
            return md5blks;
        }

        function md51(s) {
            var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i,
                length, tail, tmp, lo, hi;

            var msg = [];
            for (i = 0; i < n; i++) msg.push(s.charCodeAt(i));

            length = msg.length;
            tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
            for (i = 0; i < length % 64; i++) {
                tail[i>>2] |= msg[length - (length % 64) + i] << ((i % 4) << 3);
            }

            if (length % 64 < 56) {
                tail[i>>2] |= 0x80 << ((i % 4) << 3);
            } else {
                var j;
                for (j = i; j < 64; j++) tail[j>>2] |= 0 << ((j % 4) << 3);
                md5cycle(state, md5blk_array(tail));
                for (j = 0; j < 16; j++) tail[j] = 0;
                tail[0] = 0x80;
            }

            var bits = length * 8;
            lo = bits & 0xffffffff;
            hi = (bits / Math.pow(2, 32)) | 0;

            tail[14] = lo;
            tail[15] = hi;

            for (i = 0; i < length - (length % 64); i += 64) {
                md5cycle(state, md5blk_array(msg.slice(i, i+64)));
            }
            if (length % 64) {
                md5cycle(state, md5blk_array(tail));
            } else {
                md5cycle(state, md5blk_array([0x80,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]));
                tail[14] = lo;
                tail[15] = hi;
                md5cycle(state, tail);
            }

            return state;
        }

        function add32(a, b) { return (a + b) & 0xFFFFFFFF; }

        function hexChars(a) {
            var hex = '0123456789abcdef', s = '';
            for (var i = 0; i < 4; i++) {
                s += hex.charAt((a >> (i*8+4)) & 0x0F) + hex.charAt((a >> (i*8)) & 0x0F);
            }
            return s;
        }

        var state = md51(input);
        return hexChars(state[0]) + hexChars(state[1]) + hexChars(state[2]) + hexChars(state[3]);
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
