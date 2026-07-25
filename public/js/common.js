// ============================================================
//  common.js - 公共工具 v4
// ============================================================

// 优先用用户自定义的 API 地址, 其次用 localhost:3000 (file:// 打开时),
// 最后用页面同源 (http:// 打开时)
function resolveApiBase() {
  const custom = localStorage.getItem('cb-api-base');
  if (custom) return custom;
  if (location.protocol === 'file:') return 'http://localhost:3000';
  return '';  // 同源, 走相对路径
}
const API_BASE = resolveApiBase();

window.App = {
  state: null,
  socket: null,

  initSocket() {
    if (typeof io === 'undefined') return;
    try {
      this.socket = io(API_BASE || undefined);
      this.socket.on('state:update', (s) => {
        this.state = s;
        if (typeof window.onStateUpdate === 'function') window.onStateUpdate(s);
      });
      this.socket.on('demand:new', (d) => {
        const rn = d.routeName ? d.routeName + ' ' : '';
        const tip = d.busId ? `${d.stopName} ${rn}有 ${d.count} 人等车，最近 ${d.busId} 约 ${d.eta} 分钟` : `${d.stopName} ${rn}有 ${d.count} 人等车`;
        this.toast(tip);
        if (typeof window.onDemandNew === 'function') window.onDemandNew(d);
      });
      this.socket.on('demand:resolved', (d) => {
        if (typeof window.onDemandResolved === 'function') window.onDemandResolved(d);
      });
      this.socket.on('bus:resting', (d) => {
        this.toast(`${d.busId} 已完成 ${d.lapsCompleted} 圈，到达沁园休息区`);
      });
    } catch (e) { /* 忽略, 轮询兜底 */ }
  },

  async fetchState() {
    const res = await fetch(API_BASE + '/api/state');
    this.state = await res.json();
    return this.state;
  },

  toast(msg, ms = 2200) {
    const old = document.getElementById('app-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), ms);
  },

  showModal(html) {
    const old = document.getElementById('app-modal');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'app-modal';
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" onclick="event.stopPropagation()">${html}</div>`;
    wrap.onclick = () => wrap.remove();
    document.body.appendChild(wrap);
    return wrap;
  },

  closeModal() {
    const m = document.getElementById('app-modal');
    if (m) m.remove();
  },

  periodText(p) { return { peak: '高峰', normal: '平峰', off: '非运营' }[p] || p; },
  crowdText(c) { return { empty: '空载', medium: '适中', crowded: '拥挤' }[c] || c; },
  crowdClass(c) { return { empty: 'success', medium: 'warning', crowded: 'danger' }[c] || 'gray'; },
  statusText(s) {
    return { standby: '待命', operating: '运营中', resting: '休息中', backup: '备班' }[s] || s;
  },
  statusClass(s) {
    return { standby: 'warning', operating: 'success', resting: 'accent', backup: 'gray' }[s] || 'gray';
  }
};

// ============================================================
//  地图 (南审校园风格: 双线配色环线 + 校园底色 + 指北针/比例尺)
// ============================================================
window.MapView = {
  render(containerId, stops, buses, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el || !stops || stops.length === 0) return;
    const busArr = Array.isArray(buses) ? buses : (buses ? [buses] : []);
    const restArea = opts.restArea;
    const parkedBuses = opts.parkedBuses || opts.restingBuses || [];
    const routes = opts.routes || [];

    // 计算经纬度范围
    const lats = stops.map(s => s.lat), lngs = stops.map(s => s.lng);
    busArr.forEach(b => { lats.push(b.lat); lngs.push(b.lng); });
    if (restArea) { lats.push(restArea.lat); lngs.push(restArea.lng); }

    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad = 0.0007;
    const rangeLat = (maxLat - minLat) + pad * 2;
    const rangeLng = (maxLng - minLng) + pad * 2;

    const W = 480, H = 300;
    const toXY = (lat, lng) => [
      ((lng - (minLng - pad)) / rangeLng) * W,
      (1 - (lat - (minLat - pad)) / rangeLat) * H
    ];

    const ROUTE_COLORS = { 1: '#2563EB', 2: '#EA580C' }; // 一线蓝 / 二线橙

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block; border-radius:8px;">`;

    // 校园底图: 柔和草地/建筑分区感
    svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#EAF3EA"/>`;
    svg += `<rect x="16" y="16" width="${W-32}" height="${H-32}" rx="18" fill="#F2F8F2" stroke="#D6E6D6" stroke-width="1.5"/>`;

    // 两条线路 (闭合环线, 各自着色)
    routes.forEach(r => {
      const ids = r.stopIds;
      let d = '';
      ids.forEach((id, i) => {
        const s = stops.find(x => x.id === id);
        if (!s) return;
        const [x, y] = toXY(s.lat, s.lng);
        d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
      });
      svg += `<path d="${d}" stroke="${ROUTE_COLORS[r.id] || '#9CA3AF'}" stroke-width="3.5" fill="none" opacity="0.45" stroke-linejoin="round" stroke-linecap="round"/>`;
    });

    // 站点
    stops.forEach(s => {
      const [x, y] = toXY(s.lat, s.lng);
      const wait = s.waitCount || 0;
      const isHot = wait >= 3;
      const isWarm = wait > 0 && wait < 3;
      const ring = isHot ? '#DC2626' : isWarm ? '#D97706' : '#6B7280';
      const fill = isHot ? '#FEE2E2' : '#FFFFFF';
      const r = isHot ? 7 : 5.5;
      svg += `<g>
        <circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${ring}" stroke-width="2"/>
        <text x="${x}" y="${y + 16}" text-anchor="middle" font-size="10" fill="#374151" font-weight="${isHot ? 600 : 400}">${s.name}</text>
        ${wait > 0 ? `<text x="${x}" y="${y - 9}" text-anchor="middle" font-size="10" font-weight="700" fill="${ring}">${wait}人</text>` : ''}
      </g>`;
    });

    // 休息区
    if (restArea) {
      const [x, y] = toXY(restArea.lat, restArea.lng);
      svg += `<rect x="${x-30}" y="${y-20}" width="60" height="40" rx="8" fill="#E0EDFF" stroke="#93C5FD" stroke-width="1.5" stroke-dasharray="5 3"/>`;
      svg += `<text x="${x}" y="${y+16}" text-anchor="middle" font-size="9" fill="#2563EB" font-weight="600">🅿️ 沁园休息区</text>`;
    }

    // 运营车辆 (按线路着色)
    busArr.forEach((b) => {
      const [bx, by] = toXY(b.lat, b.lng);
      const color = b.routeId === 2 ? '#EA580C' : '#2563EB';
      const label = b.id ? b.id.replace('#', '') : '';
      svg += `<g>
        <circle cx="${bx}" cy="${by}" r="11" fill="${color}" opacity="0.18">
          <animate attributeName="r" values="9;15;9" dur="2.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.3;0;0.3" dur="2.2s" repeatCount="indefinite"/>
        </circle>
        <circle cx="${bx}" cy="${by}" r="9" fill="${color}" stroke="#fff" stroke-width="2"/>
        <text x="${bx}" y="${by+3.5}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${label}</text>
      </g>`;
    });

    // 停放车辆 (休息区网格)
    const cols = 3;
    parkedBuses.forEach((b, i) => {
      if (!restArea) return;
      const [px, py] = toXY(restArea.lat, restArea.lng);
      const col = i % cols, row = Math.floor(i / cols);
      const x = px - 16 + col * 16;
      const y = py - 8 + row * 9;
      const label = b.id.replace('#', '');
      const color = b.status === 'backup' ? '#9CA3AF' : b.status === 'standby' ? '#2563EB' : '#1F2937';
      svg += `<circle cx="${x}" cy="${y}" r="5" fill="#fff" stroke="${color}" stroke-width="1.5" ${b.status === 'backup' ? 'stroke-dasharray="2 1"' : ''}/>`;
      svg += `<text x="${x}" y="${y+2.5}" text-anchor="middle" font-size="7" font-weight="700" fill="${color}">${label}</text>`;
    });

    // 指北针
    svg += `<g transform="translate(${W-30}, 28)">
      <circle r="13" fill="#fff" stroke="#CBD5E1" stroke-width="1"/>
      <path d="M0 -9 L4 4 L0 0 L-4 4 Z" fill="#DC2626"/>
      <text x="0" y="-14" text-anchor="middle" font-size="8" fill="#6B7280">N</text>
    </g>`;
    // 比例尺 (装饰)
    svg += `<g transform="translate(28, ${H-22})">
      <line x1="0" y1="0" x2="44" y2="0" stroke="#6B7280" stroke-width="1.5"/>
      <line x1="0" y1="-3" x2="0" y2="3" stroke="#6B7280" stroke-width="1.5"/>
      <line x1="44" y1="-3" x2="44" y2="3" stroke="#6B7280" stroke-width="1.5"/>
      <text x="22" y="12" text-anchor="middle" font-size="8" fill="#6B7280">约 200m</text>
    </g>`;

    svg += `</svg>`;
    el.innerHTML = svg;
  }
};
