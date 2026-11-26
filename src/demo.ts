export interface MapProject {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
  status: 'new' | 'ongoing' | 'reserve' | 'statistics';
  industryId: string;
  city: string;
  description: string;
  date: string;
}

export interface Industry {
  id: string;
  name: string;
  scale: string;
  percentage: number;
  leader: string;
  agency: string;
  color: string;
  active: number;
  reserve: number;
}

export const industries: Industry[] = [
  { id: 'automotive', name: '汽车制造', scale: '6204.6亿', percentage: 15.61, leader: '诸葛宇杰', agency: '省经信厅', color: '#478cff', active: 296, reserve: 86 },
  { id: 'chemistry', name: '现代化工', scale: '5850.9亿', percentage: 14.72, leader: '黎东辉', agency: '省经信厅', color: '#22d4a5', active: 183, reserve: 72 },
  { id: 'metallurgy', name: '低碳冶金', scale: '4392.7亿', percentage: 11.05, leader: '陈平', agency: '省经信厅', color: '#39c5f2', active: 108, reserve: 38 },
  { id: 'opto', name: '光电子信息（含6G）', scale: '11000亿', percentage: 27.68, leader: '黎东辉', agency: '省经信厅', color: '#ffca17', active: 557, reserve: 110 },
  { id: 'chips', name: '集成电路', scale: '3,200亿', percentage: 8.05, leader: '张文兵', agency: '省发改委', color: '#9593ff', active: 146, reserve: 48 },
  { id: 'ai', name: '人工智能（含具身智能）', scale: '1,620亿', percentage: 4.08, leader: '张文兵', agency: '省发改委', color: '#25d7c6', active: 94, reserve: 31 },
  { id: 'bio', name: '生物医药及高端医疗器械', scale: '1,535亿', percentage: 3.86, leader: '陈平', agency: '省经信厅', color: '#39bdfa', active: 122, reserve: 53 },
  { id: 'energy', name: '新能源与储能', scale: '1,450亿', percentage: 3.65, leader: '—', agency: '省发改委', color: '#46d5a8', active: 84, reserve: 26 },
  { id: 'materials', name: '先进材料', scale: '1,211亿', percentage: 3.05, leader: '—', agency: '省经信厅', color: '#81a9ff', active: 67, reserve: 28 },
  { id: 'equipment', name: '高端装备制造', scale: '1,078亿', percentage: 2.71, leader: '—', agency: '省经信厅', color: '#52c8ff', active: 101, reserve: 34 },
  { id: 'aero', name: '商业航天', scale: '860亿', percentage: 2.16, leader: '—', agency: '省发改委', color: '#af98ff', active: 35, reserve: 21 },
  { id: 'food', name: '现代食品', scale: '712亿', percentage: 1.79, leader: '—', agency: '省经信厅', color: '#efb361', active: 87, reserve: 19 },
  { id: 'textiles', name: '纺织服装', scale: '650亿', percentage: 1.64, leader: '—', agency: '省经信厅', color: '#53ddc1', active: 46, reserve: 17 },
];

export const statusLabels: Record<MapProject['status'], string> = {
  new: '新建项目',
  ongoing: '续建项目',
  statistics: '统计局来源项目',
  reserve: '储备项目',
};

export const statusColors: Record<MapProject['status'], string> = {
  new: '#f74b50',
  ongoing: '#30cda0',
  statistics: '#edb91b',
  reserve: '#ffd52c',
};

type ProjectSeed = [
  name: string,
  longitude: number,
  latitude: number,
  city: string,
  status: MapProject['status'],
  description?: string,
];

