// ============================================================
//  南审校园公交 - 后端服务 v2
//  Node.js + Express + Socket.io
//  16站点 / 2线路 / 9车(1备班) / 沁园休息区 / 选线发车
// ============================================================
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// =========================================================
//  16个真实南审校园公交站点
// =========================================================
const stops = [
  { id: 1,  name: '沁园',     lat: 32.0638, lng: 118.6115 },
  { id: 2,  name: '中和楼',   lat: 32.0621, lng: 118.6119 },
  { id: 3,  name: '南门北',   lat: 32.0584, lng: 118.6083 },
  { id: 4,  name: '敏行楼',   lat: 32.0586, lng: 118.6039 },
  { id: 5,  name: '敏达楼',   lat: 32.0615, lng: 118.6020 },
  { id: 6,  name: '澄园南',   lat: 32.0601, lng: 118.6016 },
  { id: 7,  name: '澄园北',   lat: 32.0623, lng: 118.6007 },
  { id: 8,  name: '澄园一站', lat: 32.0642, lng: 118.6012 },
  { id: 9,  name: '泽园餐厅', lat: 32.0657, lng: 118.6023 },
  { id: 10, name: '泽园南',   lat: 32.0668, lng: 118.6029 },
  { id: 11, name: '竹苑',     lat: 32.0678, lng: 118.6038 },
  { id: 12, name: '润园',     lat: 32.0672, lng: 118.6051 },
  { id: 13, name: '润园餐厅', lat: 32.0660, lng: 118.6072 },
  { id: 14, name: '竞慧楼',   lat: 32.0643, lng: 118.6094 },
  { id: 15, name: '竞秀楼',   lat: 32.0602, lng: 118.6101 },
  { id: 16, name: '南门南',   lat: 32.0573, lng: 118.6074 }
];
const stopById = Object.fromEntries(stops.map(s => [s.id, s]));

// =========================================================
//  沁园休息区 (不在站点列表中，司机专用)
// =========================================================
const REST_AREA = {
  name: '沁园休息区',
  lat: 32.0645,
  lng: 118.6122
};

// =========================================================
//  两条线路 (从沁园出发, 闭环回到沁园)
// =========================================================
const routes = [
  {
    id: 1, name: '一线',
    desc: '沁园→中和楼→南门北→敏行楼→敏达楼→澄园→泽园→润园→竞秀楼→南门南→中和楼→沁园',
    stopIds: [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,2,1]
  },
  {
    id: 2, name: '二线',
    desc: '沁园→中和楼→南门北→竞秀楼→竞慧楼→润园→泽园→澄园→敏达楼→敏行楼→南门南→中和楼→沁园',
    stopIds: [1,2,3,15,14,13,12,11,10,9,8,7,6,5,4,16,2,1]
  }
];
const routeById = Object.fromEntries(routes.map(r => [r.id, r]));

// =========================================================
//  时刻表: 首班08:00 / 末班21:30 / 约10分钟一班
//  全程约25分钟
// =========================================================
function generateTimetable(startH, startM, endH, endM, intervalMin) {
  const times = [];
  let h = startH, m = startM;
  while (h < endH || (h === endH && m <= endM)) {
    times.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    m += intervalMin;
    while (m >= 60) { m -= 60; h++; }
  }
  return times;
}
const timetable = {
  weekday: {
    peak:   generateTimetable(8, 0, 8, 50, 10)
              .concat(generateTimetable(11, 0, 13, 50, 10))
              .concat(generateTimetable(16, 0, 18, 50, 10)),
    normal: generateTimetable(9, 0, 10, 50, 10)
              .concat(generateTimetable(14, 0, 15, 50, 10))
              .concat(generateTimetable(19, 0, 21, 30, 10)),
    night: []
  },
  meta: { firstBus: '08:00', lastBus: '21:30', interval: 10, loopMinutes: 25 }
};

