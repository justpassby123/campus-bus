// ============================================================
//  driver.js - 司机端逻辑 v5
//  ① 每站两线人数并列  ③ 调度台派车/召回  ⑥ 载客/22  ⑦ 排班
// ============================================================
let stopsCache = [];
let routesCache = [];
let currentTab = 'drive';
let currentBusId = '#01';
let currentDemand = [];

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
  const el = document.getElementById('d-api-status');
  if (!el) return;
  const base = API_BASE || location.origin;
  el.textContent = ok ? `已连接 ${base}` : `未连接 ${base}`;
  el.style.color = ok ? '#16A34A' : '#DC2626';
}

async function init() {
  try {
    const [stopsRes, routesRes] = await Promise.all([
      fetch(API_BASE + '/api/stops').then(r => r.json()),
      fetch(API_BASE + '/api/routes').then(r => r.json())
    ]);
    stopsCache = stopsRes;
    routesCache = routesRes;
  } catch (e) {
    App.toast('连接服务器失败');
    updateApiStatus(false);
    return;
  }
  updateApiStatus(true);

  await App.fetchState();
  renderAll();

  App.initSocket();
  window.onStateUpdate = renderAll;

  document.querySelectorAll('.tab-item').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  bindActions();
  loadFeedbacks();

  setInterval(async () => {
    try { await App.fetchState(); renderAll(); } catch (e) {}
  }, 2000);
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById('tab-' + tab);
  if (el) el.classList.remove('hidden');
  if (tab === 'route') renderRoute();
  if (tab === 'dispatch') renderDispatch();
  if (tab === 'attendance') renderAttendance();
  if (tab === 'exception') renderExceptions();
  if (tab === 'me') loadFeedbacks();
}

function getBus(id) {
  return App.state ? App.state.buses.find(b => b.id === id) : null;
}

function renderAll() {
  const s = App.state;
  if (!s) return;

  const cur = getBus(currentBusId) || s.buses[0];
  document.getElementById('header-bus').textContent = cur.id;
  document.getElementById('header-status').textContent = App.statusText(cur.status);

  const f = s.fleet || { total: 9, backup: 1, operating: 0, resting: 0 };
  document.getElementById('d-fleet-sub').textContent = `共 ${f.total} · 运营 ${f.operating} · 待命 ${f.resting || 0}`;
  renderFleetGrid(s.buses);

  // 休息区面板
  const restPanel = document.getElementById('d-rest-panel');
  if (cur.status === 'resting') {
    restPanel.classList.remove('hidden');
    document.getElementById('d-rest-laps').textContent = `完成 ${cur.lapsCompleted} 圈 · 准备发车`;
  } else if (cur.status === 'standby') {
    restPanel.classList.remove('hidden');
    document.getElementById('d-rest-laps').textContent = '待命车辆 · 可派车';
  } else if (cur.status === 'backup') {
    restPanel.classList.remove('hidden');
    document.getElementById('d-rest-laps').textContent = '备班车辆 · 紧急派车';
  } else {
    restPanel.classList.add('hidden');
  }

  // 当前车辆
  const route = routesCache.find(r => r.id === cur.routeId) || routesCache[0];
  document.getElementById('d-bus-id').textContent = '车辆 ' + cur.id;
  document.getElementById('d-driver').textContent = '司机：' + cur.driver + (cur.shift ? ' · ' + cur.shift : '');
  document.getElementById('d-route-name').textContent = route.name;
  document.getElementById('d-status-info').textContent = App.statusText(cur.status);
  document.getElementById('d-status-info').className = 'tag tag-' + App.statusClass(cur.status);
  document.getElementById('d-current-stop').textContent = cur.currentStopName;
  document.getElementById('d-next-stop').textContent = cur.nextStopName;

  // 地图
  const ops = s.buses.filter(b => b.status === 'operating');
  const parkedBuses = s.buses.filter(b => b.status !== 'operating');
  MapView.render('map-driver', s.stops, ops, { restArea: s.restArea, parkedBuses, routes: routesCache });

  // 需求列表 (两线并列)
  renderDemandList();

  // 拥挤度按钮
  document.querySelectorAll('#d-crowd-group [data-crowd]').forEach(b => {
    if (b.dataset.crowd === cur.crowd) {
      b.className = b.dataset.crowd === 'empty' ? 'btn btn-success' :
                    b.dataset.crowd === 'medium' ? 'btn' : 'btn btn-danger';
    } else {
      b.className = 'btn btn-outline';
    }
  });

  // 载客量
  document.getElementById('d-onboard').textContent = cur.onboard || 0;
  document.getElementById('d-capacity').textContent = s.capacity || 22;

  // 状态按钮
  const btnArrive = document.getElementById('btn-arrive');
  const btnTempStop = document.getElementById('btn-temp-stop');
  const btnStatus = document.getElementById('btn-status');
  const isOperating = cur.status === 'operating';
  const isParked = ['resting', 'standby', 'backup'].includes(cur.status);
  btnArrive.disabled = !isOperating;
  btnTempStop.disabled = !isOperating;
  if (isParked) {
    btnStatus.textContent = '🅿️ 已在休息区';
    btnStatus.disabled = true;
  } else {
    btnStatus.textContent = '🔄 召回休息区';
    btnStatus.disabled = false;
  }

  document.getElementById('d-period').textContent = App.periodText(s.timePeriod) + '时段';

  if (currentTab === 'dispatch') renderDispatch();
}

