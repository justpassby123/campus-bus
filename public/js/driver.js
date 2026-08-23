// ============================================================
//  driver.js - 司机端逻辑 v6 (v3 设计系统)
//  功能不变：行车 / 调度(派车召回) / 异常 / 考勤
//  移除非必要字样：智能增发建议 / 演示高峰 / 晚课放学
// ============================================================
let stopsCache = [];
let routesCache = [];
let currentTab = 'drive';
let dispatchPageOpen = false;
let currentBusId = '#01';

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
  el.style.color = ok ? '#16A085' : '#1A7CC0';
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
  if (tab === 'dispatch') renderDispatchEntry();
  if (tab === 'attendance') renderAttendance();
  if (tab === 'exception') renderExceptions();
}

function getBus(id) {
  return App.state ? App.state.buses.find(b => b.id === id) : null;
}
function selectBus(id) {
  currentBusId = id;
  renderAll();
}

function renderAll() {
  const s = App.state;
  if (!s) return;

  const cur = getBus(currentBusId) || s.buses[0];
  document.getElementById('header-bus').textContent = cur.id;
  const route = routesCache.find(r => r.id === cur.routeId) || routesCache[0];
  document.getElementById('header-route').textContent = route ? route.name : '一线';
  document.getElementById('header-status').textContent = App.statusText(cur.status);

  // 休息区面板
  const restPanel = document.getElementById('d-rest-panel');
  if (['resting', 'standby', 'backup'].includes(cur.status)) {
    restPanel.classList.remove('hidden');
    document.getElementById('d-rest-laps').textContent =
      cur.status === 'resting' ? `完成 ${cur.lapsCompleted} 圈 · 准备发车`
        : cur.status === 'standby' ? '待命车辆 · 可派车'
          : '备班车辆 · 紧急派车';
  } else {
    restPanel.classList.add('hidden');
  }

  // 地图
  const ops = s.buses.filter(b => b.status === 'operating');
  const parkedBuses = s.buses.filter(b => b.status !== 'operating');
  MapView.render('map-driver', s.stops, ops, { restArea: s.restArea, parkedBuses, routes: routesCache });

  // 载客
  const cap = s.capacity || 25;
  const onboard = cur.onboard || 0;
  document.getElementById('d-load-text').textContent = `${onboard} / ${cap} 人`;
  document.getElementById('d-load-bar').style.width = Math.min(100, (onboard / cap) * 100) + '%';

  // 确认满载按钮（仅当显示满载/拥挤时出现，可手动锁定状态同步给所有端）
  const cfRow = document.getElementById('cf-row');
  const cfBtn = document.getElementById('btn-confirm-full');
  if (cfRow && cfBtn) {
    const isFull = cur.status === 'operating' && (
      cur.driverConfirmedFull || onboard >= cap || cur.crowd === 'crowded'
    );
    if (isFull) {
      cfRow.classList.remove('hidden');
      const ic = cfBtn.querySelector('.cf-ic');
      const tx = cfBtn.querySelector('.cf-tx');
      if (cur.driverConfirmedFull) {
        cfBtn.classList.add('is-confirmed');
        ic.textContent = '✓';
        tx.textContent = '已确认满载 · 点击取消';
      } else {
        cfBtn.classList.remove('is-confirmed');
        ic.textContent = '+';
        tx.textContent = '确认满载';
      }
    } else {
      cfRow.classList.add('hidden');
    }
  }

  // 下一站
  document.getElementById('d-next-name').textContent = cur.nextStopName || '—';
  let nextWait = 0;
  if (cur.nextStopId) {
    const ns = s.stops.find(x => x.id === cur.nextStopId);
    if (ns) nextWait = cur.routeId === 1 ? ns.wait1 : ns.wait2;
  }
  document.getElementById('d-next-sub').textContent =
    `当前 ${cur.currentStopName || '—'} · 下站等 ${nextWait} 人 · 预计下车 ${cur.offNext || 0} 人`;

  // 确认到站
  const btnArrive = document.getElementById('btn-arrive');
  btnArrive.disabled = cur.status !== 'operating';

  if (currentTab === 'dispatch') {
    if (dispatchPageOpen) renderDispatchDetail();
    else renderDispatchEntry();
  }
}

