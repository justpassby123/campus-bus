// ============================================================
//  南审校园公交 - 后端服务 v8 (OD上下车模型)
//  Node.js + Express + Socket.io
//  16站 / 2线 / 9车(1备班) / 沁园休息区
//  v8 变更:
//   ① OD 上下车模型: 学生报站选目的地, 车到站先下后上
//   ② 容量上限 25 人, 满载溢出留站等下一班
//   ③ 溢出统计 + OD 热力统计 (答辩数据亮点)
//   ④ seedDemoData 带随机目的地, 统计一打开就有内容
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
const REST_AREA = { name: '沁园休息区', lat: 32.0645, lng: 118.6122 };

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
//  全程约25-30分钟
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
  meta: { firstBus: '08:00', lastBus: '21:30', interval: 10, loopMinutes: '25-30' }
};

// =========================================================
//  车队: 9辆 (1备班 / 8日常)
//  status: operating | resting | standby | backup
//  默认 4 辆运营 (一线2 + 二线2, 错峰半圈), 4 待命, 1 备班
//     每线 2 车 → 全程约27分钟 ÷ 2 ≈ 13-14分钟自然间隔(前端不展示间隔)
//  ⑦ shift: 上午班 / 下午班 / 备班 (排班展示用)
//  高峰模式: 待命车"热备", 需求≥15人自动建议增发 (见 PEAK_WINDOWS)
// =========================================================
const CAPACITY = 25;  // ⑥ 核定载客量 (v8: 25人上限, 满载溢出)
const LOOP_MINUTES = 27;  // 全程平均分钟数(用于计算发车间隔)

// 高峰时段 (按学校作息表: 主峰 11:50 午放学 / 20:50 晚课放学)
const PEAK_WINDOWS = [
  { label: '早高峰',   start: '08:20', end: '08:40' },
  { label: '午间放学', start: '11:45', end: '12:20' },
  { label: '下午上课', start: '13:20', end: '13:40' },
  { label: '晚课放学', start: '19:05', end: '20:20' },
  { label: '晚课放学', start: '20:40', end: '21:05' }
];
let manualPeakUntil = 0;  // 演示高峰模式: 临时强制高峰(10分钟有效)

// 北京时间 (UTC+8) — Render 容器默认 UTC, 高峰判定必须按北京时间
function bjNow() {
  const d = new Date();
  return new Date(d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000);
}

function isPeakNow() {
  const now = bjNow();
  const hm = now.getHours() * 60 + now.getMinutes();
  const clock = PEAK_WINDOWS.find(w => {
    const [sh, sm] = w.start.split(':').map(Number);
    const [eh, em] = w.end.split(':').map(Number);
    return hm >= sh * 60 + sm && hm <= eh * 60 + em;
  });
  const manual = manualPeakUntil > Date.now();
  return { active: !!(clock || manual), label: clock ? clock.label : '演示高峰', manual };
}

const fleetDef = [
  // 一线 2 辆运营, 错开半圈 (18索引, 间隔9)
  { id: '#01', driver: '张建国', routeId: 1, status: 'operating', startIdx: 0,  shift: '上午班' },
  { id: '#02', driver: '李卫东', routeId: 1, status: 'operating', startIdx: 9,  shift: '上午班' },
  // 二线 2 辆运营, 错开半圈
  { id: '#04', driver: '赵 明',  routeId: 2, status: 'operating', startIdx: 0,  shift: '上午班' },
  { id: '#05', driver: '刘 洋',  routeId: 2, status: 'operating', startIdx: 9,  shift: '下午班' },
  // 4 辆待命, 停在沁园休息区 (高峰热备/增发)
  { id: '#03', driver: '王志强', routeId: 1, status: 'standby', shift: '下午班' },
  { id: '#06', driver: '陈 静',  routeId: 2, status: 'standby', shift: '下午班' },
  { id: '#07', driver: '孙 磊',  routeId: 1, status: 'standby', shift: '下午班' },
  { id: '#08', driver: '周 婷',  routeId: 2, status: 'standby', shift: '下午班' },
  // 1 辆备班, 也停在沁园休息区
  { id: '#09', driver: '—',     routeId: 1, status: 'backup', shift: '备班' }
];

