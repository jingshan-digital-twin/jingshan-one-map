import type { Coordinate, Dataset } from './types.ts'

export const fusionDestinationsId = 'form_fusion_destinations'

type Reference = {
  id: string; name: string; city: string; scope: '京山' | '荆门' | '湖北'; category: '景区' | '温泉'
  position: Coordinate; sourceUrl: string; locationSource: string
}

// Museum / park points are geographic references. The visitor planning model uses
// them as destinations and never interprets their inclusion as a merchant agreement.
const references: Reference[] = [
  {
    id: 'tianmu', name: '京山天沐温泉', city: '京山市', scope: '京山', category: '温泉',
    position: [113.145502, 30.972223],
    sourceUrl: 'https://zhuanti.mct.gov.cn/mmyghcyt2023/hjgn/detail/5007.html',
    locationSource: '京山市已发布充电设施 · 天沐温泉酒店停车场',
  },
  {
    id: 'xianling', name: '明显陵', city: '钟祥市', scope: '荆门', category: '景区',
    position: [112.63319, 31.21111],
    sourceUrl: 'https://wlt.hubei.gov.cn/bmdt/ztzl/lszt/sjwhyc/sjyzcd/mxl/',
    locationSource: '湖北省文化和旅游厅公布的遗产地经纬度范围中心',
  },
  {
    id: 'mochou', name: '莫愁湖国家湿地公园', city: '钟祥市', scope: '荆门', category: '景区',
    position: [112.60035, 31.19277],
    sourceUrl: 'https://sjfw.mct.gov.cn/site/dataservice/culdetails?curId=10&id=34987',
    locationSource: 'https://www.amap.com/place/B02D400BBW',
  },
  {
    id: 'dongyong', name: '董永公园', city: '孝感市', scope: '湖北', category: '景区',
    position: [113.91221, 30.92216],
    sourceUrl: 'https://wlt.hubei.gov.cn/bmdt/mtjj/202504/t20250410_5609803.shtml',
    locationSource: 'https://ditu.amap.com/place/B02C8001FG',
  },
  {
    id: 'jinyinhu', name: '金银湖国家城市湿地公园', city: '武汉市', scope: '湖北', category: '景区',
    position: [114.18634, 30.65688],
    sourceUrl: 'https://www.dxh.gov.cn/YXLKG_16692/lyjd/jdjs/202005/t20200517_1322129.shtml',
    locationSource: 'https://www.amap.com/place/B001B0I0IB',
  },
  {
    id: 'donghu', name: '武汉东湖绿道', city: '武汉市', scope: '湖北', category: '景区',
    position: [114.36945, 30.57693],
    sourceUrl: 'https://www.whdonghu.gov.cn/zwgk_6255/xxgkml/jgsz/dwjj/',
    locationSource: 'https://ditu.amap.com/place/B0FFHONIK0',
  },
  {
    id: 'luyu', name: '陆羽故园', city: '天门市', scope: '湖北', category: '景区',
    position: [113.15561, 30.65892],
    sourceUrl: 'https://www.tianmen.gov.cn/zwgk/bmhxzxxgkml/bm/swhhlyj/zfxxgk/fdzdgknr/gysyjs/ly1/202312/t20231225_5015555.shtml',
    locationSource: 'https://www.amap.com/place/BV11598748',
  },
  {
    id: 'baizhao', name: '白兆山李白文化旅游区', city: '安陆市', scope: '湖北', category: '景区',
    position: [113.55978, 31.32776],
    sourceUrl: 'https://www.hbjc.gov.cn/ejxw/mtb/202503/t20250318_1849767.shtml',
    locationSource: 'https://ditu.amap.com/place/B02C80NNOO',
  },
]

export function fusionDestinationDataset(): Dataset {
  return {
    id: fusionDestinationsId, name: '网旅融合游览地', category: '文旅资源', department: '市文化和旅游局',
    description: '赛间游览和省内返程顺游的景区、温泉与定位参考。',
    formSchema: {fields: [
      {key: 'category', label: '类型', type: 'select', options: ['景区', '温泉'], required: true},
      {key: 'scope', label: '区域', type: 'select', options: ['京山', '荆门', '湖北'], required: true},
      {key: 'city', label: '所在市县', type: 'text', required: true},
      {key: 'visitMinutes', label: '建议短游时长（分钟）', type: 'number'},
      {key: 'status', label: '展示状态', type: 'select', options: ['展示', '暂停']},
      {key: 'sourceUrl', label: '文旅资料来源', type: 'text'},
      {key: 'locationSource', label: '点位来源', type: 'text'},
    ]},
    features: references.map(({id, position, ...properties}) => ({
      id: 'fusion-place-' + id, type: 'Feature', geometry: {type: 'Point', coordinates: [...position]},
      properties: {kind: 'fusion-destination', region: properties.city, status: '展示', ...properties},
    })),
  }
}