function renderFleetGrid(buses) {
  const el = document.getElementById('d-fleet-grid');
  el.innerHTML = buses.map(b => {
    let bg, color;
    if (b.status === 'operating') { bg = '#1F2937'; color = '#fff'; }
    else if (b.status === 'standby') { bg = '#F3F4F6'; color = '#6B7280'; }
    else { bg = '#fff'; color = '#9CA3AF'; }
    const sel = b.id === currentBusId ? 'outline: 2px solid #2563EB; outline-offset: 1px;' : '';
    return `<div onclick="selectBus('${b.id}')" style="text-align:center; padding:8px 4px; border-radius:6px; font-size:12px; font-weight:600; background: ${bg}; color: ${color}; ${b.status === 'resting' ? 'border: 1px dashed #6B7280;' : ''} ${sel}">${b.id.replace('#','')}<div style="font-size:10px; font-weight:400; opacity:0.85;">${App.statusText(b.status)}</div></div>`;
  }).join('');
}

function selectBus(id) {
  currentBusId = id;
  renderAll();
}

// ① 需求列表: 每站两线人数并列显示
function renderDemandList() {
  const s = App.state;
  const list = document.getElementById('d-demand-list');
  const cnt = document.getElementById('d-demand-count');
  const waited = (s.stops || []).filter(st => st.waitCount > 0);
  const total = waited.reduce((sum, st) => sum + st.waitCount, 0);
  cnt.textContent = total + ' 人';
  cnt.className = total > 0 ? 'tag tag-danger' : 'tag';

  if (waited.length === 0) {
    list.innerHTML = '<div class="text-2 text-center" style="padding: 16px;">暂无等车需求</div>';
    return;
  }
  const sched = s.schedule || [];
  waited.sort((a, b) => b.waitCount - a.waitCount);
  list.innerHTML = waited.map(st => {
    const e1 = sched.find(x => x.id === st.id && x.routeId === 1);
    const e2 = sched.find(x => x.id === st.id && x.routeId === 2);
    const sub = [];
    if (st.wait1 > 0 && e1) sub.push(`一线最近 ${e1.nearestBusId || '无车'}${e1.nearestBusId ? ' 约' + e1.eta + '分' : ''}`);
    if (st.wait2 > 0 && e2) sub.push(`二线最近 ${e2.nearestBusId || '无车'}${e2.nearestBusId ? ' 约' + e2.eta + '分' : ''}`);
    return `
      <div class="list-item">
        <div style="width: 30px; height: 30px; border-radius: 50%; background: #F3F4F6; color:#374151; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px;">${st.name.slice(0,1)}</div>
        <div class="li-main">
          <div class="li-title">${st.name}
            ${st.wait1 > 0 ? `<span class="tag tag-danger">一线 ${st.wait1}</span>` : ''}
            ${st.wait2 > 0 ? `<span class="tag tag-accent">二线 ${st.wait2}</span>` : ''}
          </div>
          <div class="li-sub">${sub.join(' · ') || '等待中'}</div>
        </div>
      </div>`;
  }).join('');
}