function makeBus(def) {
  // 待命/备班统一停在沁园休息区
  if (def.status === 'standby' || def.status === 'backup') {
    return {
      id: def.id, driver: def.driver, routeId: def.routeId, status: def.status, shift: def.shift,
      currentStopIdx: 0,
      lat: REST_AREA.lat, lng: REST_AREA.lng,
      currentStopName: REST_AREA.name,
      nextStopName: '待派车',
      crowd: 'empty', autoMove: false, speed: 0, dwell: 0,
      onboard: 0, passengers: {}, totalServed: 0, totalTrips: 0, lapsCompleted: 0
    };
  }
  // 运营中: 在路线上的指定位置起步
  const route = routeById[def.routeId];
  const startStop = stopById[route.stopIds[def.startIdx]];
  return {
    id: def.id, driver: def.driver, routeId: def.routeId, status: def.status, shift: def.shift,
    currentStopIdx: def.startIdx,
    lat: startStop.lat, lng: startStop.lng,
    currentStopName: startStop.name,
    nextStopName: stopById[route.stopIds[(def.startIdx + 1) % route.stopIds.length]].name,
    crowd: 'empty', autoMove: true, speed: 0, dwell: 0,
    onboard: 0, passengers: {}, totalServed: 0, totalTrips: 0, lapsCompleted: 0
  };
}
const buses = fleetDef.map(makeBus);
const busById = Object.fromEntries(buses.map(b => [b.id, b]));

// =========================================================
//  全局状态
//  demands[stopId] = { 1: {count, firstDemandAt}, 2: {count, firstDemandAt} }
//  按线路二维存储候车需求
// =========================================================
const state = {
  demands: {},
  waitStats: {},   // 候车时长统计: key=`${stopId}_${routeId}` => {total(分钟), count}
  overflowStats: {},  // v8: 溢出统计: key=`${stopId}_${routeId}` => 累计溢出人数
  odStats: {},         // v8: OD热力统计: key=`${fromId}_${toId}` => 累计上车人数
  lostFound: [
    { id: 1, type: '校园卡', desc: '蓝色校园卡，沁园站捡到', contact: '18912345678', time: '2026-07-18 14:30', status: 'open' }
  ],
  feedbacks: [
    { id: 1, type: '晚点', content: '南门北 17:30 没等到车', contact: '同学A', time: '2026-07-18 17:45', reply: '', status: 'pending' }
  ],
  notices: [
    { id: 1, type: 'top', title: '系统演示模式', time: '2026-07-25', content: '本系统为南京审计大学校园公交智能调度演示平台。首班 08:00，末班 21:30，候车请于首页选择站点与线路上报，车辆到站将实时提醒。' }
  ],
  exceptions: []
};

// =========================================================
//  候车需求 二维读写工具 (站点 × 线路)
// =========================================================
function ensureDemand(stopId, routeId) {
  if (!state.demands[stopId]) state.demands[stopId] = {};
  if (!state.demands[stopId][routeId]) state.demands[stopId][routeId] = { count: 0, firstDemandAt: Date.now(), dests: {} };
  if (!state.demands[stopId][routeId].dests) state.demands[stopId][routeId].dests = {};
  return state.demands[stopId][routeId];
}
function getDemand(stopId, routeId) {
  return state.demands[stopId] ? state.demands[stopId][routeId] : null;
}
function clearDemand(stopId, routeId) {
  if (state.demands[stopId]) {
    delete state.demands[stopId][routeId];
    if (Object.keys(state.demands[stopId]).length === 0) delete state.demands[stopId];
  }
}
function stopWait(stopId, routeId) {
  const d = getDemand(stopId, routeId);
  return d ? d.count : 0;
}

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

function getTimePeriod() {
  if (isPeakNow().active) return 'peak';
  const h = bjNow().getHours();
  if (h < 8 || h >= 21.5) return 'off';
  return 'normal';
}

// ⑥ 根据载客量自动算拥挤度 (核定22人)
function autoCrowd(onboard) {
  if (onboard <= 7) return 'empty';
  if (onboard <= 15) return 'medium';
  return 'crowded';
}

function operatingBuses() {
  return buses.filter(b => b.status === 'operating');
}

// 候车时长统计: 每次成功接客记录候车分钟数
function recordWait(stopId, routeId, minutes) {
  const key = stopId + '_' + routeId;
  if (!state.waitStats[key]) state.waitStats[key] = { total: 0, count: 0 };
  state.waitStats[key].total += minutes;
  state.waitStats[key].count += 1;
}

// v8: OD 统计 — 记录上车站→下车站
function recordOD(fromId, toId, count) {
  const key = fromId + '_' + toId;
  if (!state.odStats) state.odStats = {};
  state.odStats[key] = (state.odStats[key] || 0) + count;
}

// v8: 为候车人数随机分配目的地 (同线路后续站点)
function randomDests(stopId, routeId, count) {
  const route = routeById[routeId];
  if (!route) return {};
  const idx = route.stopIds.indexOf(stopId);
  if (idx === -1) return {};
  const candidates = [];
  for (let i = idx + 1; i < route.stopIds.length - 1; i++) {
    const sid = route.stopIds[i];
    if (sid !== stopId && stopById[sid]) candidates.push(sid);
  }
  if (candidates.length === 0) return { 1: count };
  const dests = {};
  for (let i = 0; i < count; i++) {
    const dest = candidates[Math.floor(Math.random() * candidates.length)];
    dests[dest] = (dests[dest] || 0) + 1;
  }
  return dests;
}