// =========================================================
//  车队: 9辆 (1备班 / 8日常)
//  status: operating | resting | standby | backup
//  两线至少各1辆运营, 待命/备班停在沁园休息区
// =========================================================
const CAPACITY = 40;  // 核定载客量
const fleetDef = [
  // 4辆在两条线路上运营
  { id: '#01', driver: '张建国', routeId: 1, status: 'operating', startIdx: 0 },   // 沁园
  { id: '#02', driver: '李卫东', routeId: 1, status: 'operating', startIdx: 7 },   // 澄园一站
  { id: '#03', driver: '王志强', routeId: 2, status: 'operating', startIdx: 4 },   // 竞慧楼
  { id: '#04', driver: '赵 明',  routeId: 2, status: 'operating', startIdx: 11 },  // 泽园南
  // 4辆待命, 停在沁园休息区
  { id: '#05', driver: '刘 洋',  routeId: 1, status: 'standby' },
  { id: '#06', driver: '陈 静',  routeId: 1, status: 'standby' },
  { id: '#07', driver: '孙 磊',  routeId: 2, status: 'standby' },
  { id: '#08', driver: '周 婷',  routeId: 2, status: 'standby' },
  // 1辆备班, 也停在沁园休息区
  { id: '#09', driver: '—',     routeId: 1, status: 'backup' }
];

function makeBus(def) {
  // 待命/备班统一停在沁园休息区
  if (def.status === 'standby' || def.status === 'backup') {
    return {
      id: def.id, driver: def.driver, routeId: def.routeId, status: def.status,
      currentStopIdx: 0,
      lat: REST_AREA.lat, lng: REST_AREA.lng,
      currentStopName: REST_AREA.name,
      nextStopName: '待派车',
      crowd: 'empty', autoMove: false, speed: 0, dwell: 0,
      onboard: 0, totalServed: 0, totalTrips: 0, lapsCompleted: 0
    };
  }
  // 运营中: 在路线上的指定位置起步
  const route = routeById[def.routeId];
  const startStop = stopById[route.stopIds[def.startIdx]];
  return {
    id: def.id, driver: def.driver, routeId: def.routeId, status: def.status,
    currentStopIdx: def.startIdx,
    lat: startStop.lat, lng: startStop.lng,
    currentStopName: startStop.name,
    nextStopName: stopById[route.stopIds[(def.startIdx + 1) % route.stopIds.length]].name,
    crowd: 'medium', autoMove: true, speed: 0, dwell: 0,
    onboard: 0, totalServed: 0, totalTrips: 0, lapsCompleted: 0
  };
}
const buses = fleetDef.map(makeBus);
const busById = Object.fromEntries(buses.map(b => [b.id, b]));

// =========================================================
//  全局状态
// =========================================================
const state = {
  demands: {},
  lostFound: [
    { id: 1, type: '校园卡', desc: '蓝色校园卡，沁园站捡到', contact: '18912345678', time: '2026-07-18 14:30', status: 'open' }
  ],
  feedbacks: [
    { id: 1, type: '晚点', content: '南门北 17:30 没等到车', contact: '同学A', time: '2026-07-18 17:45', reply: '', status: 'pending' }
  ],
  notices: [
    { id: 1, type: 'top', title: '暑期校巴正常运行', time: '2026-07-18', content: '首班 08:00，末班 21:30，约 10 分钟一班，全程约 25 分钟。' }
  ],
  exceptions: []
};

// =========================================================
//  工具函数
// =========================================================
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getStopDuration() {
  const h = new Date().getHours();
  if (h < 8 || h >= 21.5) return 15;
  if ((h >= 8 && h < 9) || (h >= 11 && h < 14) || (h >= 16 && h < 19)) return 40;
  return 25;
}

function getTimePeriod() {
  const h = new Date().getHours();
  if (h < 8 || h >= 21.5) return 'off';
  if ((h >= 8 && h < 9) || (h >= 11 && h < 14) || (h >= 16 && h < 19)) return 'peak';
  return 'normal';
}

// 根据载客量自动算拥挤度
function autoCrowd(onboard) {
  if (onboard <= 10) return 'empty';
  if (onboard <= 28) return 'medium';
  return 'crowded';
}

function operatingBuses() {
  return buses.filter(b => b.status === 'operating');
}

