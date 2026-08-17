// ============================================================
//  student.js - 学生端逻辑 v7 (v3 设计系统)
//  功能不变：双线智能选线 / OD 上报 / 我的等待 / 失物 / 反馈
// ============================================================
let stopsCache = [];
let routesCache = [];
let currentTab = 'home';
const CAP = 25; // 与后端 CAPACITY 一致
let myReports = JSON.parse(localStorage.getItem('student-reports') || '[]');
let myWaits = JSON.parse(localStorage.getItem('my-waits') || '[]');

function saveMyWaits() { localStorage.setItem('my-waits', JSON.stringify(myWaits)); }

// 设置 API 地址
function showApiSettings() {
  const current = localStorage.getItem('cb-api-base') || API_BASE || '(默认)';
  App.showModal(`
    <div class="modal-title">服务器设置</div>
    <div class="form-group">
      <label class="form-label">服务器地址 (留空用默认)</label>
      <input class="input" id="api-url-input" placeholder="http://localhost:3000" value="${current === '(默认)' ? '' : current}">
    </div>
    <div class="modal-actions">
      <button class="btn btn-block" onclick="saveApiSettings()">保存并刷新</button>
      <button class="btn btn-outline btn-block" onclick="App.closeModal()">取消</button>
    </div>`);
}
function saveApiSettings() {
  const v = document.getElementById('api-url-input').value.trim();
  if (v) localStorage.setItem('cb-api-base', v);
  else localStorage.removeItem('cb-api-base');
  location.reload();
}
function updateApiStatus(ok) {
  const el = document.getElementById('s-api-status');
  if (!el) return;
  const base = API_BASE || location.origin;
  el.textContent = ok ? `已连接 ${base}` : `未连接 ${base}`;
  el.style.color = ok ? '#2E9E6B' : '#C77B62';
}