const featuredOptoProjects: ProjectSeed[] = [
  ['宏和高性能电子材料产业园项目', 115.08, 30.29, '黄石市', 'new', '员工停车位需求正在协调，拟统筹租用厂房对面的场地。园区道路与周边停车配套同步推进。'],
  ['赤壁市表面处理产业园项目', 113.90, 29.76, '咸宁市', 'new', '项目正在协调施工款结算与现场进场条件，相关单位同步完善用地和建设手续。'],
  ['烽火通信多模和特种光纤产业智能制造项目', 114.62, 30.46, '武汉市', 'new', '项目外接电力用电方案正在办理，主用线路和备用线路同步推进。'],
  ['MEMS时钟器件工艺设备升级改造项目', 113.39, 31.73, '随州市', 'ongoing', '正在实施时钟器件产线工艺升级，安排关键设备安装和调试。'],
  ['盛蓝国际智算科技及通信产业基地', 113.84, 30.92, '孝感市', 'new'],
  ['孝感高新区光电子信息产业园及配套项目', 114.10, 30.88, '孝感市', 'reserve'],
  ['半导体设备生产项目二期', 113.88, 30.52, '武汉市', 'new'],
  ['静电卡盘配套工程项目', 113.90, 30.35, '武汉市', 'ongoing'],
  ['江城实验室二期', 114.36, 30.23, '武汉市', 'new'],
  ['碳纳米管导电新材料产业化项目', 115.18, 30.72, '黄冈市', 'reserve'],
  ['维达力四期项目', 114.04, 29.90, '咸宁市', 'new'],
  ['德玛克半导体设备及关键零部件项目', 114.76, 30.40, '鄂州市', 'new'],
  ['博雅新材料光学总部项目', 114.76, 30.15, '咸宁市', 'ongoing'],
  ['沪士电子高层高密度互连积层板扩产项目', 114.91, 30.08, '黄石市', 'ongoing'],
  ['先达预制棒制造技术研发与产业化项目', 113.26, 30.63, '天门市', 'new'],
  ['健鼎电子五、六厂房及配套生产设施项目', 113.77, 30.24, '仙桃市', 'new'],
  ['湖北元通电气装备制造项目', 113.40, 31.55, '随州市', 'new'],
  ['湖北高纯纳米晶电子材料建设项目', 112.57, 30.91, '荆门市', 'new'],
  ['东鑫FPC柔性线路板生产项目', 112.58, 30.80, '荆门市', 'new'],
  ['康宁前段产线设备升级项目', 113.98, 30.72, '武汉市', 'reserve'],
  ['光谷高速光模块研发制造项目', 114.52, 30.56, '武汉市', 'statistics'],
  ['精密光学元器件产业化基地', 115.14, 31.07, '黄冈市', 'reserve'],
  ['先进传感器与封装技术中试基地', 112.96, 31.06, '荆门市', 'reserve'],
  ['高端光通信器件产业园', 112.46, 31.50, '荆门市', 'reserve'],
  ['新一代算力网络设备储备项目', 113.73, 31.41, '孝感市', 'reserve'],
  ['智能终端关键组件扩产项目', 114.52, 31.16, '黄冈市', 'statistics'],
  ['光电显示基板技术改造项目', 114.34, 30.73, '武汉市', 'reserve'],
];

type Cluster = { city: string; longitude: number; latitude: number; count: number; spread: number };

const optoClusters: Cluster[] = [
  { city: '武汉市', longitude: 114.40, latitude: 30.50, count: 14, spread: 0.16 },
  { city: '鄂州市', longitude: 114.77, latitude: 30.49, count: 5, spread: 0.11 },
  { city: '黄石市', longitude: 115.04, latitude: 30.25, count: 6, spread: 0.14 },
  { city: '孝感市', longitude: 113.91, latitude: 30.93, count: 6, spread: 0.17 },
  { city: '荆门市', longitude: 112.55, latitude: 30.89, count: 4, spread: 0.17 },
  { city: '天门市', longitude: 113.17, latitude: 30.65, count: 4, spread: 0.19 },
  { city: '随州市', longitude: 113.37, latitude: 31.64, count: 3, spread: 0.12 },
  { city: '咸宁市', longitude: 114.28, latitude: 29.91, count: 4, spread: 0.14 },
  { city: '黄冈市', longitude: 114.97, latitude: 30.69, count: 4, spread: 0.19 },
];

