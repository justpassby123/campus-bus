// ============================================================
//  common.js - 公共工具 v5 (iOS 风格头像 + 状态工具)
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

  showSheet(html) {
    const old = document.getElementById('app-sheet');
    if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'app-sheet';
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = `<div class="sheet-panel" onclick="event.stopPropagation()">${html}</div>`;
    wrap.onclick = () => wrap.remove();
    document.body.appendChild(wrap);
    return wrap;
  },
  closeSheet() {
    const m = document.getElementById('app-sheet');
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
  },

  // iOS 风格圆形头像：名字首字母 + 柔和渐变背景
  // name: 显示文本，size: 像素尺寸
  avatar(name, size = 42) {
    const palettes = [
      ['#FF9A9E', '#FECFEF'],
      ['#A18CD1', '#FBC2EB'],
      ['#84FAB0', '#8FD3F4'],
      ['#FCCB90', '#D57EEB'],
      ['#E0C3FC', '#8EC5FC'],
      ['#43E97B', '#38F9D7'],
      ['#FA709A', '#FEE140'],
      ['#30CFD0', '#330867'],
      ['#5EE7DF', '#B490CA'],
      ['#F093FB', '#F5576C']
    ];
    const str = String(name || '');
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = ((hash << 5) - hash) + str.charCodeAt(i) | 0;
    const [c1, c2] = palettes[Math.abs(hash) % palettes.length];
    const letter = str.trim() && str.trim() !== '—' ? str.trim().charAt(0).toUpperCase() : '';
    const content = letter || `<svg width="${size * 0.45}" height="${size * 0.45}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="5" fill="white" fill-opacity="0.95"/><path d="M3 21c0-5 4-8 9-8s9 3 9 8" stroke="white" stroke-width="2.5" stroke-linecap="round"/></svg>`;
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:linear-gradient(135deg,${c1},${c2});color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:${size * 0.45}px;flex-shrink:0;user-select:none;overflow:hidden;">${content}</div>`;
  },

  // 圆形 emoji 头像：用于司机 / 学生等人物头像（轻量、辨识度高）
  emojiAvatar(emoji, size = 36, bg = '#F3F4F6') {
    return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;font-size:${Math.round(size * 0.55)}px;flex-shrink:0;line-height:1;">${emoji}</div>`;
  }
};