// ③ 调度台
function renderDispatch() {
  const s = App.state;
  if (!s) return;
  const sched = s.schedule || [];

  // 高峰状态 + 车队计数 (不再展示"间隔")
  const peak = s.peak || { active: false, manual: false, label: '' };
  const hw = document.getElementById('dp-headway');
  if (hw && s.fleet) {
    const avg = s.stats && s.stats.samples ? ` · 累计均候 ${s.stats.avgWait} 分(${s.stats.samples}次)` : '';
    hw.textContent = `运营 ${s.fleet.operating} 辆 · 待命 ${s.fleet.resting || 0} 辆${avg}`;
  }
  const btnPeak = document.getElementById('btn-peak');
  if (btnPeak) {
    btnPeak.textContent = peak.active ? '🟢 高峰中·点击退出' : '🔴 开启演示高峰';
    btnPeak.className = peak.active ? 'btn btn-sm btn-success' : 'btn btn-sm btn-outline-danger';
  }
  const pb = document.getElementById('dp-peak-banner');
  if (pb) {
    if (peak.active) {
      pb.classList.remove('hidden');
      document.getElementById('dp-peak-text').textContent =
        peak.manual ? '演示模式：待命车已热备，压力站可一键增发'
          : (peak.label + '：待命车已热备，压力站可一键增发');
    } else pb.classList.add('hidden');
  }

  // 智能建议 / 需求榜
  const sug = document.getElementById('dp-suggest');
  if (sched.length === 0) {
    sug.innerHTML = '<div class="text-2 text-center" style="padding: 12px;">当前候车压力小，暂无需增发</div>';
  } else {
    sug.innerHTML = sched.slice(0, 6).map((d, i) => {
      const hi = i === 0;
      const pc = d.priority === 'high' ? '#DC2626' : d.priority === 'medium' ? '#D97706' : '#9CA3AF';
      const dispatchBtn = (d.suggestDispatch && d.nearbyBusId)
        ? `<button class="btn btn-sm btn-danger" style="margin-left:8px;" onclick="quickDispatch('${d.nearbyBusId}', ${d.routeId})">⚡ 一键增发</button>`
        : '';
      return `
        <div class="list-item" ${hi ? 'style="background:#FEF3C7;border-radius:6px;padding:10px;"' : ''}>
          <div style="width:26px;height:26px;border-radius:50%;background:${pc};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;">${i + 1}</div>
          <div class="li-main">
            <div class="li-title">${d.name} · ${d.routeName} <span class="tag tag-danger">${d.waitCount}人</span></div>
            <div class="li-sub">已等 ${d.waitDuration} 分 · 最近 ${d.nearestBusId || '无车'}${d.nearestBusId ? ' 约' + d.eta + '分' : ''}${d.avgWait ? ' · 历史均候 ' + d.avgWait + '分' : ''}${hi ? ' · 建议优先增发' : ''}</div>
          </div>
          ${dispatchBtn}
        </div>`;
    }).join('');
  }

  // 可用车辆 (待命/备班)
  const avail = s.buses.filter(b => ['standby', 'backup', 'resting'].includes(b.status));
  const av = document.getElementById('dp-available');
  av.innerHTML = avail.length === 0
    ? '<div class="text-2 text-center" style="padding: 12px;">无可用车辆</div>'
    : avail.map(b => `
      <div class="list-item">
        <div style="width:34px;height:34px;border-radius:50%;background:#F3F4F6;color:#374151;display:flex;align-items:center;justify-content:center;font-weight:600;">${b.id.replace('#','')}</div>
        <div class="li-main">
          <div class="li-title">${b.id} <span class="tag">${App.statusText(b.status)}</span></div>
          <div class="li-sub">司机 ${b.driver} · 停沁园休息区</div>
        </div>
        <div class="grid-2" style="gap:6px; width:130px;">
          <button class="btn btn-sm" onclick="dispatchBus('${b.id}', 1)">派一线</button>
          <button class="btn btn-sm btn-outline" onclick="dispatchBus('${b.id}', 2)">派二线</button>
        </div>
      </div>`).join('');

  // 运营中车辆
  const ops = s.buses.filter(b => b.status === 'operating');
  const opEl = document.getElementById('dp-operating');
  opEl.innerHTML = ops.map(b => {
    const rn = (routesCache.find(r => r.id === b.routeId) || {}).name || '';
    return `
      <div class="list-item">
        <div style="width:34px;height:34px;border-radius:50%;background:#1F2937;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;">${b.id.replace('#','')}</div>
        <div class="li-main">
          <div class="li-title">${b.id} · ${rn} · ${App.crowdText(b.crowd)}</div>
          <div class="li-sub">${b.currentStopName} → ${b.nextStopName} · 载客 ${b.onboard}/${s.capacity || 22}</div>
        </div>
        <button class="btn btn-sm btn-outline" onclick="recallBus('${b.id}')">召回</button>
      </div>`;
  }).join('');
}

function dispatchBus(id, routeId) {
  fetch(API_BASE + '/api/bus/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: id, routeId })
  }).then(r => r.json()).then(d => {
    App.toast(d.success ? `✓ ${id} 已派往${d.routeName}` : '派车失败: ' + (d.error || ''));
  });
}

