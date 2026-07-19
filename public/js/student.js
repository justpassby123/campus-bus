// ============================================================
//  student.js - 学生端逻辑 v5
//  ① 上报先选一线/二线   ② 我的等待卡(我已上车/我不等了)
// ============================================================
let stopsCache = [];
let routesCache = [];
let currentRouteId = 1;
let currentTab = 'home';
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
  el.style.color = ok ? '#16A34A' : '#DC2626';
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
  document.getElementById('search-input').addEventListener('input', (e) => searchStops(e.target.value));
  document.querySelectorAll('.route-btn').forEach(b => {
    b.addEventListener('click', () => {
      currentRouteId = parseInt(b.dataset.route);
      document.querySelectorAll('.route-btn').forEach(x => {
        x.className = x.dataset.route == currentRouteId ? 'btn route-btn active' : 'btn btn-outline route-btn';
      });
      renderRouteDetail();
    });
  });
  document.getElementById('btn-fb-submit').addEventListener('click', submitFeedback);

  loadNotices();
  loadLostFound();
  loadMyReports();
  showHotStops();
  renderMyWaits();

  setInterval(async () => {
    try { await App.fetchState(); renderAll(); } catch (e) {}
  }, 2000);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  document.getElementById('tab-' + tab).classList.remove('hidden');
  if (tab === 'route') renderRouteDetail();
  if (tab === 'service') loadLostFound();
  if (tab === 'notice') loadNotices();
  if (tab === 'me') { loadMyReports(); renderFleetInfo(); }
}

function renderAll() {
  const s = App.state;
  if (!s) return;

  document.getElementById('header-period').textContent = App.periodText(s.timePeriod) + '时段';

  const peakBanner = document.getElementById('s-peak-banner');
  if (s.timePeriod === 'peak') {
    peakBanner.classList.remove('hidden');
    document.getElementById('s-peak-text').textContent =
      new Date().getHours() < 9 ? '早高峰 8:00-9:00，候车时间可能延长' :
      new Date().getHours() < 14 ? '午餐时段 11:00-14:00，餐厅站较拥挤' :
      '晚高峰 16:00-19:00，建议提前出门';
  } else {
    peakBanner.classList.add('hidden');
  }

  const fleet = s.fleet || { operating: 0, resting: 0, total: 9, daily: 8 };
  const resting = fleet.resting || 0;
  document.getElementById('s-fleet-sub').textContent =
    `运营 ${fleet.operating} 辆 · 待命 ${resting} 辆 · 共 ${fleet.daily} 辆日常车`;
  document.getElementById('s-bus-count').textContent = (s.buses ? s.buses.filter(b => b.status === 'operating').length : 0) + ' 辆';

  // 地图
  const ops = s.buses ? s.buses.filter(b => b.status === 'operating') : [];
  const restingBuses = s.buses ? s.buses.filter(b => b.status !== 'operating') : [];
  MapView.render('map-student', s.stops, ops, { restArea: s.restArea, restingBuses });

  renderBusList(ops);
  renderTopNotices();
  renderMyWaits();
}

function renderBusList(ops) {
  const el = document.getElementById('s-bus-list');
  if (!ops || ops.length === 0) {
    el.innerHTML = '<div class="text-2 text-center" style="padding: 12px;">当前无运营车辆</div>';
    return;
  }
  el.innerHTML = ops.map(b => {
    const route = routesCache.find(r => r.id === b.routeId);
    const crowd = { empty: ['🟢', '空载'], medium: ['🟡', '适中'], crowded: ['🔴', '拥挤'] }[b.crowd] || ['⚪', ''];
    return `
      <div class="list-item">
        <div style="width: 32px; height: 32px; border-radius: 50%; background: #1F2937; color:#fff; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px;">${b.id.replace('#', '')}</div>
        <div class="li-main">
          <div class="li-title">${b.id} · ${route ? route.name : ''} · ${crowd[1]}</div>
          <div class="li-sub">${b.currentStopName} → ${b.nextStopName} · ${b.speed} km/h</div>
        </div>
      </div>`;
  }).join('');
}

// ========== ② 我的等待卡 ==========
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
    const etaText = busId ? `最近 ${busId} 约 ${eta} 分钟到站` : '暂无该线运营车，请耐心等待';
    return `
      <div class="list-item">
        <div style="width: 34px; height: 34px; border-radius: 50%; background: #2563EB; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:600; font-size:12px;">${w.routeId === 1 ? '一' : '二'}</div>
        <div class="li-main">
          <div class="li-title">${w.stopName} · ${w.routeName} <span class="tag tag-danger">该线 ${cnt} 人</span></div>
          <div class="li-sub">${etaText}</div>
        </div>
      </div>
      <div class="grid-2" style="gap:8px; margin: 4px 0 10px;">
        <button class="btn btn-sm" onclick="resolveWait(${w.stopId}, ${w.routeId}, 'board')">✓ 我已上车</button>
        <button class="btn btn-sm btn-outline" onclick="resolveWait(${w.stopId}, ${w.routeId}, 'leave')">我不等了</button>
      </div>`;
  }).join('');
  el.innerHTML = `<div class="card"><div class="card-title">🎫 我的等待</div>${rows}</div>`;
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