// =========================================================
//  演示数据自动注入 (启动即填充)
//  - 各站点按线路预置候车人数+随机目的地, 保证评委/视频一打开就有内容
//  - 预置候车时长统计样本, "数据驱动"亮点一上来就可见
//  - v8: 预置 OD 热力样本 + 溢出样本
// =========================================================
function seedDemoData() {
  // 预置候车需求 (按线路二维, 带随机目的地)
  // 设计目标: 评委点开即见"全校 16 站均有候车", 一/二线皆有分布, 数量呈真实梯度
  const seedDemands = [
    { stopId: 1,  routeId: 1, count: 5, minAgo: 7 },
    { stopId: 1,  routeId: 2, count: 4, minAgo: 6 },
    { stopId: 2,  routeId: 1, count: 6, minAgo: 5 },
    { stopId: 3,  routeId: 1, count: 5, minAgo: 4 },
    { stopId: 3,  routeId: 2, count: 4, minAgo: 3 },
    { stopId: 4,  routeId: 1, count: 3, minAgo: 2 },
    { stopId: 5,  routeId: 1, count: 2, minAgo: 3 },
    { stopId: 5,  routeId: 2, count: 2, minAgo: 4 },
    { stopId: 6,  routeId: 1, count: 4, minAgo: 5 },
    { stopId: 7,  routeId: 2, count: 3, minAgo: 4 },
    { stopId: 8,  routeId: 1, count: 3, minAgo: 2 },
    { stopId: 8,  routeId: 2, count: 2, minAgo: 3 },
    { stopId: 9,  routeId: 1, count: 5, minAgo: 3 },
    { stopId: 9,  routeId: 2, count: 4, minAgo: 2 },
    { stopId: 10, routeId: 2, count: 3, minAgo: 4 },
    { stopId: 11, routeId: 1, count: 6, minAgo: 6 },
    { stopId: 11, routeId: 2, count: 5, minAgo: 5 },
    { stopId: 12, routeId: 1, count: 4, minAgo: 3 },
    { stopId: 12, routeId: 2, count: 3, minAgo: 4 },
    { stopId: 13, routeId: 2, count: 4, minAgo: 5 },
    { stopId: 14, routeId: 2, count: 3, minAgo: 3 },
    { stopId: 15, routeId: 2, count: 5, minAgo: 5 },
    { stopId: 15, routeId: 1, count: 3, minAgo: 4 },
    { stopId: 16, routeId: 1, count: 3, minAgo: 4 }
  ];
  seedDemands.forEach(({ stopId, routeId, count, minAgo }) => {
    const d = ensureDemand(stopId, routeId);
    d.count = count;
    d.firstDemandAt = Date.now() - minAgo * 60000;
    d.dests = randomDests(stopId, routeId, count);
  });
  // 预置统计样本: 累计 132 次接客 / 424 分钟 → 全校均候 ≈ 3.2 分
  const preset = [
    [2,1,58,18],[2,2,45,14],[3,1,64,20],[3,2,38,12],[4,1,45,14],
    [9,1,38,12],[15,2,52,16],[12,1,32,10],[13,2,26,8],[16,1,26,8]
  ];
  preset.forEach(([sid, rid, total, cnt]) => {
    state.waitStats[sid + '_' + rid] = { total, count: cnt };
  });
  // v8: 预置 OD 热力样本 (from→to: 累计上车人次)
  const odPairs = [
    [3,12,15],[3,13,8],[2,9,12],[2,13,6],[4,14,10],
    [15,9,14],[9,13,11],[9,1,9],[15,2,8],[3,9,7],[4,9,5],[2,12,9]
  ];
  odPairs.forEach(([from, to, cnt]) => {
    state.odStats[from + '_' + to] = cnt;
  });
  // v8: 预置溢出样本 (竹苑/中和楼/竞秀楼高峰满载)
  state.overflowStats = { '11_1': 4, '2_1': 3, '15_2': 2 };

  // 预置车队载客情形多样化 (演示多种情形):
  //   #01(一线·沁园→中和楼) 适中 14/25, 下站(中和楼)下 4 人 → 演示"适中"+下车动态
  //   #02(一线·泽园南→竹苑) 空载  6/25, 下站(竹苑)下 2 人   → 演示"空载"
  //   #04(二线·沁园→中和楼) 满载 25/25, 下站(中和楼)下 3 人 → 演示"满载预警"+拥挤
  //   #05(二线·泽园餐厅→澄园一站) 拥挤 17/25, 下站(澄园一站)下 5 人 → 演示"拥挤"
  //   → 四种拥挤态(空载/适中/拥挤/满载)齐全, 且每车下站均有乘客下车, 体现"上下车"动态
  if (busById['#01']) {
    busById['#01'].onboard = 14;
    busById['#01'].passengers = { 2: 4, 9: 5, 12: 3, 16: 2 };   // 中和楼4 / 泽园餐厅5 / 润园3 / 南门南2
    busById['#01'].crowd = autoCrowd(14);
  }
  if (busById['#02']) {
    busById['#02'].onboard = 6;
    busById['#02'].passengers = { 11: 2, 12: 2, 13: 2 };        // 竹苑2 / 润园2 / 润园餐厅2
    busById['#02'].crowd = autoCrowd(6);
  }
  if (busById['#04']) {
    busById['#04'].onboard = 25;                                // 满载 (25/25) → 演示"满载预警"
    busById['#04'].passengers = { 2: 3, 9: 10, 12: 8, 13: 4 }; // 中和楼3 / 泽园餐厅10 / 润园8 / 润园餐厅4
    busById['#04'].crowd = autoCrowd(25);
  }
  if (busById['#05']) {
    busById['#05'].onboard = 17;                                // 拥挤 (17/25)
    busById['#05'].passengers = { 8: 5, 7: 4, 6: 3, 5: 3, 4: 2 }; // 澄园一站5 / 澄园北4 / 澄园南3 / 敏达楼3 / 敏行楼2
    busById['#05'].crowd = autoCrowd(17);
  }
}