// ========== 调度页（入口卡片） ==========
function fleetSummary() {
  const s = App.state;
  const cap = s.capacity || 25;
  const f = s.fleet || { total: 9, operating: 0, resting: 0, backup: 0 };
  const opBuses = s.buses.filter(b => b.status === 'operating');
  const fullCount = opBuses.filter(b => (b.crowd === 'crowded') || ((b.onboard || 0) >= cap * 0.9)).length;
  return { f, fullCount, cap };
}

function renderDispatchEntry() {
  const s = App.state;
  if (!s) return;
  const { f, fullCount } = fleetSummary();
  document.getElementById('dp-entry-op').textContent = f.operating;
  document.getElementById('dp-entry-rest').textContent = f.resting || 0;
  document.getElementById('dp-entry-full').textContent = fullCount;
}

// ========== 调度二级页面（点入口卡片进入） ==========
function openDispatchPage() {
  dispatchPageOpen = true;
  const sp = document.getElementById('dispatch-detail');
  sp.classList.remove('hidden');
  renderDispatchDetail();
}
function closeDispatchPage() {
  dispatchPageOpen = false;
  document.getElementById('dispatch-detail').classList.add('hidden');
}

function renderDispatchDetail() {
  const s = App.state;
  if (!s) return;
  const { f, fullCount } = fleetSummary();
  document.getElementById('dd-total').textContent = f.total;
  document.getElementById('dd-op').textContent = f.operating;
  document.getElementById('dd-rest').textContent = f.resting || 0;
  document.getElementById('dd-full').textContent = fullCount;
  document.getElementById('dd-desc').textContent =
    `一线 ${f.line1Operating || 0} · 二线 ${f.line2Operating || 0} 运营，其余停沁园休息区待命`;
  renderFleetGrid('dd-fleet-grid');
}

// 站点候车抽屉（替代旧的“智能增发建议”）
function openDemandSheet() {
  const s = App.state;
  if (!s) return;
  const sched = (s.schedule || []).slice().sort((a, b) => (b.waitCount || 0) - (a.waitCount || 0));
  const waited = sched.filter(d => (d.waitCount || 0) > 0);
  let body;
  if (waited.length === 0) {
    body = '<div class="text-2 text-center" style="padding:16px;">当前各站暂无候车</div>';
  } else {
    body = waited.map((d, i) => {
      const pc = d.priority === 'high' ? 'var(--accent)' : d.priority === 'medium' ? 'var(--ink-soft)' : 'var(--muted)';
      const dispatchBtn = (d.suggestDispatch && d.nearbyBusId)
        ? `<button class="btn btn-sm" style="margin-top:8px;" onclick="quickDispatch('${d.nearbyBusId}',${d.routeId});App.closeSheet();">一键增发 ${d.nearbyBusId}</button>` : '';
      return `
        <div class="list-item" style="border-radius:8px;padding:10px 4px;">
          <div style="width:26px;height:26px;border-radius:50%;background:${pc};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${i + 1}</div>
          <div class="li-main">
            <div class="li-title">${d.name} · ${d.routeName} <span class="tag tag-danger">${d.waitCount}人</span></div>
            <div class="li-sub">已等 ${d.waitDuration || 0} 分 · 最近 ${d.nearestBusId || '无车'}${d.nearestBusId ? ' 约' + d.eta + '分' : ''}</div>
            ${dispatchBtn}
          </div>
        </div>`;
    }).join('');
  }
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">📍 站点候车</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    ${body}`);
}

