export const cimDatasetBindings: Readonly<Record<string, {id: string; name: string; kind: string; department: string}>> = {
  'cim-09': {id: 'schools', name: '学校', kind: 'school', department: '京山市教育局'},
  'cim-10': {id: 'medical', name: '医疗卫生机构', kind: 'medical', department: '京山市卫生健康局'},
  'cim-11': {id: 'tourism', name: '景区', kind: 'tourism', department: '京山市文化和旅游局'},
  'cim-12': {id: 'cim_squares', name: '广场', kind: 'square', department: '京山市城市管理执法局'},
  'cim-13': {id: 'cim_parks', name: '公园', kind: 'park', department: '京山市城市管理执法局'},
}
export const cimBoundaryBindings: Readonly<Record<string, {id: string; name: string}>> = {
  'cim-05': {id: 'administration', name: '市与乡镇行政区划'},
  'cim-06': {id: 'administration', name: '市与乡镇行政区划'},
  'cim-07': {id: 'communities', name: '村与社区行政区划'},
}