// 可增发的待命/备班车 (优先同线路)
function standbyBusForRoute(routeId) {
  return buses.find(b => ['standby', 'backup', 'resting'].includes(b.status) && b.routeId === routeId)
      || buses.find(b => ['standby', 'backup', 'resting'].includes(b.status));
}

// 最近的"该线路"运营车辆 (只有同线路车才会接该线乘客)
function nearestBusToStop(stop, routeId) {
  const ops = operatingBuses().filter(b => !routeId || b.routeId === routeId);
  if (ops.length === 0) return null;
  let best = null, bestDist = Infinity;
  for (const b of ops) {
    const d = haversine(b.lat, b.lng, stop.lat, stop.lng);
    if (d < bestDist) { bestDist = d; best = b; }
  }
  return { bus: best, dist: bestDist };
}

// =========================================================
//  v8 到站服务: OD 先下后上模型
//  ① 下车: 车上目的地 == 本站的乘客下车
//  ② 上车: 空位内接客, 满载溢出留站等下一班
//  ③ 统计: 记录候车时长 + OD 热力 + 溢出次数
// =========================================================
function serveStop(bus, stopId) {
  // ① 下车: 车上目的地 == 本站的乘客下车
  let offCount = (bus.passengers && bus.passengers[stopId]) || 0;
  if (offCount > 0) {
    bus.onboard = Math.max(0, bus.onboard - offCount);
    delete bus.passengers[stopId];
  }

  // ② 上车: 先下后上, 满载溢出
  const d = getDemand(stopId, bus.routeId);
  let served = 0, remaining = 0;
  let boardedDests = {};
  let waitDuration = 0;
  let nextBusId = null, nextEta = 0;

  if (d && d.count > 0) {
    const space = Math.max(0, CAPACITY - bus.onboard);
    served = Math.min(d.count, space);
    waitDuration = (Date.now() - d.firstDemandAt) / 60000;

    if (served > 0) {
      bus.onboard += served;
      bus.totalServed += served;
      bus.totalTrips++;

      // 按目的地贪心分配上车乘客到 bus.passengers
      let toBoard = served;
      const newDests = {};
      for (const [destId, cnt] of Object.entries(d.dests || {})) {
        if (toBoard <= 0) { newDests[destId] = cnt; continue; }
        const take = Math.min(cnt, toBoard);
        boardedDests[destId] = (boardedDests[destId] || 0) + take;
        bus.passengers[destId] = (bus.passengers[destId] || 0) + take;
        // OD 统计
        recordOD(stopId, parseInt(destId), take);
        if (cnt > take) newDests[destId] = cnt - take;
        toBoard -= take;
      }
      d.count -= served;
      d.dests = newDests;
    }

    remaining = d.count;

    // 满载溢出: 算下一班 ETA
    if (remaining > 0) {
      const stop = stopById[stopId];
      let best = null, bd = Infinity;
      for (const b of operatingBuses()) {
        if (b.routeId !== bus.routeId || b.id === bus.id) continue;
        const dd = haversine(b.lat, b.lng, stop.lat, stop.lng);
        if (dd < bd) { bd = dd; best = b; }
      }
      if (best) { nextBusId = best.id; nextEta = Math.max(1, Math.round(bd / 20 * 60)); }

      // 溢出统计
      const ovKey = stopId + '_' + bus.routeId;
      state.overflowStats[ovKey] = (state.overflowStats[ovKey] || 0) + remaining;
    }

    // 候车时长统计 (有接客即记录)
    recordWait(stopId, bus.routeId, waitDuration);

    if (d.count <= 0) clearDemand(stopId, bus.routeId);

    io.emit('demand:resolved', {
      stopId, stopName: stopById[stopId].name, routeId: bus.routeId,
      routeName: routeById[bus.routeId].name,
      served, busId: bus.id, remaining,
      offCount,
      waitDuration: Math.round(waitDuration * 10) / 10,
      overflow: remaining > 0,
      nextBusId, nextEta,
      boardedDests
    });
  }

  bus.crowd = autoCrowd(bus.onboard);
  return served;
}