// ========== 车队可视化网格（调度二级页内） ==========
function renderFleetGrid(gridId) {
  const s = App.state;
  if (!s) return;
  const grid = document.getElementById(gridId);
  if (!grid) return;
  const cap = s.capacity || 25;
  grid.innerHTML = s.buses.map(b => {
    const rn = (routesCache.find(r => r.id === b.routeId) || {}).name || '—';
    const isOp = b.status === 'operating';
    const isRest = ['resting', 'standby', 'backup'].includes(b.status);
    const statusClass = isOp ? 'op' : (b.status === 'standby' ? 'standby' : b.status === 'backup' ? 'backup' : 'rest');
    const sel = b.id === currentBusId ? 'sel' : '';
    const onboard = b.onboard || 0;
    const pct = Math.min(100, (onboard / cap) * 100);
    const crowdColor = b.crowd === 'crowded' ? 'var(--accent)' : b.crowd === 'empty' ? 'var(--muted)' : 'var(--ink-soft)';
    const sub = isOp
      ? `${rn} · ${b.currentStopName || '—'}→${b.nextStopName || '—'}`
      : `司机 ${b.driver} · 停沁园休息区`;
    const loadHtml = isOp
      ? `<div class="bus-load"><i style="width:${pct}%;background:${crowdColor};"></i></div>
         <div class="bus-load-tx" style="color:${crowdColor};">载客 ${onboard}/${cap} · ${App.crowdText(b.crowd)}</div>`
      : `<div class="bus-load-tx text-2">未运营</div>`;
    const isFull = b.driverConfirmedFull || (b.onboard || 0) >= cap || b.crowd === 'crowded';
    const cfMini = isOp && isFull
      ? `<button class="cf-mini ${b.driverConfirmedFull ? 'is-confirmed' : ''}" onclick="event.stopPropagation();confirmBusFull('${b.id}')">${b.driverConfirmedFull ? '✓ 已满' : '确认满载'}</button>`
      : '';
    const action = isRest
      ? `<div class="bus-actions"><button class="btn btn-sm" onclick="event.stopPropagation();dispatchBus('${b.id}',1)">派一线</button><button class="btn btn-outline btn-sm" onclick="event.stopPropagation();dispatchBus('${b.id}',2)">派二线</button></div>`
      : `<div class="bus-actions">${cfMini}<button class="btn btn-outline btn-sm" onclick="event.stopPropagation();recallBus('${b.id}')">召回</button></div>`;
    return `
      <div class="bus-card ${statusClass} ${sel}" onclick="selectBus('${b.id}')">
        <div class="bus-head"><span class="bus-id">${b.id}</span><span class="bus-status">${App.statusText(b.status)}</span></div>
        <div class="bus-sub">${sub}</div>
        ${loadHtml}
        ${action}
      </div>`;
  }).join('');
}

function dispatchBus(id, routeId) {
  fetch(API_BASE + '/api/bus/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: id, routeId })
  }).then(r => r.json()).then(d => {
    App.toast(d.success ? `${id} 已派往${d.routeName}` : '派车失败: ' + (d.error || ''));
  });
}
function quickDispatch(id, routeId) {
  dispatchBus(id, routeId);
}
function recallBus(id) {
  if (!confirm('将 ' + id + '召回沁园休息区？')) return;
  fetch(API_BASE + '/api/bus/recall', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: id })
  }).then(r => r.json()).then(d => {
    App.toast(d.success ? id + ' 已召回休息区' : '召回失败: ' + (d.error || ''));
  });
}

// 司机手动确认/取消满载（人数与实际不符时手动锁定，同步给所有端）
function confirmBusFull(busId) {
  if (!busId) { App.toast('未选中车辆'); return; }
  const bus = App.state && App.state.buses ? App.state.buses.find(b => b.id === busId) : null;
  if (!bus) return;
  const next = !bus.driverConfirmedFull;
  fetch(API_BASE + '/api/bus/confirm-full', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId, confirmed: next })
  }).then(r => r.json()).then(d => {
    App.toast(d.success
      ? (next ? `${busId} 已标记满载 · 全员同步` : `${busId} 已取消满载标记`)
      : '操作失败: ' + (d.error || ''));
  }).catch(() => App.toast('网络错误'));
}