async function init() {
  try {
    const ping = await fetch(API_BASE + '/api/state', { cache: 'no-store' });
    if (!ping.ok) throw new Error('HTTP ' + ping.status);
    const [stopsRes, routesRes] = await Promise.all([
      fetch(API_BASE + '/api/stops').then(r => r.json()),
      fetch(API_BASE + '/api/routes').then(r => r.json())
    ]);
    stopsCache = stopsRes;
    routesCache = routesRes;
  } catch (e) {
    const msg = location.protocol === 'file:'
      ? '请先在项目目录启动后端: cd campus-bus && node server.js'
      : '后端未启动，请联系管理员';
    App.toast('连接服务器失败: ' + msg, 4000);
    updateApiStatus(false);
    return;
  }
  updateApiStatus(true);

  await App.fetchState();
  renderAll();

  App.initSocket();
  window.onStateUpdate = renderAll;
  window.onDemandResolved = handleDemandResolved;

  document.querySelectorAll('.tab-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  document.getElementById('btn-fb-submit') && document.getElementById('btn-fb-submit').addEventListener('click', submitFeedback);

  loadNotices();
  loadLostFound();
  renderMyWaits();
  loadServiceCounts();

  setInterval(async () => {
    try { await App.fetchState(); renderAll(); } catch (e) {}
  }, 2000);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  if (tab === 'service') loadServiceCounts();
  if (tab === 'notice') loadNotices();
  if (tab === 'me') { loadMyReports(); }
}

function renderAll() {
  const s = App.state;
  if (!s) return;

  // 最近班车浮卡
  const ops = s.buses ? s.buses.filter(b => b.status === 'operating') : [];
  const tEl = document.getElementById('s-nearest-title');
  const subEl = document.getElementById('s-nearest-sub');
  const tagEl = document.getElementById('s-nearest-tag');
  if (ops.length > 0) {
    const b = ops[0];
    const route = routesCache.find(r => r.id === b.routeId);
    tEl.textContent = '最近班车 ' + b.id;
    subEl.textContent = (route ? route.name : '') + ' · 当前 ' + (b.currentStopName || '—');
    tagEl.style.display = '';
    tagEl.innerHTML = '<span class="dot"></span>运营中 ' + ops.length + ' 辆';
  } else {
    tEl.textContent = '暂无运营车';
    subEl.textContent = '校内车辆休息中，请稍后再试';
    tagEl.style.display = 'none';
  }

  // 地图
  const restingBuses = s.buses ? s.buses.filter(b => b.status !== 'operating') : [];
  MapView.render('map-student', s.stops, ops, { restArea: s.restArea, restingBuses, routes: routesCache });

  renderMyWaits();
}

// ========== 我的等待 ==========
function renderMyWaits() {
  const el = document.getElementById('s-my-waits');
  if (!el) return;
  if (!myWaits.length) { el.innerHTML = ''; return; }
  const rows = myWaits.map(w => {
    let cnt = 0, eta = null, busId = null;
    if (App.state) {
      if (App.state.stops) {
        const st = App.state.stops.find(s => s.id === w.stopId);
        if (st) cnt = w.routeId === 1 ? st.wait1 : st.wait2;
      }
      if (App.state.schedule) {
        const sc = App.state.schedule.find(s => s.id === w.stopId && s.routeId === w.routeId);
        if (sc) { eta = sc.eta; busId = sc.nearestBusId; }
      }
    }
    const destTxt = w.destStopName ? ` → ${w.destStopName}` : '';
    const etaText = busId ? `最近 ${busId} 约 ${eta} 分钟到站` : '暂无该线运营车，请耐心等待';
    if (w.overflowTip) {
      return `
      <div class="card" style="padding:14px;">
        <div class="li-title" style="display:flex;align-items:center;gap:8px;">
          <span style="width:30px;height:30px;border-radius:50%;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">!</span>
          ${w.stopName}${destTxt} · ${w.routeName} <span class="tag tag-danger">满载滞留</span>
        </div>
        <div class="li-sub" style="margin-top:6px;color:var(--accent-deep);">${w.overflowTip}</div>
        <div class="grid-2" style="gap:8px;margin-top:10px;">
          <button class="btn btn-sm" onclick="resolveWait(${w.stopId}, ${w.routeId}, 'board')">✓ 我已上车</button>
          <button class="btn btn-outline btn-sm" onclick="resolveWait(${w.stopId}, ${w.routeId}, 'leave')">我不等了</button>
        </div>
      </div>`;
    }
    return `
      <div class="card" style="padding:14px;">
        <div class="li-title" style="display:flex;align-items:center;gap:8px;">
          <span style="width:30px;height:30px;border-radius:50%;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${w.routeId === 1 ? '一' : '二'}</span>
          ${w.stopName}${destTxt} · ${w.routeName} <span class="tag tag-accent">该线 ${cnt} 人</span>
        </div>
        <div class="li-sub" style="margin-top:6px;">${etaText}</div>
        <div class="grid-2" style="gap:8px;margin-top:10px;">
          <button class="btn btn-sm" onclick="resolveWait(${w.stopId}, ${w.routeId}, 'board')">✓ 我已上车</button>
          <button class="btn btn-outline btn-sm" onclick="resolveWait(${w.stopId}, ${w.routeId}, 'leave')">我不等了</button>
        </div>
      </div>`;
  }).join('');
  el.innerHTML = `<div class="text-sm font-bold mb-2" style="color:var(--ink);">🎫 我的等待</div>${rows}`;
}

async function resolveWait(stopId, routeId, reason) {
  try {
    await fetch(API_BASE + '/api/demand/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopId, routeId, reason })
    });
  } catch (e) {}
  myWaits = myWaits.filter(w => !(w.stopId === stopId && w.routeId === routeId));
  saveMyWaits();
  renderMyWaits();
  App.toast(reason === 'board' ? '祝你乘车愉快 🚌' : '已取消等待');
}