// =========================================================
//  调度引擎 (每 站点×线路 一条)
// =========================================================
function calculateSchedule() {
  const now = Date.now();
  const result = [];
  for (const s of stops) {
    for (const routeId of [1, 2]) {
      const d = getDemand(s.id, routeId);
      if (!d || d.count <= 0) continue;
      const waitDuration = (now - d.firstDemandAt) / 60000;
      const nb = nearestBusToStop(s, routeId);
      const distance = nb ? nb.dist : 1;
      const score = d.count * 10 + waitDuration * 2 - distance * 1;
      let priority;
      if (score >= 30) priority = 'high';
      else if (score >= 15) priority = 'medium';
      else priority = 'low';
      const eta = nb ? Math.max(1, Math.round(distance / 20 * 60)) : 0;
      const sb = standbyBusForRoute(routeId);
      const ws = state.waitStats[s.id + '_' + routeId];
      const avgWait = ws && ws.count ? Math.round(ws.total / ws.count * 10) / 10 : 0;
      // v8: 目的地 Top3
      const destList = Object.entries(d.dests || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([destId, cnt]) => ({ destId: parseInt(destId), destName: stopById[destId] ? stopById[destId].name : '?', count: cnt }));
      // v8: 该站溢出历史
      const ovKey = s.id + '_' + routeId;
      const overflowTotal = state.overflowStats[ovKey] || 0;
      result.push({
        id: s.id, name: s.name, lat: s.lat, lng: s.lng,
        routeId, routeName: routeById[routeId].name,
        waitCount: d.count,
        waitDuration: Math.round(waitDuration * 10) / 10,
        avgWait,
        distance: Math.round(distance * 100) / 100,
        score: Math.round(score * 10) / 10,
        priority, eta,
        nearestBusId: nb ? nb.bus.id : null,
        suggestDispatch: priority === 'high',
        nearbyBusId: sb ? sb.id : null,
        destList,
        overflowTotal
      });
    }
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
  const demandList = stops.map(s => {
    const w1 = stopWait(s.id, 1), w2 = stopWait(s.id, 2);
    const firsts = [getDemand(s.id, 1), getDemand(s.id, 2)].filter(Boolean).map(d => d.firstDemandAt);
    const first = firsts.length ? Math.min(...firsts) : 0;
    const ws1 = state.waitStats[s.id + '_1'], ws2 = state.waitStats[s.id + '_2'];
    let tot = 0, cnt = 0;
    if (ws1) { tot += ws1.total; cnt += ws1.count; }
    if (ws2) { tot += ws2.total; cnt += ws2.count; }
    const avgWait = cnt ? Math.round(tot / cnt * 10) / 10 : 0;
    return {
      id: s.id, name: s.name, lat: s.lat, lng: s.lng,
      wait1: w1, wait2: w2, waitCount: w1 + w2,
      waitDuration: first ? Math.round((Date.now() - first) / 60000 * 10) / 10 : 0,
      avgWait
    };
  });

  const line1Ops = operatingBuses().filter(b => b.routeId === 1).length;
  const line2Ops = operatingBuses().filter(b => b.routeId === 2).length;
  const headway1 = line1Ops > 0 ? Math.round(LOOP_MINUTES / line1Ops) : 0;
  const headway2 = line2Ops > 0 ? Math.round(LOOP_MINUTES / line2Ops) : 0;

  return {
    stops: demandList,
    capacity: CAPACITY,
    buses: buses.map(b => {
      const route = routeById[b.routeId];
      const nextStopId = route ? route.stopIds[(b.currentStopIdx + 1) % route.stopIds.length] : null;
      const offNext = (b.passengers && b.passengers[nextStopId]) || 0;
      // v8: 车上乘客去向明细 (Top5)
      const destSummary = Object.entries(b.passengers || {})
        .sort((a, b2) => b2[1] - a[1])
        .slice(0, 5)
        .map(([destId, cnt]) => ({ destId: parseInt(destId), destName: stopById[destId] ? stopById[destId].name : '?', count: cnt }));
      return {
        id: b.id, driver: b.driver, routeId: b.routeId, status: b.status, shift: b.shift,
        lat: b.lat, lng: b.lng, crowd: b.crowd, speed: b.speed,
        currentStopName: b.currentStopName, nextStopName: b.nextStopName, nextStopId,
        autoMove: b.autoMove, totalServed: b.totalServed, totalTrips: b.totalTrips,
        onboard: b.onboard, offNext, destSummary, lapsCompleted: b.lapsCompleted
      };
    }),
    restArea: REST_AREA,
    schedule,
    timePeriod: getTimePeriod(),
    peak: isPeakNow(),
    lastTick: state.lastTick || 0,
    fleet: {
      total: buses.length,
      daily: buses.filter(b => b.status !== 'backup').length,
      backup: buses.filter(b => b.status === 'backup').length,
      operating: operatingBuses().length,
      resting: buses.filter(b => b.status === 'resting' || b.status === 'standby').length,
      line1Operating: line1Ops,
      line2Operating: line2Ops,
      headway1, headway2,
      loopMinutes: LOOP_MINUTES
    },
    notices: state.notices.slice(0, 3),
    feedbacks: state.feedbacks,
    lostFound: state.lostFound,
    exceptions: state.exceptions,
    stats: (() => {
      let tot = 0, cnt = 0;
      Object.values(state.waitStats).forEach(w => { tot += w.total; cnt += w.count; });
      // v8: 溢出统计
      let overflowTotal = 0;
      Object.values(state.overflowStats || {}).forEach(v => overflowTotal += v);
      // v8: OD 热力 Top8
      const odTop = Object.entries(state.odStats || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([key, cnt]) => {
          const [from, to] = key.split('_').map(Number);
          return { fromId: from, fromName: stopById[from] ? stopById[from].name : '?', toId: to, toName: stopById[to] ? stopById[to].name : '?', count: cnt };
        });
      return {
        avgWait: cnt ? Math.round(tot / cnt * 10) / 10 : 0,
        samples: cnt,
        overflow: overflowTotal,
        odTop
      };
    })()
  };
}

function broadcastState() {
  io.emit('state:update', getFullState());
}

// =========================================================
//  公交自动移动模拟
//  真实比例: 校园限速20km/h, 一圈25-30分钟
//  演示压缩: 显示速度18-20km/h, 一圈约4-5分钟
//  ⑦ 不再"跑完一圈就休息", 持续环线运营 (交班/召回走调度台)
// =========================================================
const TICK_MS = 2000;           // 定时器间隔 2秒
const MOVE_STEP = 0.0001;       // 每 tick 经纬度步长
const DWELL_TICKS = 2;          // 到站停靠 tick 数 (~4秒)

function tickBus(bus) {
  if (bus.status !== 'operating') { bus.speed = 0; return; }
  if (!bus.autoMove) { bus.speed = 0; return; }

  const route = routeById[bus.routeId];
  const ids = route.stopIds;

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

    // 下客 + 上客
    serveStop(bus, nextId);

    // 回到起点 沁园(id=1) → 完成一圈, 终点全部下车, 继续下一圈(不休息)
    if (nextId === 1) {
      bus.lapsCompleted++;
      bus.onboard = 0;
      bus.passengers = {};
      bus.crowd = 'empty';
    }
    bus.nextStopName = stopById[ids[(bus.currentStopIdx + 1) % ids.length]].name;
  } else {
    // 正常移动
    bus.lat += (dLat / dist) * MOVE_STEP;
    bus.lng += (dLng / dist) * MOVE_STEP;
    const displaySpeed = 18 + Math.floor(Math.random() * 3); // 18~20
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

// ① 上报候车需求 (需带 routeId + destStopId) → 返回该线最近班车 ETA
app.post('/api/demand', (req, res) => {
  const id = parseInt(req.body.stopId);
  const routeId = parseInt(req.body.routeId) || 1;
  const destStopId = parseInt(req.body.destStopId);
  if (!id || !stopById[id]) return res.status(400).json({ error: 'invalid stopId' });
  if (![1, 2].includes(routeId)) return res.status(400).json({ error: '请选择一线或二线' });

  // v8: 校验目的站 — 必须在同线路后续站点中
  const route = routeById[routeId];
  const stopIdx = route.stopIds.indexOf(id);
  if (stopIdx === -1) return res.status(400).json({ error: '该站不在此线路中' });

  let finalDest = destStopId;
  if (!finalDest) {
    // 未选目的站时自动随机分配 (兜底)
    const candidates = [];
    for (let i = stopIdx + 1; i < route.stopIds.length - 1; i++) {
      candidates.push(route.stopIds[i]);
    }
    finalDest = candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : id;
  } else {
    const destIdx = route.stopIds.indexOf(finalDest);
    if (destIdx === -1 || destIdx <= stopIdx) {
      return res.status(400).json({ error: '目的站无效或不在该线路后续站点中' });
    }
  }

  const d = ensureDemand(id, routeId);
  d.count++;
  d.dests[finalDest] = (d.dests[finalDest] || 0) + 1;
  const schedule = calculateSchedule();
  const target = schedule.find(s => s.id === id && s.routeId === routeId);
  const eta = target ? target.eta : 0;
  const busId = target ? target.nearestBusId : null;
  const nbBus = busId ? busById[busId] : null;
  const full = !!(nbBus && nbBus.onboard >= CAPACITY);
  io.emit('demand:new', {
    stopId: id, stopName: stopById[id].name,
    routeId, routeName: routeById[routeId].name,
    count: d.count, eta, busId,
    destStopId: finalDest, destStopName: stopById[finalDest] ? stopById[finalDest].name : '?'
  });
  broadcastState();
  res.json({
    success: true, stopName: stopById[id].name,
    routeId, routeName: routeById[routeId].name,
    destStopName: stopById[finalDest] ? stopById[finalDest].name : '?',
    waitCount: d.count, eta, busId, full
  });
});

// ①-b P0: 双线智能选线推荐
//   学生只选 上车站 + 下车站, 后端自动对比一线/二线:
//   ① 是否可达 (环线正向可到) ② 途经站数 ③ 最近班车 ETA ④ 是否满载
//   返回 recommend = 可达且 ETA 最小的线路
app.get('/api/route/suggest', (req, res) => {
  const from = parseInt(req.query.from);
  const to = parseInt(req.query.to);
  if (!from || !to || !stopById[from] || !stopById[to]) return res.status(400).json({ error: '无效站点' });
  if (from === to) return res.status(400).json({ error: '上车站与下车站不能相同' });

  // 环线: 从 from 正向(可绕圈)走到 to 的途经站数
  function loopStopCount(route, fromId, toId) {
    const ids = route.stopIds;
    const start = ids.indexOf(fromId);
    if (start === -1) return null;
    for (let i = 1; i <= ids.length; i++) {
      if (ids[(start + i) % ids.length] === toId) return i; // 含下车站, 不含上车站
    }
    return null;
  }

  const lines = [1, 2].map(routeId => {
    const route = routeById[routeId];
    const stopCount = loopStopCount(route, from, to);
    const reachable = stopCount !== null;
    let eta = 0, nearestBusId = null, full = false, onboard = 0;
    if (reachable) {
      // 直接用"最近运营车"计算 ETA (不依赖 calculateSchedule, 后者只覆盖已有需求的站点)
      const nb = nearestBusToStop(stopById[from], routeId);
      const distance = nb ? nb.dist : 1;
      eta = nb ? Math.max(1, Math.round(distance / 20 * 60)) : 0;
      nearestBusId = nb ? nb.bus.id : null;
      const bus = nearestBusId ? busById[nearestBusId] : null;
      full = !!(bus && bus.onboard >= CAPACITY);
      onboard = bus ? bus.onboard : 0;
    }
    return { routeId, routeName: route.name, reachable, stopCount: stopCount || 0, eta, nearestBusId, full, onboard };
  });

  // 推荐: 综合路线时间(ETA)与车辆人员情况(载客越多越不优), 分数越低越优
  let recommend = null;
  const reachables = lines.filter(l => l.reachable);
  if (reachables.length) {
    reachables.sort((a, b) => {
      const sa = a.eta + a.onboard * 0.5;
      const sb = b.eta + b.onboard * 0.5;
      return sa - sb;
    });
    recommend = reachables[0].routeId;
  }
  res.json({ from, to, lines, recommend });
});

// ② 学生核销: 我已上车 / 我不等了 (该线人数 -1)
app.post('/api/demand/cancel', (req, res) => {
  const id = parseInt(req.body.stopId);
  const routeId = parseInt(req.body.routeId) || 1;
  if (!id || !stopById[id]) return res.status(400).json({ error: 'invalid stopId' });
  const d = getDemand(id, routeId);
  if (d) {
    d.count = Math.max(0, d.count - 1);
    if (d.count <= 0) clearDemand(id, routeId);
  }
  broadcastState();
  res.json({ success: true, waitCount: d ? d.count : 0 });
});

// 司机到站确认 (手动推进一站, 复用 serveStop)
app.post('/api/bus/arrive', (req, res) => {
  const busId = req.body.busId || '#01';
  const bus = busById[busId];
  if (!bus) return res.status(400).json({ error: 'invalid busId' });
  if (bus.status !== 'operating') return res.status(400).json({ error: '该车未在运营中' });
  const route = routeById[bus.routeId];
  const nextId = route.stopIds[(bus.currentStopIdx + 1) % route.stopIds.length];
  const nxt = stopById[nextId];
  // 就近校验: 车辆须接近目标站才能确认到站, 否则会出现"提前通知"(圆点未到却已通知上车)
  const distKm = haversine(bus.lat, bus.lng, nxt.lat, nxt.lng);
  if (distKm > 0.08) {
    return res.status(400).json({ error: `车辆尚未到达${nxt.name}，无法确认（距该站约${Math.round(distKm * 1000)}米）` });
  }
  bus.currentStopIdx = (bus.currentStopIdx + 1) % route.stopIds.length;
  bus.lat = nxt.lat;
  bus.lng = nxt.lng;
  bus.currentStopName = nxt.name;
  bus.dwell = DWELL_TICKS;
  serveStop(bus, nextId);
  if (nextId === 1) { bus.lapsCompleted++; bus.onboard = 0; bus.passengers = {}; bus.crowd = 'empty'; }
  bus.nextStopName = stopById[route.stopIds[(bus.currentStopIdx + 1) % route.stopIds.length]].name;
  broadcastState();
  res.json({ success: true });
});

// ③ 从休息区/待命/备班 选线路发车 (调度台派车)
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
  bus.onboard = 0;
  bus.passengers = {};
  broadcastState();
  res.json({ success: true, routeId, routeName: route.name, busId });
});