// ========== 异常 ==========
function renderExceptions() {
  const exs = App.state ? (App.state.exceptions || []) : [];
  const el = document.getElementById('ex-history');
  if (!el) return;
  if (exs.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无记录</div>'; return; }
  el.innerHTML = exs.map(e => `
    <div class="list-card">
      <div class="lc-row">
        <div><div class="lc-title">${e.type}</div><div class="lc-sub">${e.desc || ''}</div></div>
        <span class="tag tag-soft">${e.time}</span>
      </div>
    </div>`).join('');
}

function openExceptionForm(presetType) {
  const types = ['改道施工', '临时加站', '恶劣天气停运', '车辆故障', '路况异常'];
  const opts = types.map(t => `<option ${t === presetType ? 'selected' : ''}>${t}</option>`).join('');
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">异常申报</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div class="form-group"><label class="form-label">异常类型</label><select class="select" id="ex-type">${opts}</select></div>
    <div class="form-group"><label class="form-label">情况说明</label><textarea class="textarea" id="ex-desc" placeholder="例如：南门北站施工，临时改道"></textarea></div>
    <button class="btn btn-block" onclick="submitException()">提交申报</button>`);
}
function submitException() {
  const type = document.getElementById('ex-type').value;
  const desc = document.getElementById('ex-desc').value.trim();
  if (!desc) { App.toast('请填写情况说明'); return; }
  fetch(API_BASE + '/api/exception', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, desc })
  }).then(r => r.json()).then(() => {
    App.closeSheet();
    App.toast('申报已提交');
    renderExceptions();
  });
}

// ========== 考勤 ==========
function renderAttendance() {
  if (!App.state) return;
  const cur = getBus(currentBusId);
  document.getElementById('a-stats-trips').textContent = cur ? cur.totalTrips : 0;
  document.getElementById('a-stats-laps').textContent = cur ? cur.lapsCompleted : 0;
  document.getElementById('a-stats-exceptions').textContent = (App.state.exceptions || []).length;
}

// ========== 回复反馈 ==========
function replyFeedback(id) {
  const reply = prompt('请输入回复内容：');
  if (!reply) return;
  fetch(API_BASE + '/api/feedback/reply', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, reply })
  }).then(r => r.json()).then(() => { App.toast('回复成功'); loadFeedbacks(); });
}

// ========== 我的 ==========
function openMeFeedbacks() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">💬 反馈回复</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-me-fb"></div>`);
  const el = document.getElementById('sheet-me-fb');
  const fbs = (App.state && App.state.feedbacks) || [];
  if (fbs.length === 0) { el.innerHTML = '<div class="text-2 text-center" style="padding:16px;">暂无反馈</div>'; return; }
  el.innerHTML = fbs.slice(0, 12).map(f => `
    <div style="margin-bottom:12px;padding:12px;background:var(--surface);border-radius:16px;border:1px solid var(--line);">
      <div class="flex gap-2 mb-2" style="align-items:center;"><span class="tag tag-${f.status === 'replied' ? 'accent' : 'soft'}">${f.status === 'replied' ? '已回复' : '待处理'}</span><span class="tag tag-soft">${f.type}</span><span class="text-sm text-2">${f.time}</span></div>
      <div class="text-sm mb-2">${f.content}</div>
      ${f.reply ? `<div style="padding:8px;background:#fff;border-radius:10px;font-size:12px;border:1px solid var(--line);">回复: ${f.reply}</div>` : ''}
    </div>`).join('');
}
function openMeShifts() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">📊 我的班次</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-me-shifts"></div>`);
  const el = document.getElementById('sheet-me-shifts');
  const cur = getBus(currentBusId);
  el.innerHTML = `
    <div class="card" style="padding:14px;">
      <div class="li-title">${cur ? cur.id : '#01'} · ${cur ? cur.driver : '—'}</div>
      <div class="li-sub mt-2">绑定线路：${cur ? (routesCache.find(r => r.id === cur.routeId) || {}).name : '一线'}</div>
      <div class="li-sub">班次：${cur ? cur.shift : '—'}</div>
      <div class="li-sub">本月趟次：${cur ? cur.totalTrips : 0} · 圈数：${cur ? cur.lapsCompleted : 0}</div>
    </div>`;
}
function openMeNotices() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">🔔 消息通知</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div id="sheet-me-notice"></div>`);
  const el = document.getElementById('sheet-me-notice');
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
      <div class="text-2 text-sm mt-1">南审校园小公交 · 司机调度端</div>
      <div class="text-2 text-sm mt-3">v1.0 · 演示版</div>
    </div>
    <div class="card" style="margin-top:8px;padding:14px;">
      <div class="li-sub">实时地图 · 按需动态调度 · 拥挤度同步 · 异常申报 · 考勤统计</div>
    </div>`);
}

// ========== 行车操作 ==========
async function selectRoute(routeId) {
  const res = await fetch(API_BASE + '/api/bus/route', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: currentBusId, routeId })
  });
  const data = await res.json();
  if (data.success) App.toast(`✓ ${data.busId} 已从沁园休息区发车 · ${data.routeName}`);
  else App.toast('发车失败: ' + (data.error || ''));
}

function doArrive() {
  const cur = getBus(currentBusId);
  if (!cur || cur.status !== 'operating') { App.toast('仅运营中车辆可确认到站'); return; }
  fetch(API_BASE + '/api/bus/arrive', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: currentBusId })
  }).then(r => r.json()).then(d => {
    if (d.error) App.toast('操作失败: ' + d.error);
    else App.toast('已到站确认');
  });
}
function doTempStop() {
  fetch(API_BASE + '/api/bus/automove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ busId: currentBusId })
  }).then(r => r.json()).then(d => App.toast(d.autoMove ? '已恢复自动行驶' : '已临时停靠'));
}
function doRecall() {
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
}
function doEmergency() {
  App.showModal(`
    <div class="modal-title">📞 联系调度中心</div>
    <div class="text-center" style="padding:20px;">
      <div class="text-2xl font-bold mb-2">0511-8888-XXXX</div>
      <div class="text-2 text-sm">南审校园公交调度中心</div>
      <div class="text-2 text-sm mt-3">服务时间: 07:30 - 21:30</div>
    </div>
    <div class="modal-actions"><button class="btn btn-block" onclick="App.closeModal()">关闭</button></div>`);
}
function openMoreSheet() {
  App.showSheet(`
    <div class="sheet-grab"></div>
    <div class="sheet-head">
      <div class="sheet-title">更多操作</div>
      <button class="sheet-close" onclick="App.closeSheet()">✕</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;padding-top:4px;">
      <button class="btn btn-outline btn-block" onclick="doTempStop();App.closeSheet();">临时停靠 / 恢复</button>
      <button class="btn btn-outline btn-block" onclick="doRecall();App.closeSheet();">召回休息区</button>
      <button class="btn btn-block" onclick="doEmergency();App.closeSheet();">紧急联系调度</button>
    </div>`);
}

// ========== 地图放大（全屏横屏） ==========
function openMapZoom() {
  const s = App.state;
  if (!s) return;
  const ops = s.buses.filter(b => b.status === 'operating');
  const parkedBuses = s.buses.filter(b => b.status !== 'operating');
  MapView.openZoom(s.stops, ops, { restArea: s.restArea, parkedBuses, routes: routesCache });
}

function bindActions() {
  document.getElementById('btn-arrive').addEventListener('click', doArrive);
  document.getElementById('btn-more').addEventListener('click', openMoreSheet);

  const punch = document.getElementById('btn-punch');
  if (punch) punch.addEventListener('click', () => {
    punch.textContent = '⏱ 已打卡 · 现在';
    App.toast('上班打卡成功 ✓');
  });
}

init();