function handleDemandResolved(d) {
  const idx = myWaits.findIndex(w => w.stopId === d.stopId && w.routeId === d.routeId);
  if (idx >= 0) {
    if (d.overflow) {
      const nextTxt = d.nextBusId
        ? `本班 ${d.busId} 已满载(下车${d.offCount||0}人/上车${d.served||0}人)，${d.nextBusId} 约 ${d.nextEta} 分钟接你`
        : `本班 ${d.busId} 已满载(下车${d.offCount||0}人/上车${d.served||0}人)，请等下一班`;
      App.toast('⚠️ ' + nextTxt, 4200);
      myWaits[idx].overflowTip = nextTxt;
      saveMyWaits();
      renderMyWaits();
    } else {
      const waitTxt = d.waitDuration ? `（你等了 ${d.waitDuration} 分钟）` : '';
      const offTxt = d.offCount ? `· 到站下车${d.offCount}人` : '';
      App.toast(`🚌 你等的 ${d.busId} 已到 ${d.stopName}，上车${d.served}人${offTxt}${waitTxt}`, 3800);
      myWaits.splice(idx, 1);
      saveMyWaits();
      renderMyWaits();
    }
  }
}

// ========== 我要乘车（选上车站） ==========
function openRideModal() {
  const hot = [3, 15, 9, 12, 2, 8];
  const html = hot.map(id => {
    const s = stopsCache.find(x => x.id === id);
    return s ? stopRow(s) : '';
  }).join('');
  App.showModal(`
    <div class="modal-title">🚌 我要乘车</div>
    <div class="text-sm text-2 mb-2">选择上车站，系统将为你推荐更快线路</div>
    <input class="input" id="ride-search" placeholder="搜索站点，如：中和楼、沁园" style="margin-bottom:10px;" />
    <div id="ride-results">${html}</div>
    <div class="modal-actions"><button class="btn btn-outline btn-block" onclick="App.closeModal()">取消</button></div>`);
  const input = document.getElementById('ride-search');
  input.addEventListener('input', (e) => rideSearch(e.target.value));
}
function rideSearch(q) {
  const el = document.getElementById('ride-results');
  if (!q || !q.trim()) {
    const hot = [3, 15, 9, 12, 2, 8];
    el.innerHTML = hot.map(id => { const s = stopsCache.find(x => x.id === id); return s ? stopRow(s) : ''; }).join('');
    return;
  }
  const ql = q.trim().toLowerCase();
  const matched = stopsCache.filter(s => s.name.toLowerCase().includes(ql));
  if (matched.length === 0) { el.innerHTML = '<div class="text-2 text-sm" style="padding:8px;">无匹配站点</div>'; return; }
  el.innerHTML = matched.map(s => stopRow(s)).join('');
}
function stopRow(s) {
  return `
    <div class="list-item" onclick="reportDemand(${s.id})" style="cursor:pointer;">
      <div style="width:34px;height:34px;border-radius:50%;background:var(--surface);color:var(--ink);display:flex;align-items:center;justify-content:center;font-size:15px;border:1px solid var(--line);">站</div>
      <div class="li-main">
        <div class="li-title">${s.name}</div>
        <div class="li-sub">点此上车并选目的地</div>
      </div>
      <span class="li-action">上车 ›</span>
    </div>`;
}