// ============================================================
//  地图 v3 (AI 校园底图 + 双线环线 + iOS 风格站点)
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
    const pad = 0.001;
    const rangeLat = (maxLat - minLat) + pad * 2;
    const rangeLng = (maxLng - minLng) + pad * 2;

    const W = 480, H = 320;
    const toXY = (lat, lng) => [
      ((lng - (minLng - pad)) / rangeLng) * W,
      (1 - (lat - (minLat - pad)) / rangeLat) * H
    ];

    const ROUTE_COLORS = { 1: '#3A63D8', 2: '#16A39B' };

    let svg = `<svg width="100%" height="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="display:block; border-radius:8px;">`;

    // ① AI 校园底图 (用户实景清理版)
    svg += `<image href="/img/campus-bg.jpg" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`;
    // 半透明白色遮罩, 让底图柔和不抢眼
    svg += `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff" opacity="0.32"/>`;
    // 圆角边框
    svg += `<rect x="0.5" y="0.5" width="${W-1}" height="${H-1}" rx="8" fill="none" stroke="#E5E7EB" stroke-width="1"/>`;

    // ② 两条线路 (白边+主线, 让红色路线在底图上最醒目)
    routes.forEach(r => {
      const ids = r.stopIds;
      let d = '';
      ids.forEach((id, i) => {
        const s = stops.find(x => x.id === id);
        if (!s) return;
        const [x, y] = toXY(s.lat, s.lng);
        d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
      });
      const color = ROUTE_COLORS[r.id] || '#9CA3AF';
      svg += `<path d="${d}" stroke="#fff" stroke-width="9" fill="none" opacity="0.9" stroke-linejoin="round" stroke-linecap="round"/>`;
      svg += `<path d="${d}" stroke="${color}" stroke-width="3.5" fill="none" opacity="0.92" stroke-linejoin="round" stroke-linecap="round"/>`;
    });

    // ③ 站点: iOS 风格白色圆点 + 渐变色边 + 等待人数徽章
    stops.forEach(s => {
      const [x, y] = toXY(s.lat, s.lng);
      const wait = s.waitCount || 0;
      const isHot = wait >= 3;
      const isWarm = wait > 0 && wait < 3;
      const ring = isHot ? '#E15B6E' : isWarm ? '#D98A2B' : '#3A63D8';
      const fill = isHot ? '#E15B6E' : isWarm ? '#D98A2B' : '#fff';
      const stroke = '#fff';
      const r = isHot ? 9 : 7;
      svg += `<g>
        <circle cx="${x}" cy="${y}" r="${r + 2}" fill="#fff" opacity="0.85"/>
        <circle cx="${x}" cy="${y}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
        ${wait > 0 ? `<g><circle cx="${x}" cy="${y - 12}" r="8" fill="${ring}"/><text x="${x}" y="${y - 9}" text-anchor="middle" font-size="9" font-weight="700" fill="#fff">${wait}</text></g>` : ''}
        <text x="${x}" y="${y + 19}" text-anchor="middle" font-size="9" fill="#111827" font-weight="600" stroke="#fff" stroke-width="2.5" paint-order="stroke">${s.name}</text>
      </g>`;
    });

    // ④ 休息区 (蓝色虚线框 + 编号 - 不堆 emoji)
    if (restArea) {
      const [x, y] = toXY(restArea.lat, restArea.lng);
      svg += `<rect x="${x-30}" y="${y-15}" width="60" height="30" rx="6" fill="#fff" stroke="#3A63D8" stroke-width="1.2" stroke-dasharray="4 2" opacity="0.92"/>`;
      svg += `<text x="${x}" y="${y+3.5}" text-anchor="middle" font-size="9" fill="#3A63D8" font-weight="700">休息区</text>`;
    }

    // ⑤ 运营车辆 (🚌图标 + 编号 + 脉冲)
    busArr.forEach((b) => {
      const [bx, by] = toXY(b.lat, b.lng);
      const color = b.routeId === 2 ? '#16A39B' : '#3A63D8';
      const label = b.id ? b.id.replace('#', '') : '';
      svg += `<g>
        <circle cx="${bx}" cy="${by}" r="14" fill="${color}" opacity="0.20">
          <animate attributeName="r" values="11;17;11" dur="2.2s" repeatCount="indefinite"/>
          <animate attributeName="opacity" values="0.35;0;0.35" dur="2.2s" repeatCount="indefinite"/>
        </circle>
        <text x="${bx}" y="${by+5.5}" text-anchor="middle" font-size="17" font-family="Segoe UI Emoji, Apple Color Emoji, sans-serif">🚌</text>
        <text x="${bx}" y="${by+19}" text-anchor="middle" font-size="8.5" font-weight="700" fill="${color}">${label}</text>
      </g>`;
    });

    // ⑥ 停放车辆 (休息区 🚌 图标)
    const cols = 4;
    parkedBuses.forEach((b, i) => {
      if (!restArea) return;
      const [px, py] = toXY(restArea.lat, restArea.lng);
      const col = i % cols, row = Math.floor(i / cols);
      const x = px - 21 + col * 14;
      const y = py + 4 + row * 11;
      const label = b.id.replace('#', '');
      const color = b.status === 'backup' ? '#9CA3AF' : b.status === 'standby' ? '#3A63D8' : '#1F2937';
      svg += `<text x="${x}" y="${y+4}" text-anchor="middle" font-size="9" font-family="Segoe UI Emoji, Apple Color Emoji, sans-serif">🚌</text>`;
      svg += `<text x="${x+7.5}" y="${y+4}" text-anchor="middle" font-size="6" font-weight="700" fill="${color}">${label}</text>`;
    });

    // ⑦ 指北针 (简化版)
    svg += `<g transform="translate(${W-26}, 22)">
      <circle r="11" fill="#fff" stroke="#CBD5E1" stroke-width="1" opacity="0.95"/>
      <path d="M0 -7 L3 4 L0 0 L-3 4 Z" fill="#E15B6E"/>
      <text x="0" y="-12" text-anchor="middle" font-size="8" fill="#6B7280" font-weight="600">N</text>
    </g>`;

    svg += `</svg>`;
    el.innerHTML = svg;
  }
};
