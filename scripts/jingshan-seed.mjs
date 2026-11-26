import { withCourtLedger } from '../src/jingshan/court-ledger.ts';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const output = new URL('../public/jingshan/', import.meta.url);
const center = [113.112, 31.021];
const regions = [
  { name: '新市街道', code: 'xinshi', center, schoolCount: 4, population: 148000 },
  { name: '永兴街道', code: 'yongxing', center: [113.162, 30.963], schoolCount: 2, population: 38000 },
  { name: '温泉街道', code: 'wenquan', center: [113.122, 30.991], schoolCount: 2, population: 32400 },
  { name: '曹武镇', code: 'caowu', center: [113.305, 30.979], schoolCount: 1, population: 27000 },
  { name: '罗店镇', code: 'luodian', center: [113.419, 31.090], schoolCount: 1, population: 34300 },
  { name: '宋河镇', code: 'songhe', center: [113.286, 31.196], schoolCount: 2, population: 36000 },
  { name: '坪坝镇', code: 'pingba', center: [113.318, 31.313], schoolCount: 1, population: 14200 },
  { name: '三阳镇', code: 'sanyang', center: [113.193, 31.314], schoolCount: 1, population: 15900 },
  { name: '绿林镇', code: 'lvlin', center: [113.085, 31.314], schoolCount: 1, population: 11300 },
  { name: '杨集镇', code: 'yangji', center: [113.004, 31.215], schoolCount: 1, population: 12800 },
  { name: '孙桥镇', code: 'sunqiao', center: [112.986, 31.040], schoolCount: 1, population: 27500 },
  { name: '石龙镇', code: 'shilong', center: [112.846, 31.031], schoolCount: 1, population: 16600 },
  { name: '永漋镇', code: 'yonglong', center: [112.837, 30.792], schoolCount: 1, population: 19900 },
  { name: '雁门口镇', code: 'yanmenkou', center: [112.998, 30.885], schoolCount: 1, population: 26200 },
  { name: '钱场镇', code: 'qianchang', center: [113.101, 30.840], schoolCount: 1, population: 31000 },
];
const regionByName = new Map(regions.map(region => [region.name, region]));
let state = 20261121;

function random() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 4294967296;
}