function nearestBusToStop(stop) {
  const ops = operatingBuses();
  if (ops.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const b of ops) {
    const d = haversine(b.lat, b.lng, stop.lat, stop.lng);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return { bus: best, dist: bestDist };
}

// =========================================================
//  调度引擎
// =========================================================
function calculateSchedule() {
  const now = Date.now();
  const result = [];
  for (const [stopIdStr, demand] of Object.entries(state.demands)) {
    if (demand.count <= 0) continue;
    const stopId = parseInt(stopIdStr);
    const stop = stopById[stopId];
    if (!stop) continue;
    const waitDuration = (now - demand.firstDemandAt) / 60000;
    const nb = nearestBusToStop(stop);
    const distance = nb ? nb.dist : 1;
    const score = demand.count * 10 + waitDuration * 2 - distance * 1;
    let priority;
    if (score >= 30) priority = 'high';
    else if (score >= 15) priority = 'medium';
    else priority = 'low';
    // 校园限速20km/h → ETA = 距离(km) / 20 * 60
    const eta = nb ? Math.max(1, Math.round(distance / 20 * 60)) : 0;
    result.push({
      id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng,
      waitCount: demand.count,
      waitDuration: Math.round(waitDuration * 10) / 10,
      distance: Math.round(distance * 100) / 100,
      score: Math.round(score * 10) / 10,
      priority, eta,
      nearestBusId: nb ? nb.bus.id : null
    });
  }
  result.sort((a, b) => b.score - a.score);
  return result;
}

// =========================================================
//  完整状态
// =========================================================
function getFullState() {
  const schedule = calculateSchedule();
  state.lastTick = Date.now();
  const demandList = stops.map(s => ({
    id: s.id, name: s.name, lat: s.lat, lng: s.lng,
    waitCount: state.demands[s.id] ? state.demands[s.id].count : 0,
    waitDuration: state.demands[s.id] ?
      Math.round((Date.now() - state.demands[s.id].firstDemandAt) / 60000 * 10) / 10 : 0
  }));
  return {
    stops: demandList,
    buses: buses.map(b => ({
      id: b.id, driver: b.driver, routeId: b.routeId, status: b.status,
      lat: b.lat, lng: b.lng, crowd: b.crowd, speed: b.speed,
      currentStopName: b.currentStopName, nextStopName: b.nextStopName,
      autoMove: b.autoMove, totalServed: b.totalServed, totalTrips: b.totalTrips,
      onboard: b.onboard, lapsCompleted: b.lapsCompleted
    })),
    restArea: REST_AREA,
    schedule,
    timePeriod: getTimePeriod(),
    lastTick: state.lastTick || 0,
    fleet: {
      total: buses.length,
      daily: buses.filter(b => b.status !== 'backup').length,
      backup: buses.filter(b => b.status === 'backup').length,
      operating: operatingBuses().length,
      resting: buses.filter(b => b.status === 'resting').length
    },
    notices: state.notices.slice(0, 3),
    feedbacks: state.feedbacks,
    lostFound: state.lostFound,
    exceptions: state.exceptions
  };
}

function broadcastState() {
  io.emit('state:update', getFullState());
}

// =========================================================
//  公交自动移动模拟
//  真实比例: 校园限速20km/h, 一圈25分钟 ≈ 1500秒
//  演示压缩: 1/200, 实际一圈约4-5分钟, 显示速度18-20km/h
// =========================================================
const TICK_MS = 2000;           // 定时器间隔 2秒
const MOVE_STEP = 0.0001;       // 每 tick 经纬度步长 (压缩后的校园行驶速度)
const DWELL_TICKS = 2;          // 到站停靠 tick 数 (~4秒)

function tickBus(bus) {
  // 只有 operating 状态才移动
  if (bus.status !== 'operating') { bus.speed = 0; return; }
  if (!bus.autoMove) { bus.speed = 0; return; }

  const route = routeById[bus.routeId];
  const ids = route.stopIds;

  // 停靠中
  if (bus.dwell > 0) { bus.dwell--; bus.speed = 0; return; }

  const nextId = ids[(bus.currentStopIdx + 1) % ids.length];
  const nxt = stopById[nextId];
  const dLat = nxt.lat - bus.lat;
  const dLng = nxt.lng - bus.lng;
  const dist = Math.sqrt(dLat * dLat + dLng * dLng);

  // 到达判定：距离小于一步长就吸附到站
  if (dist <= MOVE_STEP) {
    bus.currentStopIdx = (bus.currentStopIdx + 1) % ids.length;
    bus.lat = nxt.lat;
    bus.lng = nxt.lng;
    bus.currentStopName = nxt.name;
    bus.dwell = DWELL_TICKS;
    bus.speed = 0;

    // 顺路接走候车乘客
    if (state.demands[nextId]) {
      const pickedUp = state.demands[nextId].count;
      bus.totalServed += pickedUp;
      bus.totalTrips++;
      bus.onboard += pickedUp;
      bus.crowd = autoCrowd(bus.onboard);
      delete state.demands[nextId];
      io.emit('demand:resolved', { stopId: nextId, stopName: nxt.name, served: pickedUp, busId: bus.id });
    }

    // 判断是否跑完一圈 (从终点回到起点 沁园=id=1)
    // 路线是 [1, 2, 3, ..., 16, 2, 1], 最后回到 1 才算一圈
    if (nextId === 1) {
      bus.lapsCompleted++;
      // 跑完一圈 → 自动进入沁园休息区
      bus.status = 'resting';
      bus.lat = REST_AREA.lat;
      bus.lng = REST_AREA.lng;
      bus.currentStopName = REST_AREA.name;
      bus.nextStopName = '待选择线路';
      bus.autoMove = false;
      bus.speed = 0;
      bus.crowd = 'empty';
      bus.onboard = 0;  // 下客清零
      io.emit('bus:resting', { busId: bus.id, lapsCompleted: bus.lapsCompleted });
    } else {
      bus.nextStopName = stopById[ids[(bus.currentStopIdx + 1) % ids.length]].name;
    }
  } else {
    // 正常移动
    bus.lat += (dLat / dist) * MOVE_STEP;
    bus.lng += (dLng / dist) * MOVE_STEP;
    // 显示速度 ~18-20 km/h (校园限速20)
    // 实际每tick位移 ≈ MOVE_STEP度 ≈ 100m, 2秒一tick → 180km/h等效果
    // 但展示用固定值更直观
    const displaySpeed = 18 + Math.floor(Math.random() * 3); // 18~20 随机波动
    bus.speed = bus.speed > 0 ? Math.round((bus.speed * 3 + displaySpeed) / 4) : displaySpeed;
  }
}

// =========================================================
//  REST API
// =========================================================
app.get('/api/stops', (req, res) => res.json(stops));
app.get('/api/routes', (req, res) => {
  res.json(routes.map(r => ({ ...r, stops: r.stopIds.map(id => stopById[id]) })));
});
app.get('/api/timetable', (req, res) => res.json(timetable));
app.get('/api/state', (req, res) => res.json(getFullState()));

// 上报需求 -> 返回最近班车 ETA
app.post('/api/demand', (req, res) => {
  const { stopId } = req.body;
  const id = parseInt(stopId);
  if (!id || !stopById[id]) return res.status(400).json({ error: 'invalid stopId' });
  if (!state.demands[id]) state.demands[id] = { count: 0, firstDemandAt: Date.now() };
  state.demands[id].count++;
  const schedule = calculateSchedule();
  const target = schedule.find(s => s.id === id);
  const eta = target ? target.eta : 0;
  const busId = target ? target.nearestBusId : null;
  io.emit('demand:new', {
    stopId: id, stopName: stopById[id].name,
    count: state.demands[id].count, eta, busId
  });
  broadcastState();
  res.json({
    success: true, stopName: stopById[id].name,
    waitCount: state.demands[id].count, eta, busId
  });
});

// 司机到站确认
app.post('/api/bus/arrive', (req, res) => {
  const busId = req.body.busId || '#01';
  const bus = busById[busId];
  if (!bus) return res.status(400).json({ error: 'invalid busId' });
  if (bus.status !== 'operating') return res.status(400).json({ error: '该车未在运营中' });
  const route = routeById[bus.routeId];
  const nextId = route.stopIds[(bus.currentStopIdx + 1) % route.stopIds.length];
  bus.currentStopIdx = (bus.currentStopIdx + 1) % route.stopIds.length;
  bus.lat = stopById[nextId].lat;
  bus.lng = stopById[nextId].lng;
  bus.currentStopName = stopById[nextId].name;
  bus.dwell = DWELL_TICKS;
  if (state.demands[nextId]) {
    const pickedUp = state.demands[nextId].count;
    bus.totalServed += pickedUp;
    bus.totalTrips++;
    bus.onboard += pickedUp;
    bus.crowd = autoCrowd(bus.onboard);
    delete state.demands[nextId];
  }
  broadcastState();
  res.json({ success: true });
});

// 切换车辆状态 operating/standby (从待命恢复时选线路)
app.post('/api/bus/status', (req, res) => {
  const busId = req.body.busId || '#01';
  const bus = busById[busId];
  if (!bus) return res.status(400).json({ error: 'invalid busId' });
  if (bus.status === 'backup') return res.status(400).json({ error: '备班车辆不可调度' });
  if (bus.status === 'resting') return res.status(400).json({ error: '休息中的车辆请先选择线路发车' });

  if (bus.status === 'operating') {
    bus.status = 'standby';
    bus.autoMove = false;
    bus.speed = 0;
    bus.lat = REST_AREA.lat;
    bus.lng = REST_AREA.lng;
    bus.currentStopName = REST_AREA.name;
    bus.nextStopName = '待派车';
    bus.crowd = 'empty';
    bus.onboard = 0;
  } else {
    // standby → operating: 从当前线路起点开始
    bus.status = 'operating';
    bus.autoMove = true;
    const route = routeById[bus.routeId];
    bus.currentStopIdx = 0;
    const startStop = stopById[route.stopIds[0]];
    bus.lat = startStop.lat;
    bus.lng = startStop.lng;
    bus.currentStopName = startStop.name;
    bus.nextStopName = stopById[route.stopIds[1]].name;
  }
  broadcastState();
  res.json({ success: true, status: bus.status });
});

// ★ 从休息区/停车场选线路发车 (核心新功能)
app.post('/api/bus/route', (req, res) => {
  const busId = req.body.busId || '#01';
  const routeId = parseInt(req.body.routeId);
  const bus = busById[busId];
  if (!bus) return res.status(400).json({ error: 'invalid busId' });
  if (!['resting', 'standby', 'backup'].includes(bus.status)) {
    return res.status(400).json({ error: '该车已在运营中' });
  }
  if (![1, 2].includes(routeId)) return res.status(400).json({ error: '无效线路，请选一线或二线' });

  bus.routeId = routeId;
  bus.status = 'operating';
  bus.autoMove = true;
  bus.currentStopIdx = 0;
  const route = routeById[routeId];
  const startStop = stopById[route.stopIds[0]];
  bus.lat = startStop.lat;
  bus.lng = startStop.lng;
  bus.currentStopName = startStop.name;
  bus.nextStopName = stopById[route.stopIds[1]].name;
  bus.crowd = 'empty';
  broadcastState();
  res.json({ success: true, routeId, routeName: route.name, busId });
});

// 将运营中车辆送回休息区
app.post('/api/bus/recall', (req, res) => {
  const busId = req.body.busId || '#01';
  const bus = busById[busId];
  if (!bus) return res.status(400).json({ error: 'invalid busId' });
  if (bus.status !== 'operating') return res.status(400).json({ error: '仅运营中车辆可召回' });
  bus.status = 'standby';
  bus.autoMove = false;
  bus.speed = 0;
  bus.lat = REST_AREA.lat;
  bus.lng = REST_AREA.lng;
  bus.currentStopName = REST_AREA.name;
  bus.nextStopName = '待派车';
  bus.crowd = 'empty';
  bus.onboard = 0;
  broadcastState();
  res.json({ success: true });
});

// 切换拥挤度 (手动覆盖，保留给司机微调)
app.post('/api/bus/crowd', (req, res) => {
  const busId = req.body.busId || '#01';
  const bus = busById[busId];
  if (!bus) return res.status(400).json({ error: 'invalid busId' });
  const { crowd } = req.body;
  if (!['empty', 'medium', 'crowded'].includes(crowd)) return res.status(400).json({ error: 'invalid crowd' });
  bus.crowd = crowd;
  broadcastState();
  res.json({ success: true, crowd });
});

// 自动行驶开关
app.post('/api/bus/automove', (req, res) => {
  const busId = req.body.busId || '#01';
  const bus = busById[busId];
  if (!bus) return res.status(400).json({ error: 'invalid busId' });
  if (bus.status !== 'operating') return res.status(400).json({ error: '仅运营中车辆可操作' });
  bus.autoMove = !bus.autoMove;
  broadcastState();
  res.json({ success: true, autoMove: bus.autoMove });
});

// 模拟高峰 (保留API用于测试，UI已删除入口)
app.post('/api/simulate/peak', (req, res) => {
  const count = req.body.count || 6;
  const shuffled = [...stops].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, stops.length));
  const generated = [];
  for (const stop of selected) {
    const people = Math.floor(Math.random() * 4) + 1;
    const minutesAgo = Math.floor(Math.random() * 8) + 1;
    state.demands[stop.id] = { count: people, firstDemandAt: Date.now() - minutesAgo * 60000 };
    generated.push({ stopId: stop.id, stopName: stop.name, count: people, waitMinutes: minutesAgo });
  }
  broadcastState();
  res.json({ success: true, generated });
});