// 司机到站接客 → 若命中我的等待, 自动提醒并核销
function handleDemandResolved(d) {
  const idx = myWaits.findIndex(w => w.stopId === d.stopId && w.routeId === d.routeId);
  if (idx >= 0) {
    App.toast(`🚌 你等的 ${d.busId} 已到 ${d.stopName}，请上车！`, 3800);
    myWaits.splice(idx, 1);
    saveMyWaits();
    renderMyWaits();
  }
}

function renderTopNotices() {
  const el = document.getElementById('s-notice-top');
  if (!App.state || !App.state.notices) { el.innerHTML = ''; return; }
  const top = App.state.notices.filter(n => n.type === 'top').slice(0, 1);
  if (top.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = top.map(n => `
    <div class="card" style="background: #FEF3C7; border-color: #FCD34D;">
      <div class="flex gap-2" style="align-items: center;">
        <span style="font-size: 18px;">📢</span>
        <div class="flex-1">
          <div class="font-bold">${n.title}</div>
          <div class="text-sm text-2 mt-2">${n.content || ''}</div>
        </div>
      </div>
    </div>`).join('');
}

function searchStops(q) {
  const el = document.getElementById('search-results');
  if (!q || !q.trim()) { showHotStops(); return; }
  const ql = q.trim().toLowerCase();
  const matched = stopsCache.filter(s => s.name.toLowerCase().includes(ql));
  if (matched.length === 0) {
    el.innerHTML = '<div class="text-2 text-sm" style="padding: 8px;">无匹配站点</div>';
    return;
  }
  el.innerHTML = matched.map(s => stopRow(s)).join('');
}

function showHotStops() {
  const el = document.getElementById('search-results');
  if (!stopsCache || stopsCache.length === 0) {
    el.innerHTML = '<div class="text-2 text-sm" style="padding: 8px;">加载中...</div>';
    return;
  }
  const hot = [3, 15, 9, 12, 2, 8];
  el.innerHTML = '<div class="font-bold mb-2">🔥 热门站点</div>' + hot.map(id => {
    const s = stopsCache.find(x => x.id === id);
    return s ? stopRow(s) : '';
  }).join('');
}

function stopRow(s) {
  return `
    <div class="list-item" onclick="reportDemand(${s.id})" style="cursor: pointer;">
      <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--gray-100); color: var(--text); display: flex; align-items: center; justify-content: center; font-size: 16px;">📍</div>
      <div class="li-main">
        <div class="li-title">${s.name}</div>
        <div class="li-sub">点此上报等车</div>
      </div>
      <span class="li-action">上报 ›</span>
    </div>`;
}

// ① 上报时先选线路
function reportDemand(stopId) {
  const s = stopsCache.find(x => x.id === stopId);
  if (!s) return;
  App.showModal(`
    <div class="modal-title">🚏 ${s.name} · 选择乘坐线路</div>
    <div class="grid-2" style="gap: 10px; margin-top: 6px;">
      <button class="btn btn-lg" onclick="doReport(${stopId}, 1)">一线</button>
      <button class="btn btn-lg btn-outline" onclick="doReport(${stopId}, 2)">二线</button>
    </div>
    <div class="modal-actions"><button class="btn btn-outline btn-block" onclick="App.closeModal()">取消</button></div>`);
}

async function doReport(stopId, routeId) {
  App.closeModal();
  App.toast('上报中...', 800);
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(API_BASE + '/api/demand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopId, routeId }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.success) {
      myWaits = myWaits.filter(w => !(w.stopId === stopId && w.routeId === routeId));
      myWaits.unshift({ stopId, routeId, stopName: data.stopName, routeName: data.routeName, time: Date.now() });
      saveMyWaits();
      renderMyWaits();
      const tip = data.busId
        ? `${data.stopName} ${data.routeName} 已上报 · 最近 ${data.busId} 约 ${data.eta} 分钟`
        : `${data.stopName} ${data.routeName} 已上报`;
      App.toast('✓ ' + tip, 3000);
    } else {
      App.toast('上报失败: ' + (data.error || '未知错误'));
    }
  } catch (e) {
    if (e.name === 'AbortError') App.toast('请求超时(5s)，后端未响应', 3000);
    else App.toast('网络错误 → 打开"我的"→"修改服务器地址"', 3500);
  }
}