const optoFacilities = [
  '光纤预制棒产线项目',
  '先进光电封装中试项目',
  '光芯片材料产业基地',
  '智能光学检测设备项目',
  '高速光模块生产项目',
  '新型显示材料项目',
  '光电传感器研发中心',
  '电子元器件配套基地',
  '光通信终端制造项目',
  '下一代网络设备扩建项目',
  '光学玻璃深加工项目',
  '光电实验室配套工程',
  '工业激光设备产业化项目',
  '硅光器件技术改造项目',
];

const projectStatuses: MapProject['status'][] = [
  'new', 'new', 'reserve', 'new', 'statistics', 'reserve', 'new', 'ongoing', 'new', 'statistics',
];

function buildProject(seed: ProjectSeed, industryId: string, index: number): MapProject {
  const [name, longitude, latitude, city, status, description] = seed;
  return {
    id: `${industryId}-${index + 1}`,
    name,
    longitude,
    latitude,
    status,
    industryId,
    city,
    description: description ?? '项目按计划推进建设及相关配套工作，当前正在协调设备进场与实施节点。',
    date: '2026-10-14',
  };
}

const clusteredOptoProjects = optoClusters.flatMap(({ city, longitude, latitude, count, spread }, clusterIndex) =>
  Array.from({ length: count }, (_, index): ProjectSeed => {
    const angle = index * 2.4 + clusterIndex;
    const distance = spread * Math.sqrt((index + 1) / count);
    return [
      city.slice(0, -1) + optoFacilities[(index + 2 * clusterIndex) % optoFacilities.length],
      longitude + Math.cos(angle) * distance,
      latitude + Math.sin(angle) * distance * 0.7,
      city,
      projectStatuses[(index + 2 * clusterIndex) % projectStatuses.length],
    ];
  }),
);

const industryFacilities: Record<string, string[]> = {
  automotive: ['智能网联汽车整车基地', '新能源商用车零部件项目', '汽车电驱系统智能制造项目', '轻量化车身生产项目'],
  chemistry: ['绿色精细化工基地', '循环经济产业园项目', '磷系新材料生产项目', '高纯化学品技改项目'],
  metallurgy: ['超低排放生产线改造项目', '绿色短流程炼钢项目', '高端板材智能制造项目', '金属资源循环利用项目'],
  chips: ['功率半导体器件项目', '先进封装与测试中心', '高纯晶圆材料项目', '车规级芯片产线项目'],
  ai: ['具身智能研发与验证基地', '人工智能算力中心', '工业大模型应用项目', '智能机器人研发中心'],
  bio: ['高端医疗器械研发制造基地', '生物制剂生产项目', '医学影像设备产线项目', '分子诊断试剂项目'],
  energy: ['先进储能电池项目', '新能源装备制造基地', '梯次利用生产线项目', '新型储能示范项目'],
  materials: ['高性能复合材料产线项目', '高纯合金材料项目', '特种功能薄膜基地', '新材料验证平台'],
  equipment: ['智能数控设备基地', '高精密工业装备项目', '智能制造配套产业园', '精密检测设备研发项目'],
  aero: ['航天遥感应用基地', '卫星通信终端研制项目', '无人飞行器制造中心', '航天部件测试基地'],
  food: ['现代食品加工产业园', '农产品冷链物流项目', '休闲食品生产基地', '食品质量检测中心'],
  textiles: ['绿色纺织制造基地', '功能性面料产业园项目', '纺织智能化改造项目', '服装数字化生产线项目'],
};

export const projects: MapProject[] = [
  ...featuredOptoProjects.concat(clusteredOptoProjects).map((seed, index) => buildProject(seed, 'opto', index)),
  ...industries.filter(({ id }) => id !== 'opto').flatMap(({ id }, industryIndex) =>
    industryFacilities[id].map((facility, index) => {
      const cluster = optoClusters[(industryIndex + index * 2) % optoClusters.length];
      return buildProject([
        cluster.city.slice(0, -1) + facility,
        cluster.longitude + index * 0.026,
        cluster.latitude - index * 0.021,
        cluster.city,
        projectStatuses[(industryIndex + index * 2) % projectStatuses.length],
      ], id, index);
    }),
  ),
];