// ③ 调度台一键增发 (压力站直接派最近待命车)
function quickDispatch(id, routeId) {
  fetch(API_BASE + '/api/bus/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: id, routeId })
  }).then(r => r.json()).then(d => {
    App.toast(d.success ? `⚡ ${id} 已增发 ${d.routeName}` : '增发失败: ' + (d.error || ''));
  });
}

// 演示高峰模式开关 (答辩演示随时可触发)
function togglePeak() {
  fetch(API_BASE + '/api/peak/toggle', { method: 'POST' })
    .then(r => r.json()).then(d => {
      App.toast(d.active ? '已开启演示高峰模式' : '已退出高峰模式');
      renderDispatch();
    });
}

// 一键演示晚课放学 (中和楼/敏行楼/竞秀楼 并发高峰 + 强制高峰)
function demoEveningRush() {
  fetch(API_BASE + '/api/demo/evening-rush', { method: 'POST' })
    .then(r => r.json()).then(d => {
      if (d.success) {
        App.toast('🌆 已模拟晚课放学高峰：中和楼/敏行楼/竞秀楼并发候车', 3500);
        renderDispatch();
      } else App.toast('演示注入失败');
    });
}

function recallBus(id) {
  if (!confirm('将 ' + id + ' 召回沁园休息区？')) return;
  fetch(API_BASE + '/api/bus/recall', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: id })
  }).then(r => r.json()).then(d => {
    App.toast(d.success ? id + ' 已召回休息区' : '召回失败: ' + (d.error || ''));
  });
}

function renderRoute() {
  if (!App.state || !routesCache.length || !stopsCache.length) return;
  const cur = getBus(currentBusId);
  const curRouteId = cur ? cur.routeId : 1;
  const route = routesCache.find(r => r.id === curRouteId) || routesCache[0];
  const curIdx = cur ? (cur.currentStopIdx || 0) : 0;

  document.getElementById('r-stops-list').innerHTML = route.stopIds.map((id, idx) => {
    const stop = stopsCache.find(s => s.id === id);
    if (!stop) return '';
    const isLoopEnd = idx === route.stopIds.length - 1;
    return `
      <div class="list-item">
        <div style="width: 28px; height: 28px; border-radius: 50%; background: #fff; border: 1.5px solid #E5E7EB; color: #9CA3AF; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;">${idx + 1}</div>
        <div class="li-main">
          <div class="li-title">${stop.name}${isLoopEnd ? ' <span class="tag">回起点</span>' : ''}</div>
        </div>
      </div>`;
  }).join('');
}

function renderAttendance() {
  if (!App.state) return;
  const cur = getBus(currentBusId);
  document.getElementById('a-bus-label').textContent = cur ? cur.id : '#01';
  document.getElementById('a-stats-trips').textContent = cur ? cur.totalTrips : 0;
  document.getElementById('a-stats-laps').textContent = cur ? cur.lapsCompleted : 0;
  document.getElementById('a-stats-served').textContent = cur ? cur.totalServed : 0;
  document.getElementById('a-stats-exceptions').textContent = (App.state.exceptions || []).length;

  // ⑦ 班次排班表
  const el = document.getElementById('a-shifts');
  if (el) {
    const buses = App.state.buses;
    const groups = { '上午班 08:00-14:00': [], '下午班 14:00-21:30': [], '备班': [] };
    buses.forEach(b => {
      const key = b.shift === '上午班' ? '上午班 08:00-14:00' : b.shift === '下午班' ? '下午班 14:00-21:30' : '备班';
      groups[key].push(b);
    });
    el.innerHTML = Object.entries(groups).map(([k, arr]) => `
      <div style="margin-bottom: 10px;">
        <div class="font-bold text-sm mb-2">${k}</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${arr.map(b => `<span class="tag ${b.status === 'operating' ? 'tag-success' : ''}">${b.id} ${b.driver}</span>`).join('')}
        </div>
      </div>`).join('') +
      `<div class="text-sm text-2">高峰时段（午间放学、晚课放学）待命车辆自动热备，需求集中时调度台将提示一键增发。司机按班次交接，不跑单趟即休。</div>`;
  }
}