// ① 上报 — 选目的地，后端推荐更快线路 (v8 OD)
function reportDemand(stopId) {
  const s = stopsCache.find(x => x.id === stopId);
  if (!s) return;
  const others = stopsCache.filter(x => x.id !== stopId);
  const html = others.map(d =>
    `<button class="btn btn-outline btn-block" style="margin:4px 0; text-align:left; padding:12px;" onclick="chooseDest(${stopId}, ${d.id})">${d.name}</button>`
  ).join('');
  App.showModal(`
    <div class="modal-title">${s.name} · 你要去哪站？</div>
    <div class="text-sm text-2 mb-2">选择目的地，系统自动对比一线 / 二线并推荐更快的线路</div>
    <div style="max-height:52vh; overflow-y:auto;">${html}</div>
    <div class="modal-actions"><button class="btn btn-outline btn-block" onclick="App.closeModal()">取消</button></div>`);
}
async function chooseDest(fromId, toId) {
  App.closeModal();
  App.toast('正在对比线路...', 600);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}/api/route/suggest?from=${fromId}&to=${toId}`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (!data.lines) { App.toast('推荐失败: ' + (data.error || '')); return; }
    showRouteSuggest(fromId, toId, data);
  } catch (e) {
    if (e.name === 'AbortError') App.toast('请求超时(5s)，后端未响应', 3000);
    else App.toast('网络错误 → 打开"我的"→"服务器设置"', 3500);
  }
}
function showRouteSuggest(fromId, toId, data) {
  const fromName = stopsCache.find(s => s.id === fromId).name;
  const toName = stopsCache.find(s => s.id === toId).name;
  const reachables = data.lines.filter(l => l.reachable);
  let cards;
  if (reachables.length === 0) {
    cards = '<div class="text-2" style="padding:8px 0;">该目的地暂不可直达，请就近换乘或选择其他站点。</div>';
  } else {
    cards = reachables.map(l => {
      const rec = l.routeId === data.recommend;
      const fullTag = l.full ? `<span class="tag tag-danger">满载 ${l.onboard}/${CAP}</span>` : '';
      return `
        <button class="btn btn-block" style="margin:6px 0; text-align:left; padding:14px; ${rec ? 'border:2px solid var(--accent); background:var(--accent-soft); color:var(--ink);' : 'border:1px solid var(--line);'}" onclick="doReport(${fromId}, ${l.routeId}, ${toId})">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <b>${l.routeName}</b>
            ${rec ? '<span class="tag tag-accent">推荐</span>' : ''}
          </div>
          <div class="text-sm text-2" style="margin-top:2px;">途经 ${l.stopCount} 站 · 最近 ${l.nearestBusId || '无车'} 约 ${l.eta} 分 ${fullTag}</div>
        </button>`;
    }).join('');
  }
  App.showModal(`
    <div class="modal-title">${fromName} → ${toName}</div>
    <div class="text-sm text-2 mb-2">已自动对比一线 / 二线，推荐更快的线路</div>
    ${cards}
    <div class="modal-actions"><button class="btn btn-outline btn-block" onclick="App.closeModal()">取消</button></div>`);
}
async function doReport(stopId, routeId, destStopId) {
  App.closeModal();
  App.toast('上报中...', 800);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(API_BASE + '/api/demand', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopId, routeId, destStopId }), signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.success) {
      myWaits = myWaits.filter(w => !(w.stopId === stopId && w.routeId === routeId));
      myWaits.unshift({ stopId, routeId, destStopName: data.destStopName || '?', stopName: data.stopName, routeName: data.routeName, time: Date.now() });
      saveMyWaits();
      renderMyWaits();
      const tip = data.busId
        ? `${data.stopName}→${data.destStopName} ${data.routeName} 已上报 · 最近 ${data.busId} 约 ${data.eta} 分钟${data.full ? '（该班可能满载，建议留意下一班）' : ''}`
        : `${data.stopName}→${data.destStopName} ${data.routeName} 已上报`;
      App.toast('✓ ' + tip, 3000);
    } else {
      App.toast('上报失败: ' + (data.error || '未知错误'));
    }
  } catch (e) {
    if (e.name === 'AbortError') App.toast('请求超时(5s)，后端未响应', 3000);
    else App.toast('网络错误 → 打开"我的"→"服务器设置"', 3500);
  }
}

// ========== 线路详情（抽屉） ==========
function openRouteSheet(routeId) {
  const route = routesCache.find(r => r.id === routeId);
  if (!route) return;
  const stopMap = {};
  if (App.state && App.state.stops) App.state.stops.forEach(s => { stopMap[s.id] = s; });
  const rows = route.stopIds.map((id, idx) => {
    const stop = stopsCache.find(x => x.id === id);
    if (!stop) return '';
    const d = stopMap[id];
    const waitCount = d ? (routeId === 1 ? d.wait1 : d.wait2) : 0;
    return `
      <div class="list-item" onclick="reportDemand(${id})" style="cursor:pointer;">
        <div style="width:30px;height:30px;border-radius:50%;background:${waitCount > 0 ? 'var(--accent)' : 'var(--surface)'};color:${waitCount > 0 ? '#fff' : 'var(--ink-soft)'};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;border:1px solid var(--line);">${idx + 1}</div>
        <div class="li-main">
          <div class="li-title">${stop.name}${waitCount > 0 ? ` <span class="tag tag-accent">${waitCount}人</span>` : ''}</div>
          <div class="li-sub">${idx === route.stopIds.length - 1 ? '返回起点 (闭环)' : '点击上车并选目的地'}</div>
        </div>
        <span class="li-action">+</span>
      </div>`;
  }).join('');
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">${route.name} · 环线站点</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div class="text-sm text-2 mb-2">共 ${route.stopIds.length - 1} 站 · 首 08:00 / 末 21:30 · 间隔 10 分钟</div>
    ${rows}
    <div class="hint">点站点即可上报等车</div>`);
}