function integer(min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function offset([longitude, latitude], east, north) {
  return [
    Number((longitude + east / (111320 * Math.cos(latitude * Math.PI / 180))).toFixed(7)),
    Number((latitude + north / 110852).toFixed(7)),
  ];
}

function scatter(origin, inner, outer) {
  const bearing = random() * Math.PI * 2;
  const distance = integer(inner, outer);
  return offset(origin, Math.cos(bearing) * distance, Math.sin(bearing) * distance);
}

function rotate(east, north, angle) {
  return [east * Math.cos(angle) - north * Math.sin(angle), east * Math.sin(angle) + north * Math.cos(angle)];
}

function rectangle(anchor, width, height, angle = 0) {
  const corners = [[-width / 2, -height / 2], [width / 2, -height / 2], [width / 2, height / 2], [-width / 2, height / 2]];
  const ring = corners.map(([east, north]) => offset(anchor, ...rotate(east, north, angle)));
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}

function point(coordinates) {
  return { type: 'Point', coordinates };
}

function line(coordinates) {
  return { type: 'LineString', coordinates };
}

function feature(id, kind, name, region, geometry, properties = {}) {
  return { type: 'Feature', id, geometry, properties: { kind, name, region, ...properties, sample: true } };
}

function dataset(id, name, department, category, description, features) {
  return { id, name, department, category, description: `演示数据。${description}`, features };
}

const schools = [];
const schoolAnchors = [
  offset(center, 1200, 740),
  offset(center, -650, 1260),
  offset(center, 1050, -1250),
  offset(center, 2090, -370),
];
const schoolNames = ['京山一中', '城北实验中学', '文峰小学', '京山职业学校'];
for (const [regionIndex, region] of regions.entries()) {
  for (let index=0;index<region.schoolCount;index++) {
    const code = `${region.code}-${index + 1}`;
    const anchor = regionIndex === 0 ? schoolAnchors[index] : scatter(region.center, 500 + index * 700, 1100 + index * 700);
    const name = regionIndex === 0 ? schoolNames[index] : `${region.name}${index ? '中心小学' : '中心学校'}`;
    const teaching = regionIndex === 0 ? index === 1 || index === 2 : (regionIndex + index) % 4 !== 0;
    const students = regionIndex === 0 ? [3200, 2100, 1280, 1850][index] : integer(440, 1730);
    schools.push(feature(`school-${code}`, 'school', name, region.name, point(anchor), {
      students, teaching, trainees: teaching ? integer(37, 240) : 0,
      coaches: teaching ? integer(1, 5) : 0, status: teaching ? '已开课' : '未开课',
      schoolDistrict: regionIndex === 0 ? ['文峰学区', '新市学区', '温泉学区', '城东学区'][index] : `${region.name}学区`,
      color: teaching ? '#49e699' : '#ffb446',
    }));
  }

}

for (const [index, [name, east, north, students]] of [
  ['城东实验小学', 2950, 520, 1180], ['城东第二中学', 3370, -710, 1730],
  ['城南新区小学', 1430, -3380, 820], ['温泉片区实验学校', -540, -3880, 1060],
  ['永兴第二小学', 4200, -3120, 780],
].entries()) {
  const region = index < 2 ? '新市街道' : index < 4 ? '温泉街道' : '永兴街道';
  schools.push(feature(`school-no-court-${index + 1}`, 'school', name, region, point(offset(center, east, north)), {
    students, teaching: false, trainees: 0, coaches: 0, status: '未开课', color: '#8b9fbf',
    schoolDistrict: index < 2 ? '城东学区' : index < 4 ? '城南学区' : '永兴学区',
  }));
}

const population = [];
const communities = [];
const communityGroups = [
  ['城东片区', '新市街道', 2600, 100, 21000],
  ['城南片区', '温泉街道', 650, -3250, 16000],
  ['环城南路片区', '永兴街道', 3100, -3150, 9000],
  ['文峰社区', '新市街道', -1300, 700, 17100],
  ['城北片区', '新市街道', 120, 1880, 15100],
  ['温泉新城', '温泉街道', 700, -1990, 10400],
];
for (const [index, [name, region, east, north, people]] of communityGroups.entries()) {
  communities.push(feature(`community-${index + 1}`, 'community', name, region, rectangle(offset(center, east, north), 1040, 990, 0.14), {
    population: people, youth: Math.round(people * 0.171), code: `DEMO-JS-${String(index + 1).padStart(3, '0')}`,
    color: '#6495ff',
  }));
}
for (const [regionIndex, region] of regions.entries()) {
  const columns = regionIndex === 0 ? 13 : regionIndex < 3 ? 6 : 4;
  const rows = regionIndex === 0 ? 10 : regionIndex < 3 ? 5 : 4;
  const cell = regionIndex === 0 ? 510 : regionIndex < 3 ? 590 : 850;
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const east = (column - (columns - 1) / 2) * cell;
      const north = (row - (rows - 1) / 2) * cell;
      const weight = integer(22, 135) * (regionIndex === 0 && east > 1500 ? 1.55 : 1);
      cells.push({ row, column, weight, anchor: offset(region.center, east, north) });
    }
  }
  const weightTotal = cells.reduce((sum, item) => sum + item.weight, 0);
  let assigned = 0;
  for (const [index, { row, column, weight, anchor }] of cells.entries()) {
    const people = index === cells.length - 1 ? region.population - assigned : Math.floor(region.population * weight / weightTotal);
    assigned += people;
    population.push(feature(`grid-${region.code}-${row}-${column}`, 'population', `${region.name}人口网格 ${row + 1}–${column + 1}`,
      region.name, rectangle(anchor, cell - 12, cell - 12), {
        population: people, youth: Math.round(people * (integer(14, 24) / 100)), cellSize: cell, count: people,
        color: people > 1200 ? '#ff695e' : people > 650 ? '#ffaf50' : people > 340 ? '#48adee' : '#4679c9',
      }));
  }
}

