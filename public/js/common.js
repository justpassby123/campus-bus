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
//  地图 v2 (南审校园风格: 建筑分区 + 双线环线 + 楼栋图案)
// ============================================================

// 站点建筑类型
function stopBuildingType(name) {
  if (name.includes('餐厅')) return { type: 'dining', icon: '🍽', label: '餐厅', color: '#F59E0B', zoneColor: '#FEF3C7' };
  if (name.includes('南门')) return { type: 'gate', icon: '🚪', label: '校门', color: '#8B5CF6', zoneColor: '#EDE9FE' };
  if (name.includes('楼')) return { type: 'teaching', icon: '🏫', label: '教学楼', color: '#2563EB', zoneColor: '#DBEAFE' };
  if (name.includes('园') || name.includes('竹苑') || name.includes('润园')) return { type: 'dorm', icon: '🏠', label: '宿舍区', color: '#16A34A', zoneColor: '#DCFCE7' };
  return { type: 'spot', icon: '📍', label: '站点', color: '#6B7280', zoneColor: '#F3F4F6' };
}

// 绘制建筑小图标 (SVG path, 以 cx,cy 为中心)
function drawBuilding(cx, cy, type, color) {
  const s = 0.8; // 缩放
  if (type === 'dorm') {
    // 宿舍楼: 坡顶房子
    return `<g opacity="0.7" transform="translate(${cx},${cy})">
      <path d="M -10,2 L -10,-4 L 0,-10 L 10,-4 L 10,2 Z" fill="${color}" opacity="0.15"/>
      <rect x="-9" y="-3" width="18" height="8" rx="1" fill="${color}" opacity="0.2"/>
      <path d="M -10,-4 L 0,-10 L 10,-4" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.4"/>
      <rect x="-6" y="0" width="3" height="4" fill="${color}" opacity="0.3"/>
      <rect x="0" y="0" width="3" height="4" fill="${color}" opacity="0.3"/>
      <rect x="6" y="0" width="3" height="4" fill="${color}" opacity="0.3"/>
    </g>`;
  }
  if (type === 'teaching') {
    // 教学楼: 高楼带窗户
    return `<g opacity="0.7" transform="translate(${cx},${cy})">
      <rect x="-9" y="-12" width="18" height="16" rx="1" fill="${color}" opacity="0.12"/>
      <rect x="-9" y="-12" width="18" height="16" rx="1" fill="none" stroke="${color}" stroke-width="1" opacity="0.35"/>
      <line x1="-9" y1="-6" x2="9" y2="-6" stroke="${color}" stroke-width="0.6" opacity="0.25"/>
      <line x1="-9" y1="0" x2="9" y2="0" stroke="${color}" stroke-width="0.6" opacity="0.25"/>
      <rect x="-6" y="-10" width="2.5" height="2.5" fill="${color}" opacity="0.3"/>
      <rect x="-1" y="-10" width="2.5" height="2.5" fill="${color}" opacity="0.3"/>
      <rect x="4" y="-10" width="2.5" height="2.5" fill="${color}" opacity="0.3"/>
      <rect x="-6" y="-4" width="2.5" height="2.5" fill="${color}" opacity="0.3"/>
      <rect x="-1" y="-4" width="2.5" height="2.5" fill="${color}" opacity="0.3"/>
      <rect x="4" y="-4" width="2.5" height="2.5" fill="${color}" opacity="0.3"/>
    </g>`;
  }
  if (type === 'dining') {
    // 餐厅: 圆顶建筑
    return `<g opacity="0.7" transform="translate(${cx},${cy})">
      <path d="M -8,2 Q -8,-8 0,-8 Q 8,-8 8,2 Z" fill="${color}" opacity="0.15"/>
      <path d="M -8,2 Q -8,-8 0,-8 Q 8,-8 8,2" fill="none" stroke="${color}" stroke-width="1" opacity="0.4"/>
      <line x1="0" y1="-8" x2="0" y2="-11" stroke="${color}" stroke-width="1" opacity="0.4"/>
      <circle cx="0" cy="-11" r="1.5" fill="${color}" opacity="0.4"/>
    </g>`;
  }
  if (type === 'gate') {
    // 校门: 双柱门
    return `<g opacity="0.7" transform="translate(${cx},${cy})">
      <rect x="-9" y="-8" width="4" height="10" rx="1" fill="${color}" opacity="0.2"/>
      <rect x="5" y="-8" width="4" height="10" rx="1" fill="${color}" opacity="0.2"/>
      <line x1="-7" y1="-8" x2="7" y2="-8" stroke="${color}" stroke-width="1.5" opacity="0.35"/>
      <rect x="-9" y="-8" width="4" height="10" rx="1" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.3"/>
      <rect x="5" y="-8" width="4" height="10" rx="1" fill="none" stroke="${color}" stroke-width="0.8" opacity="0.3"/>
    </g>`;
  }
  return '';
}

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
    const pad = 0.001;
    const rangeLat = (maxLat - minLat) + pad * 2;
    const rangeLng = (maxLng - minLng) + pad * 2;

    const W = 480, H = 320;
    const toXY = (lat, lng) => [
      ((lng - (minLng - pad)) / rangeLng) * W,
      (1 - (lat - (minLat - pad)) / rangeLat) * H
    ];

    const ROUTE_COLORS = { 1: '#2563EB', 2: '#EA580C' };

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block; border-radius:8px;">`;

    // ① 校园底图: 柔和草坪
    svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#F0F5F0"/>`;
    svg += `<rect x="12" y="12" width="${W-24}" height="${H-24}" rx="16" fill="#F8FBF8" stroke="#D6E6D6" stroke-width="1.5"/>`;

    // ② 功能分区色块 (按建筑类型聚类, 柔和背景)
    const zones = {};
    stops.forEach(s => {
      const bt = stopBuildingType(s.name);
      if (!zones[bt.type]) zones[bt.type] = { color: bt.zoneColor, label: bt.label, points: [] };
      const [x, y] = toXY(s.lat, s.lng);
      zones[bt.type].points.push([x, y]);
    });
    Object.values(zones).forEach(z => {
      if (z.points.length === 0) return;
      const xs = z.points.map(p => p[0]), ys = z.points.map(p => p[1]);
      const minX = Math.min(...xs) - 22, maxX = Math.max(...xs) + 22;
      const minY = Math.min(...ys) - 22, maxY = Math.max(...ys) + 22;
      svg += `<rect x="${minX}" y="${minY}" width="${maxX-minX}" height="${maxY-minY}" rx="12" fill="${z.color}" opacity="0.35"/>`;
    });

    // ③ 建筑小图标 (在站点圆点下方)
    stops.forEach(s => {
      const [x, y] = toXY(s.lat, s.lng);
      const bt = stopBuildingType(s.name);
      svg += drawBuilding(x, y - 4, bt.type, bt.color);
    });

    // ④ 两条线路 (闭合环线)
    routes.forEach(r => {
      const ids = r.stopIds;
      let d = '';
      ids.forEach((id, i) => {
        const s = stops.find(x => x.id === id);
        if (!s) return;
        const [x, y] = toXY(s.lat, s.lng);
        d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
      });
      svg += `<path d="${d}" stroke="${ROUTE_COLORS[r.id] || '#9CA3AF'}" stroke-width="3" fill="none" opacity="0.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    });

    // ⑤ 站点圆点
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
        <text x="${x}" y="${y + 17}" text-anchor="middle" font-size="9" fill="#374151" font-weight="${isHot ? 600 : 400}">${s.name}</text>
        ${wait > 0 ? `<text x="${x}" y="${y - 10}" text-anchor="middle" font-size="9" font-weight="700" fill="${ring}">${wait}人</text>` : ''}
      </g>`;
    });

    // ⑥ 休息区
    if (restArea) {
      const [x, y] = toXY(restArea.lat, restArea.lng);
      svg += `<rect x="${x-32}" y="${y-18}" width="64" height="36" rx="8" fill="#E0EDFF" stroke="#93C5FD" stroke-width="1.5" stroke-dasharray="5 3"/>`;
      svg += `<text x="${x}" y="${y+14}" text-anchor="middle" font-size="9" fill="#2563EB" font-weight="600">🅿️ 沁园休息区</text>`;
    }

    // ⑦ 运营车辆 (按线路着色, 带脉冲)
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

    // ⑧ 停放车辆 (休息区网格)
    const cols = 3;
    parkedBuses.forEach((b, i) => {
      if (!restArea) return;
      const [px, py] = toXY(restArea.lat, restArea.lng);
      const col = i % cols, row = Math.floor(i / cols);
      const x = px - 16 + col * 16;
      const y = py - 6 + row * 8;
      const label = b.id.replace('#', '');
      const color = b.status === 'backup' ? '#9CA3AF' : b.status === 'standby' ? '#2563EB' : '#1F2937';
      svg += `<circle cx="${x}" cy="${y}" r="4.5" fill="#fff" stroke="${color}" stroke-width="1.5" ${b.status === 'backup' ? 'stroke-dasharray="2 1"' : ''}/>`;
      svg += `<text x="${x}" y="${y+2.5}" text-anchor="middle" font-size="7" font-weight="700" fill="${color}">${label}</text>`;
    });

    // ⑨ 图例 + 指北针
    const legends = [
      { icon: '🏠', label: '宿舍', color: '#16A34A' },
      { icon: '🏫', label: '教学', color: '#2563EB' },
      { icon: '🍽', label: '餐厅', color: '#F59E0B' },
      { icon: '🚪', label: '校门', color: '#8B5CF6' }
    ];
    let lx = 20;
    legends.forEach(l => {
      svg += `<text x="${lx}" y="${H - 8}" font-size="10" fill="${l.color}">${l.icon} ${l.label}</text>`;
      lx += 52;
    });

    svg += `<g transform="translate(${W-28}, 26)">
      <circle r="12" fill="#fff" stroke="#CBD5E1" stroke-width="1"/>
      <path d="M0 -8 L3.5 3 L0 0 L-3.5 3 Z" fill="#DC2626"/>
      <text x="0" y="-13" text-anchor="middle" font-size="8" fill="#6B7280">N</text>
    </g>`;

    svg += `</svg>`;
    el.innerHTML = svg;
  }
};
