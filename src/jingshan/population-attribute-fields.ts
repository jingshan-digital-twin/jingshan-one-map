export const populationAttributeColumns = [
  {key:'id', label:'实体业务ID', width:26.78, text:true},
  {key:'name', label:'实体名称', width:30},
  {key:'kind', label:'资源类型', width:19},
  {key:'region', label:'所属行政区', width:14},
  {key:'population', label:'格内人口（人）', width:17},
  {key:'densityPerKm2', label:'人口密度（人/km²）', width:22},
  {key:'longitude', label:'经度', width:17.44, coordinate:true},
  {key:'latitude', label:'纬度', width:17.44, coordinate:true},
] as const