const events = [];
const eventLevels = ['国际', '全国', '省级', '群众'];
const levelColors = { 国际: '#ff6b5e', 全国: '#ffbe53', 省级: '#3dc9ff', 群众: '#3ee08f' };
function addEvent({ id, name, date, days, stayDays, attendance, visitors, level, status, spend, overnightGuests, scenicVisitors, secondarySpendVisitors, occupancy, players }) {
  const position = center;
  const companions = Math.min(Math.round(attendance * .18), attendance - players);
  events.push(feature(id, 'event', name, '新市街道', point(position), {
    date, days, stayDays: stayDays ?? Math.round(days * 5.5) / 10, attendance, visitors, level, status, spend, overnightGuests,
    nights: Math.round(overnightGuests * (days > 3 ? 1.32 : 1.17)), scenicVisitors, secondarySpendVisitors,
    players, companions, spectators: attendance - players - companions, occupancy, color: levelColors[level],
  }));
}
const competitionNames = ['全民网球积分赛', '青少年网球分级赛', '网球城市邀请赛', '网球俱乐部联赛', '中学生网球交流赛', '职工网球赛'];
for (let month = 1; month <= 12; month++) {
  for (let index = 0; index < 2 + (month % 3 === 0 ? 1 : 0); index++) {
    const day = 3 + index * 4;
    if (month === 12 || (month === 11 && day > 7)) continue;
    const level = eventLevels[month % 4 === 0 ? (index % 2) + 1 : 2 + (index % 2)];
    const attendance = level === '全国' ? integer(1350, 2650) : level === '省级' ? integer(450, 1400) : integer(110, 510);
    const visitors = Math.round(attendance * (level === '全国' ? .72 : level === '省级' ? .50 : .23));
    const overnightGuests = Math.round(visitors * .62);
    addEvent({
      id: `event-2026-${month}-${day}`, name: `${month}月${competitionNames[(month + index) % competitionNames.length]}`,
      date: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      days: level === '全国' ? 4 : 2, attendance, visitors, level, status: '已办结',
      spend: Math.round(attendance * (level === '群众' ? .082 : .146)),
      overnightGuests, scenicVisitors: Math.round(attendance * integer(14, 34) / 100),
      secondarySpendVisitors: Math.round(attendance * integer(9, 13) / 100), players: Math.round(attendance * .22),
      occupancy: [integer(45, 57), integer(52, 61), integer(76, 95), integer(60, 74), integer(49, 59)],
    });
  }
}
addEvent({
  id: 'event-20261012-open', name: '京山网球公开赛', date: '2026-10-12', days: 7, stayDays: 2.6, attendance: 5200, visitors: 3952,
  level: '全国', status: '已办结', spend: 860, overnightGuests: 3100,
  scenicVisitors: 1150, secondarySpendVisitors: 640, occupancy: [52, 57, 91, 70, 55], players: 620,
});
addEvent({
  id: 'event-20261214-youth-tour', name: '国际青少年网球巡回赛', date: '2026-12-14', days: 7, attendance: 4800, visitors: 3840,
  level: '国际', status: '待举办', spend: 0, overnightGuests: 2900,
  scenicVisitors: 0, secondarySpendVisitors: 0, occupancy: [], players: 600,
});
addEvent({
  id: 'event-20261226-town-finals', name: '京山市乡镇网球年终联赛', date: '2026-12-26', days: 2, attendance: 560, visitors: 125,
  level: '群众', status: '待举办', spend: 0, overnightGuests: 68,
  scenicVisitors: 0, secondarySpendVisitors: 0, occupancy: [], players: 192,
});
events.sort((a, b) => a.properties.date.localeCompare(b.properties.date));

const hotels = [];
const hotelNames = ['文峰花园酒店', '网球运动酒店', '城中商务酒店', '湖畔精品酒店', '文旅迎宾馆', '京源度假酒店', '城市便捷客栈', '温泉运动民宿'];
for (let index = 0; index < 42; index++) {
  const region = index < 27 ? regions[0] : index < 36 ? regions[2] : regions[(index - 31) % regions.length];
  const anchor = index < 28 ? scatter(center, 290 + index * 66, 1250 + index * 78) : scatter(region.center, 310, 4100);
  const beds = index < 8 ? [420, 380, 330, 290, 255, 230, 205, 185][index] : integer(24, 160);
  const available = Math.round(beds * integer(64, 94) / 100);
  hotels.push(feature(`hotel-${index + 1}`, 'hotel', hotelNames[index] ?? `${region.name}主题客栈 ${index + 1}`, region.name, point(anchor), {
    beds, available, rooms: Math.ceil(beds / 1.7), type: index < 9 ? '酒店' : '民宿', price: integer(138, 568),
    status: index < 8 ? '已对接' : '备选', color: index < 8 ? '#ffd566' : '#89a5bd',
    shuttle: index % 3 === 0, count: available,
  }));
}

const parking = [];
for (let index = 0; index < 17; index++) {
  const region = index < 12 ? regions[0] : regions[index - 11];
  const anchor = scatter(index < 12 ? center : region.center, 220 + index * 72, 800 + index * 220);
  const spaces = index < 8 ? [128, 176, 164, 96, 108, 88, 240, 180][index] : integer(34, 210);
  parking.push(feature(`parking-${index + 1}`, 'parking', `${region.name}${index < 6 ? '赛事' : '公共'}停车场 ${index + 1}`, region.name,
    point(anchor), {
      spaces, available: Math.round(spaces * integer(63, 94) / 100), accessible: Math.ceil(spaces * .032),
      charging: Math.ceil(spaces * .081), temporary: index === 5 || index === 6, shuttle: index % 3 === 0, color: '#479aff',
    }));
}