// ========== 服务：失物 / 反馈 / 预测 / 我的上报 ==========
async function loadServiceCounts() {
  try {
    const res = await fetch(API_BASE + '/api/state');
    const data = await res.json();
    const lf = (data.lostFound || []).length;
    const cntEl = document.getElementById('lf-count');
    const subEl = document.getElementById('lf-sub');
    if (cntEl) cntEl.textContent = lf + ' 件';
    if (subEl) subEl.textContent = lf > 0 ? `${lf} 件物品待认领` : '暂无拾获';
  } catch (e) {}
}

function openServiceLostFound() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">🔍 失物招领</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-lf"></div>
    <button class="btn btn-block mt-3" onclick="showLostFoundForm()">+ 发布失物 / 拾物</button>`);
  loadLostFound('sheet-lf');
}
async function loadLostFound(targetId = 'sheet-lf') {
  try {
    const res = await fetch(API_BASE + '/api/state');
    const data = await res.json();
    const list = data.lostFound || [];
    const el = document.getElementById(targetId);
    if (!el) return;
    if (list.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无失物招领信息</div>'; return; }
    el.innerHTML = list.map(item => `
      <div class="list-item">
        <div style="width:36px;height:36px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;font-size:16px;border:1px solid var(--line);">${item.type === '校园卡' ? '🪪' : item.type === '手机' ? '📱' : '🎒'}</div>
        <div class="li-main">
          <div class="li-title">${item.type} <span class="tag tag-accent">${item.status === 'open' ? '待认领' : '已认领'}</span></div>
          <div class="li-sub">${item.desc}</div>
          <div class="text-sm text-2" style="margin-top:2px;">📞 ${item.contact} · ${item.time}</div>
        </div>
      </div>`).join('');
  } catch (e) {}
}
function showLostFoundForm() {
  App.showModal(`
    <div class="modal-title">发布失物 / 拾物</div>
    <div class="form-group"><label class="form-label">物品类型</label>
      <select class="select" id="lf-type"><option>校园卡</option><option>手机</option><option>钱包</option><option>钥匙</option><option>其他</option></select>
    </div>
    <div class="form-group"><label class="form-label">详细描述</label><textarea class="textarea" id="lf-desc" placeholder="例如: 蓝色校园卡，在中和楼捡到"></textarea></div>
    <div class="form-group"><label class="form-label">联系方式</label><input class="input" id="lf-contact" placeholder="手机号/微信" /></div>
    <div class="modal-actions"><button class="btn btn-block" onclick="submitLostFound()">发布</button><button class="btn btn-outline btn-block" onclick="App.closeModal()">取消</button></div>`);
}
async function submitLostFound() {
  const type = document.getElementById('lf-type').value;
  const desc = document.getElementById('lf-desc').value.trim();
  const contact = document.getElementById('lf-contact').value.trim();
  if (!desc) { App.toast('请填写描述'); return; }
  try {
    await fetch(API_BASE + '/api/lostfound', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, desc, contact })
    });
    App.closeModal();
    App.toast('发布成功');
    loadLostFound('sheet-lf');
    loadServiceCounts();
  } catch (e) { App.toast('发布失败'); }
}

function openServiceFeedback() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">🛠 意见反馈</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div class="form-group"><label class="form-label">问题类型</label>
      <select class="select" id="fb-type">
        <option value="晚点">车辆晚点</option>
        <option value="卫生">车内卫生</option>
        <option value="设施">站点设施损坏</option>
        <option value="服务">服务态度</option>
        <option value="其他">其他</option>
      </select>
    </div>
    <div class="form-group"><label class="form-label">问题描述</label><textarea class="textarea" id="fb-content" placeholder="请详细描述问题..."></textarea></div>
    <div class="form-group"><label class="form-label">联系方式 (可选)</label><input class="input" id="fb-contact" placeholder="手机号/学号" /></div>
    <button class="btn btn-block" onclick="submitFeedback()">提交反馈</button>`);
}
async function submitFeedback() {
  const type = document.getElementById('fb-type').value;
  const content = document.getElementById('fb-content').value.trim();
  const contact = document.getElementById('fb-contact').value.trim();
  if (!content) { App.toast('请填写问题描述'); return; }
  try {
    const res = await fetch(API_BASE + '/api/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, content, contact })
    });
    const data = await res.json();
    if (data.success) {
      myReports.unshift(data.feedback);
      localStorage.setItem('student-reports', JSON.stringify(myReports));
      App.closeSheet();
      App.toast('提交成功');
      loadMyReports();
    }
  } catch (e) { App.toast('提交失败'); }
}

