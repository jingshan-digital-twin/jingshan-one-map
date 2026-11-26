import { readFile, writeFile } from 'node:fs/promises';
import { withCourtLedger } from '../src/jingshan/court-ledger.ts';
import { eventAssistance } from '../src/jingshan/analytics.ts';

const directory = new URL('../public/jingshan/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, directory), 'utf8'));
const seed = await read('demo-data.json');
const boundaries = (await read('administration.json')).features;
const layers = new Map(seed.datasets.map(dataset => [dataset.id, dataset.features]));
const get = id => layers.get(id);
const asOf = '2026-11-13';
const demoFusionEvent = 'event-20261012-open';
const currentMonth = asOf.slice(0, 7);
const months = Array.from({ length: 11 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
const p = item => item.properties;
const sum = (items, getValue) => items.reduce((total, item) => total + getValue(item), 0);
const percent = (a, b) => b ? Math.round(a * 1000 / b) / 10 : 0;

let state = 0x20261113;
function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2 ** 32;
}
const between = (from, to) => from + Math.floor(random() * (to - from + 1));
const choose = items => items[Math.floor(random() * items.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const point = coordinates => ({ type: 'Point', coordinates });
const feature = (id, kind, name, region, geometry, details) => ({
  type: 'Feature', id, geometry, properties: { kind, name, region, ...details, sample: true },
});
function dataset(id, name, department, category, description, features) {
  seed.datasets.push({ id, name, department, category, description: description + ' 本层为模拟数据。', features });
}

function position(item) {
  const { type, coordinates } = item.geometry;
  if (type === 'Point') return coordinates;
  const ring = type === 'Polygon' ? coordinates[0].slice(0, -1) : coordinates;
  return [0, 1].map(axis => sum(ring, value => value[axis]) / ring.length);
}
function offset([longitude, latitude], east, north) {
  return [
    +(longitude + east / (111320 * Math.cos(latitude * Math.PI / 180))).toFixed(7),
    +(latitude + north / 110852).toFixed(7),
  ];
}
function distance(a, b) {
  return Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * Math.PI / 180), (a[1] - b[1]) * 110852);
}
function ringContains([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
function contains(item, coordinates) {
  const polygons = item.geometry.type === 'Polygon' ? [item.geometry.coordinates] : item.geometry.coordinates;
  return polygons.some(([outline, ...holes]) => ringContains(coordinates, outline) &&
    !holes.some(hole => ringContains(coordinates, hole)));
}
const towns = new Map(boundaries.filter(item => p(item).kind === 'town-boundary').map(item => [p(item).region, item]));
const cityBoundary = boundaries.find(item => p(item).kind === 'city-boundary');
function scatter(anchor, radius) {
  const boundary = towns.get(p(anchor).region);
  for (let attempt = 0; attempt < 15; attempt++) {
    const bearing = random() * Math.PI * 2;
    const length = between(50, radius);
    const coords = offset(position(anchor), Math.cos(bearing) * length, Math.sin(bearing) * length);
    if (!boundary || contains(boundary, coords)) return coords;
  }
  return position(anchor);
}
function circle(center, radius) {
  const ring = Array.from({ length: 36 }, (_, index) => {
    const angle = index * Math.PI * 2 / 36;
    return offset(center, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
function addDays(date, days) {
  const time = new Date(date + 'T00:00:00Z');
  time.setUTCDate(time.getUTCDate() + days);
  return time.toISOString().slice(0, 10);
}

const venues = get('venues');
const courts = get('courts');
const events = get('events');
const fallbackEventSite=(id)=>events.find(e=>e.id===id) ?? events[0];
const sampleEvent=fallbackEventSite('event-20261012-open');
const localEvent=fallbackEventSite('event-20261128-community');
const [upcoming, open] = ['event-20261214-youth-tour', 'event-20261012-open'].map(id => events.find(item => item.id === id));
const cityCenter = position(sampleEvent);
const cityRegion = p(sampleEvent).region;
for (const business of get('businesses')) {
  const fields = p(business);
  fields.tennisEnterprise = !['俱乐部', '培训机构', '住宿餐饮', '文旅'].includes(fields.subtype);
}

const lateNovember = feature('event-20261111-weekend-cup', 'event', '京山秋季网球双打积分赛', cityRegion, point(position(localEvent)), {
  date: '2026-11-11', days: 2, stayDays: 1.4, attendance: 430, visitors: 129, level: '群众', status: '已办结',
  spend: 26.8, overnightGuests: 78, nights: 108,
  scenicVisitors: 94, secondarySpendVisitors: 49, players: 128, companions: 102, spectators: 200,
  occupancy: [52, 56, 66, 59, 50], color: '#36d994',
});
events.splice(events.indexOf(upcoming), 0, lateNovember);
const originGroups = [
  ['武汉', [114.31, 30.58], 42],
  ['荆门', [112.20, 31.04], 33],
  ['襄阳', [112.14, 32.04], 17],
  ['宜昌', [111.29, 30.69], 14],
  ['省外', [114.02, 31.92], 13],
  ['其他', [113.38, 31.70], 10],
];
for (const [index, [from, start, people]] of originGroups.entries()) {
  get('origins').push(feature('origin-' + lateNovember.id + '-' + (index + 1), 'origin', from + ' · 双打积分赛',
    cityRegion, point(start), {
      eventId: lateNovember.id, from, people, count: people,
      share: percent(people, p(lateNovember).visitors), color: '#43cafa',
    }));
}
for (const event of events) {
  const fields = p(event);
  fields.endDate = addDays(fields.date, fields.days - 1);
  fields.registrationLimit = Math.ceil(fields.players * 1.1 / 8) * 8;
  fields.registered = fields.status === '已办结' ? fields.players : Math.round(fields.players * .76);
  fields.registrationFee = { 国际: 120, 全国: 98, 省级: 70, 群众: 30 }[fields.level] ?? 30;
  fields.registrationDeadline = addDays(fields.date, -4);
  fields.safetyPlanStatus = fields.status === '已办结' ? '已归档' : '模拟已制定';
  fields.permitStatus = fields.attendance >= 1000 ? '模拟已受理' : '按活动规模核验';
  fields.registrationStatus = fields.status === '已办结' ? '已截止' : '开放报名';
  fields.host = '赛事组委会（演示）';
}

const categories = [
  { name: '酒店民宿', dataset: 'hotels', total: 86, joined: 42, pending: 2, color: '#ffd566',
    locations: ['山居', '球场驿站', '田园民宿', '城市轻居', '长住公寓', '旅居小院', '云栖客栈', '亲子民宿'] },
  { name: '餐饮', dataset: 'food', total: 268, joined: 96, pending: 2, color: '#ffa258',
    locations: ['早餐铺', '家常菜馆', '农家菜馆', '小碗菜', '炖汤铺', '简餐咖啡', '米面馆', '运动轻食', '夜宵排档'] },
  { name: '景区温泉', dataset: 'tourism', total: 12, joined: 9, pending: 1, color: '#41e2a5', locations: [] },
  { name: '购物', total: 35, joined: 27, pending: 1, color: '#49c2ff',
    locations: ['京山好物馆', '运动补给站', '农产展销店', '礼品店', '旅游纪念品店', '网球主题商店'] },
  { name: '培训机构', dataset: 'training', total: 19, joined: 12, pending: 0, color: '#bb90ff', locations: [] },
];
const anchors = venues.flatMap(venue => p(venue).region === '新市街道' ? [venue, venue, venue] : [venue]);
const merchants = [];
for (const [categoryIndex, category] of categories.entries()) {
  const source = category.dataset ? get(category.dataset) : [];
  for (let index = 0; index < category.total; index++) {
    const related = source[index];
    const anchor = related ?? choose(anchors);
    const declaredRegion = p(anchor).region;
    const joined = index < category.joined;
    const pending = index >= category.joined && index < category.joined + category.pending;
    const number = String(index + 1).padStart(3, '0');
    const nameTail = related ? '' : choose(category.locations) + ' ' + number;
    const price = Number(p(anchor).price) || between(categoryIndex === 0 ? 120 : 18, categoryIndex === 0 ? 350 : 112);
    const capacity = related ? p(related).beds ?? p(related).seats ?? p(related).capacity
      : between(categoryIndex === 0 ? 14 : 20, categoryIndex === 0 ? 145 : 98);
    const joinedAt = joined ? index % 13 === 0 ? `2026-11-${String(between(1, 12)).padStart(2, '0')}` : addDays('2025-09-01', between(0, 403)) : '';
    const proposed = related ? position(related) : scatter(anchor, categoryIndex === 0 ? 1500 : 1050);
    const coords = contains(cityBoundary, proposed) ? proposed
      : position(venues.find(venue => p(venue).region === declaredRegion) ?? sampleEvent);
    const region = [...towns].find(([, shape]) => contains(shape, coords))?.[0] ?? declaredRegion;
    const name = related ? p(related).name.replace(declaredRegion, region)
      : region.replace(/街道$|镇$/, '') + nameTail;
    merchants.push(feature(`merchant-${categoryIndex + 1}-${number}`, 'merchant', name, region,
      point(coords), {
        category: category.name, status: joined ? '已入驻' : pending ? '待审核' : '未入驻',
        joined, joinedAt, appliedAt: pending ? addDays(asOf, -between(1, 11)) : joinedAt,
        reviewStatus: joined ? '审核通过' : pending ? '待审核' : '未申请',
        sourceId: related?.id ?? '', price, capacity, rating: joined ? between(42, 50) / 10 : 0,
        reviewCount: joined ? between(8, 132) : 0,
        complaintsOpen: categoryIndex === 1 && index === 5 ? 1 : 0,
        color: joined ? category.color : '#7a91b0', redemptions: 0,
        redemptionsByMonth: Object.fromEntries(months.map(month => [month, 0])),
      }));
  }
}
const partners = merchants.filter(item => p(item).joined);
const joinedOf = category => partners.filter(item => p(item).category === category);
const offers = [];
const offerRules = {
  酒店民宿: ['预订指定房型减30元', '入住送双人早餐'],
  餐饮: ['指定菜品九折', '满120元立减15元'],
  景区温泉: ['门票八折', '第二位半价'],
  购物: ['满80元减10元', '运动补给组合九折'],
  培训机构: ['体验课立减20元', '团课首单九折'],
};
const categoriesForOffers = [4, 23, 8, 9, 4];
for (const [categoryIndex, { name: category }] of categories.entries()) {
  for (const [index, merchant] of joinedOf(category).slice(0, categoriesForOffers[categoryIndex]).entries()) {
    const status = [5, 27, 45].includes(offers.length) ? '待审核' : '已上架';
    const rule = offerRules[category][index % 2];
    const validFrom = p(merchant).joinedAt < '2026-01-01' ? '2026-01-01' : p(merchant).joinedAt;
    const monthCounts = Object.fromEntries(months.map((month, monthIndex) => {
      const enabled = status === '已上架' && month >= validFrom.slice(0, 7);
      const multiplier = month === currentMonth ? .55 : month === '2026-10' ? 1.55 : .65 + monthIndex * .052;
      const volume = p(merchant).sourceId === 'tourism-3' ? 480 : category === '景区温泉' ? 112 : category === '餐饮' ? 61 : 42;
      const count = enabled ? Math.round(volume * multiplier * between(45, 125) / 100) : 0;
      p(merchant).redemptionsByMonth[month] += count;
      return [month, count];
    }));
    offers.push(feature('offer-' + String(offers.length + 1).padStart(3, '0'), 'offer', p(merchant).name + ' · ' + rule,
      p(merchant).region, merchant.geometry, {
        merchantId: merchant.id, merchantName: p(merchant).name, category, status, rule,
        redemptions: monthCounts[currentMonth], redemptionsByMonth: monthCounts,
        ...(monthCounts['2026-10'] > 0 && (category === '酒店民宿' || category === '景区温泉' || category === '餐饮')
          ? { redemptionsByEvent: { [demoFusionEvent]: Math.floor(monthCounts['2026-10'] * .37) } } : {}),
        validFrom, validTo: '2026-12-31', eventId: index < 6 ? upcoming.id : '',
        discount: rule.includes('九折') ? .9 : rule.includes('八折') ? .8 : null,
        color: p(merchant).color,
      }));
  }
}
for (const merchant of merchants) p(merchant).redemptions = p(merchant).redemptionsByMonth[currentMonth];

const localRouteIds = [3, 4, 1, 2, 5, 6, 7];
const outbound = [
  ['钟祥明显陵', [112.61, 31.21], 93, '荆门', 2, '钟祥古城文化与世界遗产'],
  ['漳河风景区', [111.99, 30.93], 97, '荆门', 2, '滨水慢游和湖区休闲'],
  ['武汉东湖', [114.40, 30.56], 135, '湖北', 2, '东湖绿道与城市博物馆'],
  ['宜昌三峡人家', [111.16, 30.83], 165, '湖北', 2, '峡江风光与巴楚民俗'],
  ['襄阳古隆中', [111.96, 31.98], 172, '湖北', 2, '三国文化与襄阳古城'],
];
const routePlans = localRouteIds.map((index, position) => {
  const item = get('routes').find(route => route.id === 'route-tourism-' + index);
  return {
    name: position === 0 ? '网球＋温泉 两日游' : position === 1 ? '网球＋乡村游 一日游' : p(item).name,
    location: p(item).to, geometry: item.geometry, travelMinutes: p(item).travelMinutes,
    itinerary: index === 3
      ? ['第1天：温泉片区晚餐、泡汤并住宿','第2天：上午体验网球，午后游览温泉片区后返程']
      : ['前往' + p(item).to + '游览，体验当地餐饮后返程'],
    days: index === 3 ? 2 : 1, scope: '京山', destinationId: p(item).destinationId,
  };
}).concat(outbound.map(([location, coords, travelMinutes, scope, days, description]) => ({
  name: `赛后游${scope} · ${location}`, location, geometry: point(coords),
  travelMinutes, itinerary: [`第1天：前往${location}`, '第2天：' + description + '、返程'],
  days, scope, destinationId: '',
})));
const routePackages = routePlans.map((route, index) => {
  const available = index !== 9 && index !== 11;
  const monthCounts = Object.fromEntries(months.map((month, monthIndex) => {
    const baseline = [366, 139, 88, 67, 37, 32, 15, 105, 74, 0, 41, 0][index];
    const volume = month === currentMonth ? .64 : month === '2026-10' ? 1.3 : .32 + monthIndex * .071;
    return [month, available ? Math.round(baseline * volume * between(87, 113) / 100) : 0];
  }));
  const merchant = partners.find(item => p(item).sourceId === route.destinationId) ?? joinedOf('酒店民宿')[index];
  const orders = monthCounts[currentMonth];
  const { name, geometry, ...details } = route;
  return feature(`package-${String(index + 1).padStart(2, '0')}`, 'route_package', name, cityRegion, geometry, {
    ...details, status: available ? '已上架' : '待上架', orders, ordersByMonth: monthCounts,
    ...(available ? { ordersByEvent: { [demoFusionEvent]: Math.floor(monthCounts['2026-10'] * .42) } } : {}),
    price: route.days === 1 ? between(98, 188) : between(299, 598),
    visitorCount: Math.round(orders * between(180, 280) / 100), eventId: index < 5 || index === 7 ? upcoming.id : '',
    merchantIds: [merchant.id, joinedOf('餐饮')[index].id], to: route.location,
    color: route.scope === '京山' ? '#ffb14c' : '#46e09d',
  });
});

const monthDays = month => month === currentMonth ? Number(asOf.slice(-2))
  : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(-2)), 0)).getUTCDate();
const venueOperations = [];

const dailyRedemptions = new Map();
for (const month of months) {
  const total = sum(offers, item => p(item).redemptionsByMonth[month]);
  const dates = Array.from({ length: monthDays(month) }, (_, index) => addDays(month + '-01', index));
  const weights = dates.map(date => {
    const day = new Date(date + 'T00:00:00Z').getUTCDay();
    const eventDay = events.some(event => p(event).status === '已办结' && p(event).date <= date && p(event).endDate >= date);
    return (day === 6 || day === 0 ? 1.4 : 1) * (eventDay ? 1.32 : 1);
  });
  const weightTotal = sum(weights, value => value);
  let assigned = 0;
  for (const [index, date] of dates.entries()) {
    const count = index === dates.length - 1 ? total - assigned : Math.floor(total * weights[index] / weightTotal);
    dailyRedemptions.set(date, count);
    assigned += count;
  }
}
const operations = months.map((month, index) => {
  const eventList = events.filter(event => p(event).status === '已办结' && p(event).date.startsWith(month));
  const eventRegistrations = sum(eventList, item => p(item).registered);
  const clinicRegistrations = 0;
  const registrations = eventRegistrations + clinicRegistrations;
  const redemptions = sum(offers, item => p(item).redemptionsByMonth[month]);
  const routeOrders = sum(routePackages, item => p(item).ordersByMonth[month]);
  const attendance = sum(eventList, item => p(item).attendance);
  const monthlyVisitors = sum(eventList, item => p(item).visitors);
  const registeredUsers = 28350 + index * 1710 + Math.round(registrations * .13);
  const activeUsers = Math.min(registeredUsers, Math.round(registrations * .79 + attendance * .42));
  const outOfTownUsers = Math.min(activeUsers, Math.round(activeUsers * .35 + monthlyVisitors * .23));
  const visits = attendance + Math.round(redemptions * 1.25);
  const amount = Math.round(sum(eventList, item => p(item).spend) * 10000 + redemptions * 232 + routeOrders * 480);
  const partition = (number, buckets) => {
    let assigned = 0;
    return Object.fromEntries(buckets.map(([key, share], position) => {
      const value = position === buckets.length - 1 ? number - assigned : Math.floor(number * share);
      assigned += value;
      return [key, value];
    }));
  };
  const consumption = partition(amount, [['住宿', .38], ['餐饮', .27], ['景区温泉', .18], ['购物', .11], ['其他', .06]]);
  const stays = partition(outOfTownUsers, [['1天', .34], ['2–3天', .41], ['4天以上', .25]]);
  const hotspots = partition(amount, [['国际网球中心周边', .42], ['温泉度假区', .27], ['城区文峰片区', .16], ['其他片区', .15]]);
  const observedThrough = month === currentMonth ? asOf : `${month}-${monthDays(month)}`;
  const redemptionsByWeek = Array.from({ length: 5 }, (_, week) => {
    const end = addDays(observedThrough, (week - 4) * 7);
    return sum(Array.from({ length: 7 }, (_, day) => addDays(end, -day)), date => dailyRedemptions.get(date) ?? 0);
  });
  return feature('operations-' + month, 'operations_monthly', month + ' 京网通运行汇总', '京山市', point(cityCenter), {
    month, events: eventList.length, attendance, visits, registrations, eventRegistrations, clinicRegistrations, registeredUsers, activeUsers,
    outOfTownUsers, outOfTownRate: percent(outOfTownUsers, activeUsers), redemptions, routeOrders,
    spend: Math.round(amount / 100) / 100, consumption, stays, hotspots, redemptionsByWeek,
    observedThrough,
  });
});

const taskTemplates = [
  ['公安交警', '交通组织和停车引导', 5],
  ['交通运输局', '接驳班次和车辆调度', 3],
  ['卫健局', '医疗点和救护车', 4],
  ['市场监管局', '场馆周边餐饮巡查', 3],
  ['文旅局', '酒店协调与游客服务', 6],
  ['属地街道', '现场环境和秩序', 5],
  ['网球产业公司', '赛事组织与场馆服务', 6],
];
const eventLive = [open, upcoming].flatMap(event => [0, 1, 2, 3, 6].map(day => {
  const date = addDays(p(event).date, day);
  const simulation = date > asOf;
  const highDay = [0.52, 0.66, 0.76, 0.62, 0.87][[0, 1, 2, 3, 6].indexOf(day)];
  const attendees = Math.round(p(event).attendance * highDay);
  const parkingCapacity = 760 + (day > 0 ? 170 : 0);
  const hotelCapacity = 2300 + (day > 0 ? 120 : 0);
  const parkingOccupied = Math.round(parkingCapacity * Math.min(.98, highDay + .06));
  const hotelOccupied = Math.round(hotelCapacity * Math.min(.98, highDay + .15));
  const dayThree = [5, 3, 4, 2, 5, 4, 4];
  const tasks = taskTemplates.map(([department, title, total], index) => {
    const completed = day >= 6 ? total : Math.min(total, Math.max(0, dayThree[index] + day - 2));
    return { department, title, total, completed, status: completed === total ? '已完成' : completed ? '办理中' : '待接收' };
  });
  const services = [
    { title: '出行和停车提示', detail: '从文峰大道入口到达，按现场引导进入分流停车场。', readCount: Math.round(attendees * .88), status: '已发布' },
    { title: '接驳线路和班次', detail: '赛事停车场、文峰广场至场馆，15分钟一班。', readCount: Math.round(attendees * .63), status: '已发布' },
    { title: '住宿分流提示', detail: '优先推荐温泉片区及可接驳酒店。', readCount: Math.round(attendees * .41), status: '已发布' },
  ];
  const updates = [
    { time: '08:40', department: '网球产业公司', summary: '场馆服务台及观赛导向到位。' },
    { time: '09:10', department: '公安交警', summary: '核心区交通引导正常，启用分流停车区。' },
    { time: '09:35', department: '交通运输局', summary: '接驳车辆已发车，满载时增派临时班次。' },
    { time: '10:25', department: '卫健局', summary: day === 2 ? '现场医疗点处置轻微擦伤1人。' : '现场医疗点正常值守。' },
  ];
  return feature(`live-${event.id}-${date}`, 'event_live', p(event).name + ' · 第' + (day + 1) + '日', p(event).region, event.geometry, {
    eventId: event.id, date, asOf: date + 'T10:30:00+08:00', simulation, day: day + 1,
    attendees, present: Math.round(attendees * .81), parkingOccupied, parkingCapacity, parkingRate: percent(parkingOccupied, parkingCapacity),
    hotelOccupied, hotelCapacity, hotelRate: percent(hotelOccupied, hotelCapacity),
    temporaryParkingLots: day > 0 ? 2 : 1, temporaryParkingRemaining: Math.max(0, parkingCapacity - parkingOccupied),
    shuttleRoutes: 2, shuttleIntervalMinutes: 15, pointsReady: day > 0 ? 7 : 6, pointsTotal: 7,
    incidentCount: day === 2 ? 1 : 0, incidentSummary: day === 2 ? '观赛区游客轻微擦伤，现场已处置' : '未记录安全事件',
    services, updates, tasks,
  });
}));

const eventActuals = events.filter(event => p(event).status === '已办结').map((event, index) => {
  const fields = p(event);
  const forecastAttendance = event.id === open.id ? 5000 : Math.round(fields.attendance * between(87, 112) / 100 / 10) * 10;
  const { parkingGap: forecastParkingGap, lodgingGap: forecastBedGap } = eventAssistance(seed.datasets, event.id, forecastAttendance);
  const tasksTotal = forecastAttendance >= 3500 ? 32 : forecastAttendance >= 1200 ? 22 : 12;
  const source = get('origins').filter(item => p(item).eventId === event.id);
  return feature('actual-' + event.id, 'event_actual', fields.name + ' · 赛后核验', fields.region, event.geometry, {
    eventId: event.id, attendance: fields.attendance, forecastAttendance, visitors: fields.visitors,
    parkingGap: Math.max(0, Math.round(forecastParkingGap * .91) - (index % 4) * 7), forecastParkingGap,
    bedGap: Math.max(0, Math.round(forecastBedGap * .87)), forecastBedGap,
    tasksCompleted: tasksTotal - (index % 6 === 0 || event.id === open.id ? 1 : 0),
    tasksTotal, originCount: sum(source, item => p(item).people ?? 0),
    confirmedAt: addDays(fields.endDate, 2), spend: fields.spend, sourceStatus: '模拟核验',
  });
});

const hotspots=[],needs=[];
dataset('merchants', '合作商家与配套名录', '文旅局', '融合发展', '汇总商家分类、入驻审核、评价及月度票根核销。', merchants);
dataset('offers', '票根优惠及核销', '文旅局', '融合发展', '优惠与商家、适用赛事及核销月份关联。', offers);
dataset('route_packages', '旅游线路与月度订单', '文旅局', '融合发展', '覆盖京山本地、荆门周边及湖北省内三类线路，线位仅作去向示意。', routePackages);
dataset('operations_monthly', '京网通月度运营', '文旅局', '融合发展', '截至2026-11-13的聚合模拟样本，订单、核销和预订可由明细汇总，消费分类单位为元，消费总额单位为万元。', operations);
dataset('venue_operations', '场馆预约与利用率', '网球产业公司', '网球设施', '按场馆及月份汇总预约次数、可用场时、预订场时和基于1200米服务距离的参考人口。', venueOperations);
dataset('event_live', '赛事现场快照与部门任务', '文旅局', '赛事服务', '包含可回放的赛中快照和面向未来赛事的模拟推演，记录时点、交通、食宿、任务和现场反馈。', eventLive);
dataset('event_actuals', '赛后实绩与保障复盘', '文旅局', '赛事服务', '比较已办赛事的预测与模拟核验实绩，关联年度赛历。', eventActuals);
dataset('investment_hotspots', '赛事热区与配套供需', '商务局', '产业推介', '三个主要场馆2公里范围内的配套供需，以现有设施和赛历模拟汇总。', hotspots);
dataset('investment_needs', '招商需求和候选地块', '商务局', '产业推介', '将配套短板、候选地块与模拟审核进度关联。', needs);

await writeFile(new URL('demo-data-v3.json', directory), JSON.stringify(withCourtLedger(seed)), 'utf8');
console.log('V3 demo:', seed.datasets.length, 'datasets,', sum(seed.datasets, item => item.features.length), 'features');
console.log('Surveyed courts:', courts.length);
console.log('Merchants:', merchants.length, 'joined:', partners.length, 'redemptions:', sum(offers, item => p(item).redemptions));
