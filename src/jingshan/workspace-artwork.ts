/** Artwork from the supplied workspace design atlas. */
export const workspaceEdition = typeof document !== 'undefined' && document.documentElement.dataset.adminEdition === 'workspace'

export function workspaceArtwork(label: string) {
  const artwork = /场馆|体育馆|俱乐部|赛场|stadium|venue/i.test(label) ? 'stadium'
    : /网球|球场|场地|court/i.test(label) ? 'court'
    : /充电|停车|能源|设施|charging/i.test(label) ? 'charging'
    : /水|河|岸|地块|储备|供地/i.test(label) ? 'waterfront'
    : /人口|建筑|城镇|社区|企业|产业|经济|city/i.test(label) ? 'city'
    : 'mountain'
  return '/jingshan/workspace/' + artwork + '.webp'
}