function nearbyPointFeatures(items, anchor, radius) {
  const radians = Math.PI / 180;
  return items.filter(item => {
    const [longitude, latitude] = item.geometry.coordinates;
    const east = (longitude - anchor[0]) * 6371008.8 * radians * Math.cos(anchor[1] * radians);
    const north = (latitude - anchor[1]) * 6371008.8 * radians;
    return Math.hypot(east, north) <= radius;
  });
}

function distributeSupply(items, key, total) {
  const original = items.reduce((sum, item) => sum + item.properties[key], 0);
  let running = 0;
  let assigned = 0;
  for (const item of items) {
    running += item.properties[key];
    const cumulative = Math.round(running * total / original);
    item.properties[key] = cumulative - assigned;
    assigned = cumulative;
  }
}

const tournamentVenue = center;
const nearHotels = nearbyPointFeatures(hotels, tournamentVenue, 3000);
distributeSupply(nearHotels, 'available', 2300);
for (const hotel of nearHotels) hotel.properties.count = hotel.properties.available;
const nearParking = nearbyPointFeatures(parking, tournamentVenue, 2000);
distributeSupply(nearParking, 'spaces', 760);
for (const { properties: item } of nearParking) {
  item.available = Math.round(item.spaces * .82);
  item.accessible = Math.ceil(item.spaces * .032);
  item.charging = Math.ceil(item.spaces * .081);
}

const medical = Array.from({ length: 19 }, (_, index) => {
  const region = index < 5 ? regions[0] : regions[index - 4];
  const anchor = index === 0 ? offset(center, 1640, -520) : scatter(region.center, 290, index < 5 ? 4100 : 2200);
  return feature(`medical-${index + 1}`, 'medical', index === 0 ? '京山市中心医院（演示点）'
    : `${region.name}${index < 5 ? '赛事医疗保障点' : '卫生服务中心'}`, region.name, point(anchor), {
    minutes: index < 5 ? [8, 11, 5, 9, 15][index] : integer(18, 63),
    level: index === 0 ? '二级综合' : index < 5 ? '赛事医疗点' : '社区医疗',
    ambulances: index < 4 ? (index === 0 ? 3 : 1) : index % 2, beds: index === 0 ? 500 : integer(12, 80),
    emergency: index % 5 !== 4, color: '#ff666f',
  });
});

const attractionSeeds = [
  ['绿林山景区', '绿林镇', [113.094, 31.289], 12, 620, 50, '森林体验'],
  ['空山洞景区', '新市街道', [113.059, 31.019], 8, 416, 24, '地质游览'],
  ['温泉度假区', '温泉街道', [113.128, 30.990], 31, 1612, 15, '温泉休闲'],
  ['三阳乡村游片区', '三阳镇', [113.201, 31.315], 4, 208, 62, '乡村体验'],
  ['文峰运动公园', '新市街道', [113.098, 31.025], 16, 832, 10, '城市运动'],
  ['惠亭湖生态休闲区', '新市街道', [113.074, 31.008], 11, 572, 22, '湖畔休闲'],
  ['孙桥乡村运动驿站', '孙桥镇', [112.993, 31.039], 7, 364, 30, '乡村体验'],
  ['杨集山地运动片区', '杨集镇', [113.012, 31.205], 5, 260, 54, '森林体验'],
  ['钱场农旅体验区', '钱场镇', [113.106, 30.849], 3, 156, 42, '农旅体验'],
  ['永兴亲子休闲驿站', '永兴街道', [113.172, 30.959], 4, 208, 28, '亲子游览'],
  ['宋河古镇漫游片区', '宋河镇', [113.288, 31.197], 6, 312, 47, '人文体验'],
  ['雁门口滨水休闲地', '雁门口镇', [112.996, 30.886], 2, 104, 46, '滨水游览'],
];
const tourism = attractionSeeds.map(([name, region, anchor, conversion, visits, travelMinutes, type], index) =>
  feature(`tourism-${index + 1}`, 'tourism', name, region, point(anchor), {
    conversion, visits, travelMinutes, type, capacity: integer(400, 6500), recommended: index < 5, color: '#41e2a5',
  }));

const routes = tourism.map((item, index) => feature(`route-tourism-${index + 1}`, 'route', `网球＋${item.properties.name}${index === 2 ? '两日游' : '一日游'}`,
  item.properties.region, item.geometry, {
    to: item.properties.name, destinationId: item.id, travelMinutes: item.properties.travelMinutes,
    conversion: item.properties.conversion, itinerary: [index === 2 ? '两日游' : '一日游', '赛事观赛', item.properties.name],
    status: index < 2 ? '推荐' : '备选', color: '#ffbd4d',
  }));