function openServiceForecast() {
  const s = App.state;
  let w1 = 0, w2 = 0;
  if (s && s.stops) {
    s.stops.forEach(st => { w1 += (st.wait1 || 0); w2 += (st.wait2 || 0); });
  }
  const total = w1 + w2;
  const note = total === 0
    ? '当前各站暂无候车，出行顺畅 🚌'
    : (total >= 15 ? '未来 30 分钟候车较集中，建议错峰或就近乘车' : '未来 30 分钟总体平稳，可正常出行');
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">📈 出行预测</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div class="stat-row" style="margin-top:6px;">
      <div class="stat"><div class="stat-n">${w1}</div><div class="stat-l">一线候车</div></div>
      <div class="stat"><div class="stat-n">${w2}</div><div class="stat-l">二线候车</div></div>
      <div class="stat"><div class="stat-n">${total}</div><div class="stat-l">合计</div></div>
    </div>
    <div class="card" style="margin-top:14px;padding:14px;">
      <div class="li-title">未来 30 分钟</div>
      <div class="li-sub" style="margin-top:6px;">${note}</div>
    </div>
    <div class="hint">数据来自各站实时候车人数，随运行动态更新</div>`);
}

function openServiceMyReports() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">🕒 我的上报</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-myreports"></div>`);
  const el = document.getElementById('sheet-myreports');
  if (myWaits.length === 0 && myReports.length === 0) {
    el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无上报记录</div>'; return;
  }
  let html = '';
  if (myWaits.length) {
    html += '<div class="text-sm font-bold mb-2" style="color:var(--ink);">等待中</div>';
    html += myWaits.map(w => `<div class="list-item"><div class="li-main"><div class="li-title">${w.stopName} → ${w.destStopName || '—'} · ${w.routeName}</div><div class="li-sub">报站等待中</div></div></div>`).join('');
  }
  if (myReports.length) {
    html += '<div class="text-sm font-bold mb-2 mt-3" style="color:var(--ink);">反馈记录</div>';
    html += myReports.slice(0, 8).map(f => `
      <div style="padding:8px 0;border-bottom:1px solid var(--line);">
        <div class="flex gap-2" style="align-items:center;"><span class="tag tag-${f.status === 'replied' ? 'accent' : 'soft'}">${f.status === 'replied' ? '已回复' : '待处理'}</span><span class="text-sm text-2">${f.type}</span></div>
        <div class="text-sm mt-2">${f.content}</div>
        ${f.reply ? `<div class="text-sm text-accent" style="margin-top:4px;">司机回复: ${f.reply}</div>` : ''}
      </div>`).join('');
  }
  el.innerHTML = html;
}