// ③ 将运营中车辆召回休息区 (调度台召回)
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
  bus.passengers = {};
  broadcastState();
  res.json({ success: true });
});

// 切换拥挤度 (手动覆盖, 保留给司机微调)
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

// 模拟高峰 (演示用, 按线路随机造需求)
app.post('/api/simulate/peak', (req, res) => {
  const count = req.body.count || 6;
  const shuffled = [...stops].sort(() => Math.random() - 0.5);
  const selected = shuffled.slice(0, Math.min(count, stops.length));
  const generated = [];
  for (const stop of selected) {
    const routeId = Math.random() < 0.5 ? 1 : 2;
    const people = Math.floor(Math.random() * 4) + 1;
    const minutesAgo = Math.floor(Math.random() * 8) + 1;
    const d = ensureDemand(stop.id, routeId);
    d.count = people;
    d.firstDemandAt = Date.now() - minutesAgo * 60000;
    d.dests = randomDests(stop.id, routeId, people);
    generated.push({ stopId: stop.id, stopName: stop.name, routeId, count: people, waitMinutes: minutesAgo });
  }
  broadcastState();
  res.json({ success: true, generated });
});

// 演示高峰模式开关 (答辩演示用: 临时强制高峰10分钟)
app.post('/api/peak/toggle', (req, res) => {
  if (manualPeakUntil > Date.now()) manualPeakUntil = 0;
  else manualPeakUntil = Date.now() + 10 * 60 * 1000;
  broadcastState();
  res.json({ success: true, active: manualPeakUntil > Date.now() });
});