const origins = [];
const sourceCities = [
  ['武汉', [114.30, 30.60], 38], ['省外', [114.0, 29.8], 21], ['荆门', [112.20, 31.04], 12],
  ['襄阳', [112.14, 32.05], 9], ['宜昌', [111.29, 30.69], 6], ['其他', [113.15, 30.05], 14],
];
for (const event of events.filter(item => item.properties.status === '已办结')) {
  for (const [index, [city, anchor, share]] of sourceCities.entries()) {
    origins.push(feature(`origin-${event.id}-${index + 1}`, 'origin', `${city} · ${share}%`, event.properties.region,
      point(anchor), {
        eventId: event.id, from: city, share, people: Math.round(event.properties.attendance * share / 100),
        count: share, color: '#38d4ff',
      }));
  }
}

const training = Array.from({ length: 19 }, (_, index) => {
  const region = index < 7 ? regions[0] : regions[index - 6];
  return feature(`training-${index + 1}`, 'training', `${region.name}${['青训中心', '网球培训工作室', '青少年训练营'][index % 3]} ${index + 1}`,
    region.name, point(scatter(region.center, 480, index < 7 ? 3800 : 2300)), {
      trainees: integer(38, 240), coaches: integer(2, 8), level: index % 4 === 0 ? '进阶' : '启蒙',
      capacity: integer(95, 280), color: '#c58bfa',
    });
});

const learners = [];
const learnerTotals = [1030, 346, 318, 118, 150, 204, 75, 63, 67, 82, 140, 117, 104, 140, 146];
for (const [index, region] of regions.entries()) {
  const amount = learnerTotals[index];
  const totalCells = index === 0 ? 16 : 5;
  let allocated = 0;
  for (let cell = 0; cell < totalCells; cell++) {
    const trainees = cell === totalCells - 1 ? amount - allocated : Math.floor(amount / totalCells);
    allocated += trainees;
    const anchor = scatter(region.center, 280 + cell * 90, 1150 + cell * 170);
    const age6to9 = Math.round(trainees * .38);
    const age10to12 = Math.round(trainees * .34);
    const age13to15 = Math.round(trainees * .20);
    learners.push(feature(`learner-${region.code}-${cell + 1}`, 'learners', `${region.name}青训统计格 ${cell + 1}`, region.name,
      rectangle(anchor, 340, 340), {
        trainees, players: Math.round(trainees * .456), coaches: cell === 0 ? (index === 0 ? 18 : 4 + index % 3) : 0,
        age6to9, age10to12, age13to15, age16to18: trainees - age6to9 - age10to12 - age13to15,
        schoolDistrict: `${region.name}学区`, count: trainees, color: '#41dfa9',
      }));
  }
}

const businesses = [];
const businessCategories = [
  ['上游', '场地建设', 4, '#5aaaff'], ['上游', '器材制造', 3, '#5aaaff'], ['上游', '研发测试', 2, '#5aaaff'],
  ['中游', '俱乐部', 28, '#3cdb94'], ['中游', '培训机构', 19, '#3cdb94'], ['中游', '场馆运营', 14, '#3cdb94'], ['中游', '赛事运营', 12, '#3cdb94'],
  ['下游', '住宿餐饮', 96, '#ffb54b'], ['下游', '文旅', 22, '#ffb54b'], ['下游', '传媒', 9, '#ffb54b'], ['下游', '运动康复', 3, '#ffb54b'],
];
const zoneSequence = [0, 0, 0, 0, 0, 1, 1, 2, 2, 5, 4, 3, 10, 12, 13, 14, 9, 8, 7, 6, 11];
for (const [segment, subtype, count, color] of businessCategories) {
  for (let index = 0; index < count; index++) {
    const sequence = businesses.length;
    const region = regions[zoneSequence[sequence % zoneSequence.length]];
    const type = segment === '上游' || ['赛事运营', '场馆运营', '传媒', '运动康复'].includes(subtype) ? '网球企业' : subtype;
    businesses.push(feature(`business-${sequence + 1}`, 'business', `${region.name}${subtype}示范主体 ${index + 1}`,
      region.name, point(scatter(region.center, 280, region === regions[0] ? 4800 : 3150)), {
        segment, subtype, type, employees: integer(4, 130), revenue: integer(55, 1300),
        status: index % 11 === 10 ? '筹备' : '在营', color,
      }));
  }
}