function renderRouteDetail() {
  if (!routesCache.length || !stopsCache.length) return;
  const route = routesCache.find(r => r.id === currentRouteId) || routesCache[0];
  document.getElementById('rt-current').textContent = `${route.name} · 共 ${route.stopIds.length - 1} 站 · 点击站点上报本线等车`;

  const stopMap = {};
  if (App.state && App.state.stops) App.state.stops.forEach(s => { stopMap[s.id] = s; });

  document.getElementById('rt-stops-list').innerHTML = route.stopIds.map((id, idx) => {
    const stop = stopsCache.find(x => x.id === id);
    if (!stop) return '';
    const d = stopMap[id];
    const waitCount = d ? (currentRouteId === 1 ? d.wait1 : d.wait2) : 0;
    return `
      <div class="list-item" onclick="doReport(${id}, ${currentRouteId})" style="cursor: pointer;">
        <div style="width: 30px; height: 30px; border-radius: 50%; background: ${waitCount > 0 ? '#DC2626' : '#F3F4F6'}; color: ${waitCount > 0 ? '#fff' : '#6B7280'}; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 12px;">${idx + 1}</div>
        <div class="li-main">
          <div class="li-title">${stop.name}${waitCount > 0 ? ` <span class="tag tag-danger">${waitCount}人</span>` : ''}</div>
          <div class="li-sub">${idx === route.stopIds.length - 1 ? '返回中和楼 (闭环)' : '点击上报' + route.name + '等车'}</div>
        </div>
        <span class="li-action">+</span>
      </div>`;
  }).join('');
}

async function loadLostFound() {
  try {
    const res = await fetch(API_BASE + '/api/state');
    const data = await res.json();
    const list = data.lostFound || [];
    document.getElementById('lf-count').textContent = list.length + ' 条';
    const el = document.getElementById('lf-list');
    if (list.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding: 16px;">暂无失物招领信息</div>'; return; }
    el.innerHTML = list.map(item => `
      <div class="list-item">
        <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--gray-100); display: flex; align-items: center; justify-content: center; font-size: 16px;">${item.type === '校园卡' ? '🪪' : item.type === '手机' ? '📱' : '🎒'}</div>
        <div class="li-main">
          <div class="li-title">${item.type} <span class="tag tag-accent">${item.status === 'open' ? '待认领' : '已认领'}</span></div>
          <div class="li-sub">${item.desc}</div>
          <div class="text-sm text-2" style="margin-top: 2px;">📞 ${item.contact} · ${item.time}</div>
        </div>
      </div>`).join('');
  } catch (e) {}
}

function showLostFoundForm() {
  App.showModal(`
    <div class="modal-title">发布失物/拾物</div>
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
    loadLostFound();
  } catch (e) {
    App.toast('发布失败');
  }
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
      App.toast('提交成功');
      document.getElementById('fb-content').value = '';
      document.getElementById('fb-contact').value = '';
      loadMyReports();
    }
  } catch (e) {
    App.toast('提交失败');
  }
}

function loadMyReports() {
  const el = document.getElementById('me-fb-history');
  if (!el) return;
  if (myReports.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding: 12px;">暂无反馈</div>'; return; }
  el.innerHTML = myReports.slice(0, 5).map(f => `
    <div style="padding: 8px 0; border-bottom: 1px solid var(--gray-100);">
      <div class="flex gap-2" style="align-items: center;">
        <span class="tag tag-${f.status === 'replied' ? 'success' : 'warning'}">${f.status === 'replied' ? '已回复' : '待处理'}</span>
        <span class="text-sm text-2">${f.type}</span>
      </div>
      <div class="text-sm mt-2">${f.content}</div>
      ${f.reply ? `<div class="text-sm text-accent" style="margin-top:4px;">司机回复: ${f.reply}</div>` : ''}
      <div class="text-sm text-2 mt-2">${f.time}</div>
    </div>`).join('');
}

function renderFleetInfo() {
  const s = App.state;
  const el = document.getElementById('me-fleet');
  if (!s || !s.fleet) { el.innerHTML = '加载中...'; return; }
  const f = s.fleet;
  el.innerHTML = `共 ${f.total} 辆车 (日常 ${f.daily} 辆 + 备班 ${f.backup} 辆)，当前运营 <b>${f.operating}</b> 辆 (一线 ${f.line1Operating} + 二线 ${f.line2Operating})。全程约 ${f.loopMinutes} 分钟，每线约 ${f.headway1 || 10} 分钟一班。`;
}

async function loadNotices() {
  try {
    const res = await fetch(API_BASE + '/api/state');
    const data = await res.json();
    const notices = data.notices || [];
    const el = document.getElementById('nt-list');
    if (notices.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding: 16px;">暂无公告</div>'; return; }
    el.innerHTML = notices.map(n => `
      <div style="padding: 12px 0; border-bottom: 1px solid var(--gray-100);">
        <div class="flex gap-2 mb-2" style="align-items: center;">
          ${n.type === 'top' ? '<span class="tag tag-danger">置顶</span>' : '<span class="tag">普通</span>'}
          <span class="font-bold text-sm">${n.title}</span>
        </div>
        <div class="text-sm text-2">${n.content || ''}</div>
        <div class="text-sm text-2 mt-2">${n.time}</div>
      </div>`).join('');
  } catch (e) {}
}

init();
