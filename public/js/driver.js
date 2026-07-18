// ============================================================
//  driver.js - 司机端逻辑 v4
// ============================================================
let stopsCache = [];
let routesCache = [];
let currentTab = 'drive';
let currentBusId = '#01';
let currentDemand = [];

function showApiSettings() {
  const current = localStorage.getItem('cb-api-base') || API_BASE || '(默认)';
  App.showModal(`
    <div class="modal-title">⚙️ 服务器设置</div>
    <div class="text-sm text-2 mb-3">
      如果上报/控制台无响应，说明你的电脑找不到后端服务。<br>
      <b>解决办法</b>：在 <code style="background:#F3F4F6;padding:2px 4px;">campus-bus</code> 目录运行 <code style="background:#F3F4F6;padding:2px 4px;">node server.js</code>，然后刷新页面。
    </div>
    <div class="form-group">
      <label class="form-label">服务器地址 (留空用默认)</label>
      <input class="input" id="api-url-input" placeholder="http://localhost:3000" value="${current === '(默认)' ? '' : current}">
    </div>
    <div class="text-sm text-2 mb-3">
      💡 提示: <br>
      · 同机运行: 保持 <code style="background:#F3F4F6;padding:2px 4px;">http://localhost:3000</code><br>
      · 部署到云端: 填公网URL, 如 <code style="background:#F3F4F6;padding:2px 4px;">https://xxx.example.com</code>
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
  el.textContent = ok ? `✓ 已连接 ${base}` : `✗ 未连接 ${base}`;
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

  // 车队总览
  const f = s.fleet || { total: 9, backup: 1, operating: 0, resting: 0 };
  document.getElementById('d-fleet-sub').textContent = `共 ${f.total} 辆 · 运营 ${f.operating} · 休息 ${f.resting || 0}`;
  renderFleetGrid(s.buses);

  // 休息区面板 (resting/standby/backup 都显示)
  const restPanel = document.getElementById('d-rest-panel');
  if (cur.status === 'resting') {
    restPanel.classList.remove('hidden');
    document.getElementById('d-rest-laps').textContent = `完成 ${cur.lapsCompleted} 圈 · 准备发车`;
  } else if (cur.status === 'standby') {
    restPanel.classList.remove('hidden');
    document.getElementById('d-rest-laps').textContent = '待命车辆 · 司机可派车';
  } else if (cur.status === 'backup') {
    restPanel.classList.remove('hidden');
    document.getElementById('d-rest-laps').textContent = '备班车辆 · 紧急派车';
  } else {
    restPanel.classList.add('hidden');
  }

  // 当前车辆
  const route = routesCache.find(r => r.id === cur.routeId) || routesCache[0];
  document.getElementById('d-bus-id').textContent = '车辆 ' + cur.id;
  document.getElementById('d-driver').textContent = '司机：' + cur.driver;
  document.getElementById('d-route-name').textContent = route.name;
  document.getElementById('d-status-info').textContent = App.statusText(cur.status);
  document.getElementById('d-status-info').className = 'tag tag-' + App.statusClass(cur.status);
  document.getElementById('d-current-stop').textContent = cur.currentStopName;
  document.getElementById('d-next-stop').textContent = cur.nextStopName;

  // 地图
  const ops = s.buses.filter(b => b.status === 'operating');
  // 所有非运营车辆都停放在休息区 (resting/standby/backup)
  const parkedBuses = s.buses.filter(b => b.status !== 'operating');
  MapView.render('map-driver', s.stops, ops, { restArea: s.restArea, parkedBuses });

  // 需求列表
  currentDemand = s.schedule;
  renderDemandList();

  // 拥挤度按钮
  document.querySelectorAll('#d-crowd-group [data-crowd]').forEach(b => {
    if (b.dataset.crowd === cur.crowd) {
      b.className = b.dataset.crowd === 'empty' ? 'btn btn-success' :
                    b.dataset.crowd === 'medium' ? 'btn' :
                    'btn btn-danger';
    } else {
      b.className = 'btn btn-outline';
    }
  });

  // 载客量
  document.getElementById('d-onboard').textContent = cur.onboard || 0;
  document.getElementById('d-capacity').textContent = 40;

  // 状态相关按钮可见性
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
}

function renderFleetGrid(buses) {
  const el = document.getElementById('d-fleet-grid');
  el.innerHTML = buses.map(b => {
    let bg, color;
    if (b.status === 'operating') { bg = '#1F2937'; color = '#fff'; }
    else if (b.status === 'resting') { bg = '#fff'; color = '#1F2937'; border = '1px dashed #1F2937'; }
    else if (b.status === 'standby') { bg = '#F3F4F6'; color = '#9CA3AF'; }
    else { bg = '#fff'; color = '#9CA3AF'; }
    const sel = b.id === currentBusId ? 'outline: 2px solid #2563EB; outline-offset: 1px;' : '';
    return `<div onclick="selectBus('${b.id}')" style="text-align:center; padding:8px 4px; border-radius:6px; font-size:12px; font-weight:600; background: ${bg}; color: ${color}; ${b.status === 'resting' ? 'border: 1px dashed #6B7280;' : ''} ${sel}">${b.id.replace('#','')}<div style="font-size:10px; font-weight:400; opacity:0.85;">${App.statusText(b.status)}</div></div>`;
  }).join('');
}

function selectBus(id) {
  currentBusId = id;
  renderAll();
}

function renderDemandList() {
  const list = document.getElementById('d-demand-list');
  const cnt = document.getElementById('d-demand-count');
  if (!currentDemand || currentDemand.length === 0) {
    list.innerHTML = '<div class="text-2 text-center" style="padding: 16px;">暂无等车需求</div>';
    cnt.textContent = '0 人'; cnt.className = 'tag';
    return;
  }
  const totalWait = currentDemand.reduce((sum, d) => sum + d.waitCount, 0);
  cnt.textContent = totalWait + ' 人'; cnt.className = 'tag tag-danger';

  list.innerHTML = currentDemand.map((d, i) => `
    <div class="list-item">
      <div style="width: 30px; height: 30px; border-radius: 50%; background: ${d.priority === 'high' ? '#FEE2E2' : d.priority === 'medium' ? '#FEF3C7' : '#F3F4F6'}; color: ${d.priority === 'high' ? '#B91C1C' : d.priority === 'medium' ? '#B45309' : '#475569'}; display: flex; align-items: center; justify-content: center; font-weight: 600; font-size: 13px;">${i + 1}</div>
      <div class="li-main">
        <div class="li-title">${d.name} <span class="tag tag-${d.priority === 'high' ? 'danger' : d.priority === 'medium' ? 'warning' : ''}">${d.priority === 'high' ? '高优' : d.priority === 'medium' ? '中优' : '低优'}</span></div>
        <div class="li-sub">${d.waitCount}人等待 · 已等${d.waitDuration}分钟 · 最近 ${d.nearestBusId || '—'} 约${d.eta}分钟</div>
      </div>
      <div class="li-action font-bold">${d.eta}分</div>
    </div>`).join('');
}

function renderRoute() {
  if (!App.state || !routesCache.length || !stopsCache.length) return;
  const cur = getBus(currentBusId);
  const curRouteId = cur ? cur.routeId : 1;
  const route = routesCache.find(r => r.id === curRouteId) || routesCache[0];
  const curIdx = cur ? cur.currentStopIdx : 0;
  const special = { 3: '入校停靠/出校不停靠', 16: '入校停靠/出校不停靠' };

  document.getElementById('r-stops-list').innerHTML = route.stopIds.map((id, idx) => {
    const stop = stopsCache.find(s => s.id === id);
    if (!stop) return '';
    const isPast = idx < curIdx;
    const isCurrent = idx === curIdx;
    const isLoopEnd = idx === route.stopIds.length - 1;
    return `
      <div class="list-item" style="${isCurrent ? 'background: var(--gray-50); border-radius: 6px; padding: 12px;' : isPast ? 'opacity: 0.5;' : ''}">
        <div style="width: 28px; height: 28px; border-radius: 50%; background: ${isCurrent ? '#1F2937' : isPast ? '#E5E7EB' : '#fff'}; border: 1.5px solid ${isCurrent ? '#1F2937' : '#E5E7EB'}; color: ${isCurrent || isPast ? '#fff' : '#9CA3AF'}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600;">${isPast ? '✓' : idx + 1}</div>
        <div class="li-main">
          <div class="li-title">${stop.name}${isCurrent ? ' <span class="tag tag-accent">当前站</span>' : ''}${isLoopEnd ? ' <span class="tag">回起点</span>' : ''}</div>
          <div class="li-sub">${isPast ? '已停靠' : isCurrent ? '停靠 30 秒' : '预计到站'}${special[id] ? ` · <span style="color: #B45309;">${special[id]}</span>` : ''}</div>
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

// ★ 休息区选线路发车
async function selectRoute(routeId) {
  const res = await fetch(API_BASE + '/api/bus/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: currentBusId, routeId })
  });
  const data = await res.json();
  if (data.success) {
    App.toast(`✓ ${data.busId} 已从沁园休息区发车 · ${data.routeName}`);
  } else {
    App.toast('发车失败: ' + (data.error || ''));
  }
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
      // 召回休息区
      if (!confirm('将 ' + cur.id + ' 召回沁园休息区？')) return;
      fetch(API_BASE + '/api/bus/recall', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busId: currentBusId })
      }).then(r => r.json()).then(() => App.toast(cur.id + ' 已召回休息区'));
    } else if (cur.status === 'resting' || cur.status === 'standby' || cur.status === 'backup') {
      App.toast('请使用上方"沁园休息区"面板选线路发车');
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

window.SPECIAL_STOPS = {
  3: { rule: '入校停靠/出校不停靠', gate: '南门北' },
  16: { rule: '入校停靠/出校不停靠', gate: '南门南' }
};

init();