const constraints = [
  feature('constraint-farmland-1', 'constraint', '环城南路基本农田样区', '新市街道', rectangle(offset(center, 2650, -2080), 1320, 1340, -0.25),
    { constraint: '永久基本农田', color: '#ffcf55', severity: '禁止' }),
  feature('constraint-ecology-1', 'constraint', '惠亭湖生态保护样区', '新市街道', rectangle(offset(center, -3140, -2060), 1830, 1430, 0.32),
    { constraint: '生态保护红线', color: '#3fdfa0', severity: '禁止' }),
  feature('constraint-development-1', 'constraint', '主城区城镇开发边界样区', '新市街道', rectangle(offset(center, 210, -360), 7950, 6750, 0.08),
    { constraint: '城镇开发边界', color: '#b58aff', severity: '条件' }),
];
for (const region of regions.slice(1)) {
  for (const [index, [name, color, east, north]] of [
    ['永久基本农田', '#ffcf55', 1750, -1620], ['生态保护红线', '#3fdfa0', -1850, 1680], ['城镇开发边界', '#b58aff', 0, 0],
  ].entries()) {
    constraints.push(feature(`constraint-${region.code}-${index}`, 'constraint', `${region.name}${name}样区`, region.name,
      rectangle(offset(region.center, east, north), index === 2 ? 4800 : 1280, index === 2 ? 4400 : 830, 0.12), {
        constraint: name, color, severity: index === 2 ? '条件' : '禁止',
      }));
  }
}

const parcels = [];
const parcelSeeds = [
  ['parcel-a', '文峰东路地块', '新市街道', offset(center, 2640, 180), 2100, '国有储备', '公园绿地', true, '空闲地'],
  ['parcel-b', '城东储备地块', '新市街道', offset(center, 3170, -380), 1500, '国有储备', '体育用地', true, '空闲地'],
  ['parcel-c', '环城南路地块', '新市街道', offset(center, 2690, -2110), 2400, '集体', '农业用地', true, '耕地'],
  ['parcel-d', '惠亭湖西侧地块', '新市街道', offset(center, -3140, -2000), 2020, '集体', '生态绿地', false, '生态地'],
  ['parcel-e', '温泉新城储备地块', '温泉街道', offset(center, 410, -3390), 2840, '国有储备', '商服用地', true, '储备地'],
  ['parcel-f', '文峰北路教育地块', '新市街道', offset(center, 1690, 1190), 2960, '国有储备', '教育用地', true, '储备地'],
  ['parcel-g', '东部运动产业用地', '新市街道', offset(center, 4300, 300), 6400, '集体', '体育用地', false, '空闲地'],
];
for (const [id, name, region, anchor, area, ownership, use, roadAccess, status] of parcelSeeds) {
  const width = Math.sqrt(area * 1.42);
  parcels.push(feature(id, 'parcel', name, region, rectangle(anchor, width, area / width, 0.22), {
    area, ownership, use, landUse: use, status, roadAccess, color: '#48dc9e', count: Math.floor(area / 670),
  }));
}
for (const region of regions.slice(1)) {
  for (let index = 0; index < 2; index++) {
    const area = integer(1250, 4600);
    const width = Math.sqrt(area * 1.32);
    parcels.push(feature(`parcel-${region.code}-${index + 1}`, 'parcel', `${region.name}${index ? '闲置运动地块' : '便民储备用地'}`, region.name,
      rectangle(scatter(region.center, 800, 2400), width, area / width, 0.11), {
        area, ownership: index ? '集体' : '国有储备', use: index ? '公共服务用地' : '体育用地',
        landUse: index ? '公共服务用地' : '体育用地', status: index ? '空闲地' : '储备地', roadAccess: index === 0,
        color: '#48dc9e', count: Math.floor(area / 670),
      }));
  }
}

const projectSeeds = [
  ['网球训练基地二期', '新市街道', '在建', 65, 2400, 'parcel-a'],
  ['网球数字产业园', '新市街道', '在建', 80, 9800, 'parcel-b'],
  ['青少年网球学院', '新市街道', '规划', 15, 4300, 'parcel-f'],
  ['网球主题酒店', '温泉街道', '在谈', 5, 5200, 'parcel-e'],
  ['温泉运动康养中心', '温泉街道', '在建', 45, 6200, 'parcel-wenquan-1'],
  ['文峰便民网球场增建', '新市街道', '在建', 38, 1900, 'parcel-g'],
  ['宋河网球体验公园', '宋河镇', '规划', 18, 1400, 'parcel-songhe-1'],
  ['罗店全民运动中心', '罗店镇', '规划', 12, 1750, 'parcel-luodian-1'],
  ['钱场文旅融合配套', '钱场镇', '在谈', 6, 2400, 'parcel-qianchang-1'],
  ['绿林网球露营驿站', '绿林镇', '在谈', 4, 1830, 'parcel-lvlin-1'],
  ['雁门口青少年研学基地', '雁门口镇', '在谈', 8, 2370, 'parcel-yanmenkou-1'],
  ['杨集赛事设备服务站', '杨集镇', '在谈', 3, 1330, 'parcel-yangji-1'],
];
const projects = projectSeeds.map(([name, region, status, progress, investment, parcelId], index) => {
  const parcel = parcels.find(item => item.id === parcelId);
  return feature(`project-${index + 1}`, 'project', name, region, parcel.geometry, {
    progress, status, investment, parcelId, responsibility: index % 2 === 0 ? '发改局' : '网球产业公司',
    color: status === '在建' ? '#ffb448' : status === '规划' ? '#49beff' : '#c68afd',
  });
});