// ========== 公告 / 我的 ==========
async function loadNotices() {
  try {
    const res = await fetch(API_BASE + '/api/state');
    const data = await res.json();
    const notices = data.notices || [];
    const el = document.getElementById('nt-list');
    if (notices.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无公告</div>'; return; }
    el.innerHTML = notices.map(n => `
      <div style="padding:14px 0;border-bottom:1px solid var(--line);">
        <div class="flex gap-2 mb-2" style="align-items:center;">
          ${n.type === 'top' ? '<span class="tag tag-danger">置顶</span>' : '<span class="tag tag-soft">普通</span>'}
          <span class="font-bold text-sm" style="color:var(--ink);">${n.title}</span>
        </div>
        <div class="text-sm text-2">${n.content || ''}</div>
        <div class="text-sm text-2 mt-2">${n.time}</div>
      </div>`).join('');
  } catch (e) {}
}
function loadMyReports() { /* 反馈记录现于抽屉展示，保留以便扩展 */ }

function openMeWaits() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">🚌 我的报站</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-mewaits"></div>`);
  const el = document.getElementById('sheet-mewaits');
  if (myWaits.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无报站</div>'; return; }
  el.innerHTML = myWaits.map(w => `
    <div class="list-item">
      <div style="width:32px;height:32px;border-radius:50%;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${w.routeId === 1 ? '一' : '二'}</div>
      <div class="li-main"><div class="li-title">${w.stopName} → ${w.destStopName || '—'}</div><div class="li-sub">${w.routeName} · 等待中</div></div>
    </div>`).join('');
}
function openMeFeedback() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">💬 我的反馈</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-mefb"></div>`);
  const el = document.getElementById('sheet-mefb');
  if (myReports.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无反馈</div>'; return; }
  el.innerHTML = myReports.slice(0, 10).map(f => `
    <div style="padding:10px 0;border-bottom:1px solid var(--line);">
      <div class="flex gap-2" style="align-items:center;"><span class="tag tag-${f.status === 'replied' ? 'accent' : 'soft'}">${f.status === 'replied' ? '已回复' : '待处理'}</span><span class="text-sm text-2">${f.type}</span><span class="text-sm text-2">${f.time}</span></div>
      <div class="text-sm mt-2">${f.content}</div>
      ${f.reply ? `<div class="text-sm text-accent" style="margin-top:4px;">司机回复: ${f.reply}</div>` : ''}
    </div>`).join('');
}
function openMeNotices() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">🔔 消息通知</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-menotice"></div>`);
  const el = document.getElementById('sheet-menotice');
  const notices = (App.state && App.state.notices) || [];
  if (notices.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无通知</div>'; return; }
  el.innerHTML = notices.map(n => `
    <div style="padding:12px 0;border-bottom:1px solid var(--line);">
      <div class="li-title">${n.title}</div>
      <div class="li-sub">${n.content || ''}</div>
      <div class="text-sm text-2 mt-2">${n.time}</div>
    </div>`).join('');
}
function openMeAbout() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">ℹ️ 关于智行校园</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div style="text-align:center;padding:14px 0;">
      <div style="font-size:34px;">🚌</div>
      <div class="text-xl font-bold mt-2">智行校园</div>
      <div class="text-2 text-sm mt-1">南审校园小公交 · 实时调度系统</div>
      <div class="text-2 text-sm mt-3">v1.0 · 演示版</div>
    </div>
    <div class="card" style="margin-top:8px;padding:14px;">
      <div class="li-sub">实时地图 · 双线智能选线 · 按需动态调度 · 高峰/平峰/夜间模式 · 拥挤度同步 · 公告/反馈/失物招领</div>
    </div>`);
}

init();
