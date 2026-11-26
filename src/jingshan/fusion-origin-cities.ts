import type { Coordinate } from './types.ts'

// City anchors are the centers supplied with public/imagery/hubei-boundaries.json.
export const fusionReturnCities: { name: string; position: Coordinate }[] = [
  { name: '武汉市', position: [114.298572, 30.584355] },
  { name: '黄石市', position: [115.077048, 30.220074] },
  { name: '十堰市', position: [110.787916, 32.646907] },
  { name: '宜昌市', position: [111.290843, 30.702636] },
  { name: '襄阳市', position: [112.144146, 32.042426] },
  { name: '鄂州市', position: [114.890593, 30.396536] },
  { name: '荆门市', position: [112.204251, 31.03542] },
  { name: '孝感市', position: [113.926655, 30.926423] },
  { name: '荆州市', position: [112.23813, 30.326857] },
  { name: '黄冈市', position: [114.879365, 30.447711] },
  { name: '咸宁市', position: [114.328963, 29.832798] },
  { name: '随州市', position: [113.37377, 31.717497] },
  { name: '恩施土家族苗族自治州', position: [109.48699, 30.283114] },
  { name: '仙桃市', position: [113.453974, 30.364953] },
  { name: '潜江市', position: [112.896866, 30.421215] },
  { name: '天门市', position: [113.165862, 30.653061] },
  { name: '神农架林区', position: [110.671525, 31.744449] },
]