const transport = [];
for (const [index, [name, legs, level]] of [
  ['文峰大道', [[-4130, 450], [-2450, 290], [-1000, 150], [50, -120], [1750, -120], [3440, 160]], '主干路'],
  ['京源大道', [[-3300, 1170], [-1720, 920], [-500, 480], [680, 220], [1990, 570], [4370, 700]], '主干路'],
  ['沿河西路', [[-3600, -1860], [-2480, -1430], [-1000, -1610], [560, -1850], [2110, -1740], [4210, -1360]], '次干路'],
  ['温泉路', [[1540, 2380], [1060, 1250], [920, 600], [830, -500], [1180, -1800], [1450, -4350]], '主干路'],
  ['轻机大道', [[-1650, 2940], [-1020, 1480], [-440, 510], [-120, -550], [-420, -2220], [-190, -4220]], '主干路'],
  ['场馆北支路', [[-890, 560], [-340, 390], [120, 340], [790, 410], [1550, 700]], '支路'],
  ['场馆南支路', [[-940, -570], [-440, -420], [160, -380], [710, -480], [1340, -660]], '支路'],
  ['赛事接驳环线', [[-1940, -1300], [-1180, -650], [-480, 410], [140, 390], [960, 730], [1360, 1420]], '公交'],
  ['城市东环路', [[3090, -2850], [2830, -1300], [2810, 700], [3010, 2100], [3850, 3500]], '主干路'],
].entries()) {
  transport.push(feature(`transport-city-${index + 1}`, 'transport', name, '新市街道',
    line(legs.map(([east, north]) => offset(center, east, north))), {
      level, roadClass: level, lanes: level === '主干路' ? 4 : 2, speed: level === '主干路' ? 50 : 30,
      category: level === '公交' ? '公交线路' : '道路', color: level === '公交' ? '#7ce6ad' : '#5693b9',
    }));
}
for (const region of regions.slice(1)) {
  transport.push(feature(`transport-${region.code}`, 'transport', `${region.name}城区连接线`, region.name,
    line([offset(region.center, -1800, -650), offset(region.center, -700, 220), region.center, offset(region.center, 1890, 740)]),
    { level: '次干路', roadClass: '次干路', lanes: 2, speed: 40, category: '道路', color: '#5693b9' }));
}

function regionalPoints({ length, kind, title, props, style, inner = 320, outer = 2800 }) {
  return Array.from({ length }, (_, index) => {
    const region = regions[index < Math.ceil(length / 2) ? 0 : 1 + (index % (regions.length - 1))];
    const anchor = scatter(region.center, inner, outer);
    return feature(`${kind}-${index + 1}`, kind, title(region, index), region.name,
      point(anchor), { ...props(index, region), color: style });
  });
}

const food = regionalPoints({
  length: 46, kind: 'food', title: (region, index) => `${region.name}特色餐饮 ${index + 1}`,
  props: index => {
    const seats = integer(35, 320);
    return { seats, capacity: seats, grade: ['A', 'A', 'B', 'C'][index % 4], cuisine: ['鄂菜', '简餐', '乡土菜', '轻食'][index % 4] };
  },
  style: '#ffbc68',
});
const emergency = regionalPoints({
  length: 19, kind: 'emergency', title: (region, index) => `${region.name}${index % 2 ? '应急储备点' : '应急避难场所'}`,
  props: index => ({ capacity: integer(180, 2200), category: index % 2 ? '应急物资储备' : '避难场所', available: true }),
  style: '#44d6ad',
});
const security = regionalPoints({
  length: 21, kind: 'security', title: (region, index) => `${region.name}${['警务站', '消防救援点', '赛事秩序岗'][index % 3]} ${index + 1}`,
  props: index => ({ personnel: integer(4, 28), category: ['警务', '消防', '赛事秩序'][index % 3], minutes: integer(5, 23) }),
  style: '#7a9afe',
});
const portals = [
  ['京山站', '新市街道', [113.117, 31.028], '铁路'],
  ['武荆高速京山出入口', '永兴街道', [113.181, 30.954], '高速'],
  ['京山汽车客运中心', '新市街道', [113.103, 31.024], '客运'],
  ['钱场高速连接点', '钱场镇', [113.096, 30.842], '高速'],
].map(([name, region, anchor, type], index) => feature(`portal-${index + 1}`, 'portal', name, region, point(anchor), {
  type, capacityPerHour: integer(260, 1800), color: '#5ad7ff',
}));
const transit = regionalPoints({
  length: 28, kind: 'transit', title: (region, index) => `${region.name}公交站 ${index + 1}`,
  props: index => ({ lines: [`京山 ${index % 8 + 1} 路`, `京山 ${index % 5 + 9} 路`], shelter: index % 4 !== 0 }),
  style: '#52b5e9',
});
const addresses = communities.map((community, index) => feature(`address-${index + 1}`, 'address',
  `${community.properties.name}标准地址样例`, community.properties.region,
  point(offset(center, communityGroups[index][2], communityGroups[index][3])),
  { communityId: community.id, population: community.properties.population, address: `演示社区地址 ${index + 1} 号`, color: '#6f98e9' }));