// 清空
app.post('/api/clear', (req, res) => {
  state.demands = {};
  buses.forEach(b => {
    b.totalServed = 0;
    b.totalTrips = 0;
    b.onboard = 0;
    b.crowd = 'medium';
  });
  state.exceptions = [];
  broadcastState();
  res.json({ success: true });
});

// 失物招领
app.post('/api/lostfound', (req, res) => {
  const { type, desc, contact } = req.body;
  if (!type || !desc) return res.status(400).json({ error: 'missing fields' });
  const item = {
    id: state.lostFound.length + 1, type, desc, contact: contact || '匿名',
    time: new Date().toISOString().slice(0, 16).replace('T', ' '), status: 'open'
  };
  state.lostFound.unshift(item);
  broadcastState();
  res.json({ success: true, item });
});

// 反馈
app.post('/api/feedback', (req, res) => {
  const { type, content, contact } = req.body;
  if (!type || !content) return res.status(400).json({ error: 'missing fields' });
  const fb = {
    id: state.feedbacks.length + 1, type, content, contact: contact || '匿名',
    time: new Date().toISOString().slice(0, 16).replace('T', ' '), reply: '', status: 'pending'
  };
  state.feedbacks.unshift(fb);
  broadcastState();
  res.json({ success: true, feedback: fb });
});