// 一键演示: 晚课放学高峰 (中和楼/敏行楼/竞秀楼 并发需求 + 强制高峰)
// 用于答辩/视频快速进入高光剧情, 无需逐个手动上报
app.post('/api/demo/evening-rush', (req, res) => {
  manualPeakUntil = Date.now() + 10 * 60 * 1000;   // 强制高峰 10 分钟
  const burst = [
    { stopId: 2,  routeId: 1, count: 12 },  // 中和楼 一线
    { stopId: 2,  routeId: 2, count: 10 },  // 中和楼 二线
    { stopId: 4,  routeId: 1, count: 8 },   // 敏行楼 一线
    { stopId: 15, routeId: 2, count: 9 },   // 竞秀楼 二线
    { stopId: 3,  routeId: 1, count: 7 }    // 南门北 一线
  ];
  const generated = [];
  burst.forEach(({ stopId, routeId, count }) => {
    const d = ensureDemand(stopId, routeId);
    d.count = count;
    d.firstDemandAt = Date.now();
    d.dests = randomDests(stopId, routeId, count);
    generated.push({ stopId, stopName: stopById[stopId].name, routeId, count });
  });
  broadcastState();
  res.json({ success: true, peak: true, generated });
});

// 清空
app.post('/api/clear', (req, res) => {
  state.demands = {};
  state.overflowStats = {};
  buses.forEach(b => {
    b.totalServed = 0;
    b.totalTrips = 0;
    b.onboard = 0;
    b.passengers = {};
    b.crowd = 'empty';
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
seedDemoData();   // 启动即注入演示数据, 保证一打开就有内容
setInterval(() => {
  operatingBuses().forEach(tickBus);
  broadcastState();
}, TICK_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚌  南审校园公交系统 v7 已启动`);
  console.log(`   ✔ 演示数据已自动注入（候车 + 统计样本）`);
  console.log(`   学生端:   http://localhost:${PORT}/student.html`);
  console.log(`   司机端:   http://localhost:${PORT}/driver.html\n`);
});