const datasets = [
  dataset('events', '年度赛历', '网球产业公司', '网球专题', '本年度赛事及参赛、住宿和消费统计。', events),
  dataset('population', '实有人口分布', '政数局', '人口地址', '按行政区加总的模拟人口和青少年网格。', population),
  dataset('communities', '社区统计单元', '政数局', '人口地址', '城区社区统计范围及模拟人口。', communities),
  dataset('addresses', '标准地址与小区', '公安局', '人口地址', '示例社区地址，不含个人信息。', addresses),
  dataset('parcels', '储备和闲置地块', '自然资源和规划局', '国土空间', '候选地块面积、权属、规划用途和临路条件。', parcels),
  dataset('constraints', '三区三线样区', '自然资源和规划局', '国土空间', '模拟基本农田、生态红线和开发边界，用于演示空间核查。', constraints),
  dataset('transport', '道路和赛事接驳线路', '交通运输局', '交通保障', '城市道路等级、车道和公交线路。', transport),
  dataset('transit', '公交站点', '交通运输局', '交通保障', '镇街公交站与示例线路。', transit),
  dataset('portals', '对外交通门户', '交通运输局', '交通保障', '高速、铁路与客运到达点。', portals),
  dataset('parking', '停车场和接驳点', '公安交警', '交通保障', '停车泊位、余量及接驳能力。', parking),
  dataset('medical', '医疗机构和急救站', '卫健局', '保障资源', '医疗点、出动时长、救护车与床位。', medical),
  dataset('emergency', '避难场所和应急储备', '应急管理局', '保障资源', '应急物资与避难资源模拟点位。', emergency),
  dataset('security', '警务与消防保障点', '公安局', '保障资源', '警务、消防和赛事秩序岗位模拟点位。', security),
  dataset('hotels', '酒店民宿', '文旅局', '文旅消费', '住宿床位、可用余量和接驳信息。', hotels),
  dataset('food', '餐饮与食品安全', '市场监管局', '文旅消费', '餐饮座位与模拟食品安全等级。', food),
  dataset('tourism', '景区和温泉', '文旅局', '文旅消费', '景区容量、到访量、赛事转化率和车程。', tourism),
  dataset('routes', '赛事主题旅游线路', '文旅局', '文旅消费', '从主场馆到景区的模拟联动线路。', routes),
  dataset('origins', '赛事客源地分布', '商务局', '文旅消费', '已办赛事客源地区与占比，按赛事标识关联。', origins),
  dataset('businesses', '网球产业经营主体', '商务局', '网球产业', '经营主体、上下游细分行业和经营状态。', businesses),
  dataset('projects', '网球产业重点项目', '发改局', '网球产业', '项目进度、投资规模和候选地块关联。', projects),
  dataset('schools', '学校和校园网球', '教育局', '教育人才', '学校人数、校内网球场、教学状态及教练数量。', schools),
  dataset('training', '培训机构', '网球产业公司', '教育人才', '机构青训能力、教练与学员数量。', training),
  dataset('learners', '青少年选手和学员分布', '网球产业公司', '教育人才', '按网格聚合的学员年龄、选手和教练数据，不含个人信息。', learners),
];

const featureIds = datasets.flatMap(layer => layer.features.map(item => item.id));
if (featureIds.length !== new Set(featureIds).size) throw new Error('Invalid seed counts or duplicated feature IDs');
if (!datasets.every(layer => layer.features.every(item => regionByName.has(item.properties.region)))) throw new Error('Invalid region in generated seed');

await mkdir(output, { recursive: true });
const source=JSON.parse(await readFile(new URL('../server/resource-sources/tennis1124.json',import.meta.url),'utf8'));
await writeFile(new URL('demo-data.json', output), JSON.stringify(withCourtLedger({datasets},source)) + '\n', 'utf8');
console.log(`Generated ${datasets.length} datasets, ${featureIds.length} features, ${source.features.length} surveyed court polygons.`);
