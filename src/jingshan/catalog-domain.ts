export type CatalogDomain='spatial'|'services'
export const catalogDomainNames={spatial:'空间数据资源',services:'服务资源'}
export function catalogSearchKey(domain:CatalogDomain,query:string){return domain+'|'+query.trim()}
export function parseCatalogSearch(key:string):{domain:CatalogDomain;query:string}{
  const match=/^(spatial|services)\|([\s\S]*)$/.exec(key)
  return match?{domain:match[1] as CatalogDomain,query:match[2]}:{domain:'spatial',query:key}
}
export function inCatalogDomain(type:string,domain:CatalogDomain){
  return domain==='spatial'?(type==='local'||type==='views'):type==='services'
}
