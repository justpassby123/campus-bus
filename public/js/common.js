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
        const tip = d.busId ? `${d.stopName} 有 ${d.count} 人等车，最近车 ${d.busId} 约 ${d.eta} 分钟` : `${d.stopName} 有 ${d.count} 人等车`;
        this.toast(tip);
      });
      this.socket.on('demand:resolved', (d) => {
        this.toast(`${d.busId || '公交'} 已到 ${d.stopName}，送达 ${d.served} 人`);
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
//  地图 (干净白色风格, 含休息区标记)
// ============================================================
window.MapView = {
  render(containerId, stops, buses, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el || !stops || stops.length === 0) return;
    const busArr = Array.isArray(buses) ? buses : (buses ? [buses] : []);
    const restArea = opts.restArea;
    const restingBuses = opts.restingBuses || [];

    // 计算经纬度范围
    const lats = stops.map(s => s.lat), lngs = stops.map(s => s.lng);
    busArr.forEach(b => { lats.push(b.lat); lngs.push(b.lng); });
    if (restArea) { lats.push(restArea.lat); lngs.push(restArea.lng); }

    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad = 0.0006;
    const rangeLat = (maxLat - minLat) + pad * 2;
    const rangeLng = (maxLng - minLng) + pad * 2;

    const W = el.clientWidth || 400;
    const H = el.clientHeight || 240;
    const toXY = (lat, lng) => [
      ((lng - (minLng - pad)) / rangeLng) * W,
      (1 - (lat - (minLat - pad)) / rangeLat) * H
    ];

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" style="background: #F9FAFB; display: block;">`;

    // 路线虚线 (一线)
    const routeOrder = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,2];
    let pathD = '';
    routeOrder.forEach((id, i) => {
      const s = stops.find(x => x.id === id);
      if (!s) return;
      const [x, y] = toXY(s.lat, s.lng);
      pathD += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
    });
    svg += `<path d="${pathD}" stroke="#D1D5DB" stroke-width="2" fill="none" stroke-dasharray="5 4" />`;

    // 站点
    stops.forEach(s => {
      const [x, y] = toXY(s.lat, s.lng);
      const wait = s.waitCount || 0;
      let fill = '#fff', stroke = '#9CA3AF', r = 5;
      if (wait > 0) {
        if (wait >= 3) { fill = '#DC2626'; stroke = '#DC2626'; }
        else { fill = '#D97706'; stroke = '#D97706'; }
        r = 7;
      }
      svg += `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.5" />`;
      svg += `<text x="${x}" y="${y+18}" text-anchor="middle" font-size="10" fill="#6B7280">${s.name}</text>`;
      if (wait > 0) {
        svg += `<text x="${x}" y="${y-10}" text-anchor="middle" font-size="10" font-weight="600" fill="${stroke}">${wait}人</text>`;
      }
    });

    // 休息区标记 (放大以容纳多辆停放车辆)
    if (restArea) {
      const [x, y] = toXY(restArea.lat, restArea.lng);
      svg += `<rect x="${x-32}" y="${y-22}" width="64" height="44" rx="6" fill="#F3F4F6" stroke="#9CA3AF" stroke-width="1" stroke-dasharray="4 3"/>`;
      svg += `<text x="${x}" y="${y+18}" text-anchor="middle" font-size="9" fill="#6B7280">P 沁园休息区</text>`;
    }

    // 运营车辆
    busArr.forEach((b, i) => {
      const [bx, by] = toXY(b.lat, b.lng);
      const color = (i % 2 === 0) ? '#1F2937' : '#374151';
      const label = b.id ? b.id.replace('#', '') : (i + 1);
      svg += `<g>
        <circle cx="${bx}" cy="${by}" r="10" fill="${color}" opacity="0.15">
          <animate attributeName="r" values="8;14;8" dur="2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite"/>
        </circle>
        <circle cx="${bx}" cy="${by}" r="9" fill="${color}" stroke="#fff" stroke-width="2"/>
        <text x="${bx}" y="${by+3.5}" text-anchor="middle" font-size="10" font-weight="600" fill="#fff">${label}</text>
      </g>`;
    });

    // 停放车辆 (resting/standby/backup 都在休息区)
    const parkedBuses = opts.parkedBuses || restingBuses;
    parkedBuses.forEach((b, i) => {
      if (!restArea) return;
      const [px, py] = toXY(restArea.lat, restArea.lng);
      // 围绕休息区中心网格化排列
      const cols = 3;
      const col = i % cols, row = Math.floor(i / cols);
      const x = px - 18 + col * 18;
      const y = py - 10 + row * 10;
      const label = b.id.replace('#', '');
      const fill = '#fff';
      const stroke = b.status === 'backup' ? '#9CA3AF' : b.status === 'standby' ? '#6B7280' : '#1F2937';
      const textColor = b.status === 'backup' ? '#9CA3AF' : '#374151';
      svg += `<g>
        <circle cx="${x}" cy="${y}" r="6" fill="${fill}" stroke="${stroke}" stroke-width="${b.status === 'backup' ? '1' : '1.5'}" ${b.status === 'backup' ? 'stroke-dasharray="2 1"' : ''}/>
        <text x="${x}" y="${y+2.5}" text-anchor="middle" font-size="8" font-weight="600" fill="${textColor}">${label}</text>
      </g>`;
    });

    svg += `</svg>`;
    el.innerHTML = svg;
  }
};