function renderExceptions() {
  const exs = App.state ? (App.state.exceptions || []) : [];
  const el = document.getElementById('ex-history');
  if (exs.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding: 16px;">暂无记录</div>'; return; }
  el.innerHTML = exs.map(e => `
    <div class="list-item">
      <span class="tag tag-${e.type === '停运' || e.type === '故障' ? 'danger' : 'warning'}">${e.type}</span>
      <div class="li-main">
        <div class="li-title">${e.desc || e.type}</div>
        <div class="li-sub">${e.time}</div>
      </div>
    </div>`).join('');
}

async function loadFeedbacks() {
  try {
    const res = await fetch(API_BASE + '/api/state');
    const data = await res.json();
    const fbs = data.feedbacks || [];
    const el = document.getElementById('me-feedbacks');
    if (!el) return;
    if (fbs.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding: 16px;">暂无反馈</div>'; return; }
    el.innerHTML = fbs.map(f => `
      <div style="margin-bottom: 12px; padding: 12px; background: var(--gray-50); border-radius: 6px;">
        <div class="flex gap-2 mb-2" style="align-items: center;">
          <span class="tag tag-${f.status === 'replied' ? 'success' : 'warning'}">${f.status === 'replied' ? '已回复' : '待处理'}</span>
          <span class="tag">${f.type}</span>
          <span class="text-sm text-2">${f.time}</span>
        </div>
        <div class="text-sm mb-2">${f.content}</div>
        <div class="text-sm text-2 mb-2">来自: ${f.contact}</div>
        ${f.reply ? `<div style="padding: 8px; background: #fff; border-radius: 4px; font-size: 12px; border: 1px solid var(--border);">回复: ${f.reply}</div>` : `<button class="btn btn-outline btn-sm" onclick="replyFeedback(${f.id})">回复</button>`}
      </div>`).join('');
  } catch (e) {}
}

function replyFeedback(id) {
  const reply = prompt('请输入回复内容：');
  if (!reply) return;
  fetch(API_BASE + '/api/feedback/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, reply })
  }).then(r => r.json()).then(() => { App.toast('回复成功'); loadFeedbacks(); });
}

// 休息区选线路发车
async function selectRoute(routeId) {
  const res = await fetch(API_BASE + '/api/bus/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: currentBusId, routeId })
  });
  const data = await res.json();
  if (data.success) App.toast(`✓ ${data.busId} 已从沁园休息区发车 · ${data.routeName}`);
  else App.toast('发车失败: ' + (data.error || ''));
}

function bindActions() {
  document.querySelectorAll('#d-crowd-group [data-crowd]').forEach(b => {
    b.addEventListener('click', () => {
      fetch(API_BASE + '/api/bus/crowd', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busId: currentBusId, crowd: b.dataset.crowd })
      }).then(r => r.json()).then(() => App.toast('拥挤度已更新'));
    });
  });

  document.getElementById('btn-status').addEventListener('click', () => {
    const cur = getBus(currentBusId);
    if (!cur) return;
    if (cur.status === 'operating') {
      if (!confirm('将 ' + cur.id + ' 召回沁园休息区？')) return;
      fetch(API_BASE + '/api/bus/recall', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busId: currentBusId })
      }).then(r => r.json()).then(() => App.toast(cur.id + ' 已召回休息区'));
    } else {
      App.toast('请用上方"沁园休息区"面板选线路发车');
    }
  });

  document.getElementById('btn-temp-stop').addEventListener('click', () => {
    fetch(API_BASE + '/api/bus/automove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ busId: currentBusId })
    }).then(r => r.json()).then(d => App.toast(d.autoMove ? '已恢复自动行驶' : '已临时停靠'));
  });

  document.getElementById('btn-arrive').addEventListener('click', () => {
    fetch(API_BASE + '/api/bus/arrive', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ busId: currentBusId })
    }).then(r => r.json()).then(d => {
      if (d.error) App.toast('操作失败: ' + d.error);
      else App.toast('已到站确认');
    });
  });

  document.getElementById('btn-exception').addEventListener('click', () => switchTab('exception'));

  document.getElementById('btn-emergency').addEventListener('click', () => {
    App.showModal(`
      <div class="modal-title">📞 联系调度中心</div>
      <div class="text-center" style="padding: 20px;">
        <div class="text-2xl font-bold mb-2">0511-8888-XXXX</div>
        <div class="text-2 text-sm">南审校园公交调度中心</div>
        <div class="text-2 text-sm mt-3">服务时间: 07:30 - 21:30</div>
      </div>
      <div class="modal-actions"><button class="btn btn-block" onclick="App.closeModal()">关闭</button></div>`);
  });

  document.getElementById('btn-ex-submit').addEventListener('click', () => {
    const type = document.getElementById('ex-type').value;
    const desc = document.getElementById('ex-desc').value.trim();
    if (!desc) { App.toast('请填写情况说明'); return; }
    fetch(API_BASE + '/api/exception', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, desc })
    }).then(r => r.json()).then(() => {
      App.toast('申报已提交');
      document.getElementById('ex-desc').value = '';
      renderExceptions();
    });
  });
}

init();