app.post('/api/feedback/reply', (req, res) => {
  const { id, reply } = req.body;
  const fb = state.feedbacks.find(f => f.id === parseInt(id));
  if (!fb) return res.status(404).json({ error: 'not found' });
  fb.reply = reply; fb.status = 'replied';
  broadcastState();
  res.json({ success: true, feedback: fb });
});

// 异常申报
app.post('/api/exception', (req, res) => {
  const { type, desc } = req.body;
  if (!type) return res.status(400).json({ error: 'missing type' });
  const ex = {
    id: state.exceptions.length + 1, type, desc: desc || '',
    time: new Date().toISOString().slice(0, 16).replace('T', ' '), status: 'submitted'
  };
  state.exceptions.unshift(ex);
  if (['改道', '停运', '加站'].includes(type)) {
    state.notices.unshift({
      id: state.notices.length + 100, type: 'top',
      title: `【${type}】${desc || ''}`, time: ex.time, content: `司机已申报: ${desc || type}`
    });
  }
  broadcastState();
  res.json({ success: true, exception: ex });
});

// =========================================================
//  Socket.io
// =========================================================
io.on('connection', (socket) => {
  socket.emit('state:update', getFullState());
});

// =========================================================
//  定时器
// =========================================================
setInterval(() => {
  operatingBuses().forEach(tickBus);
  broadcastState();
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚌  南审校园公交系统 v2 已启动`);
  console.log(`   学生端:   http://localhost:${PORT}/student.html`);
  console.log(`   司机端:   http://localhost:${PORT}/driver.html\n`);
});
