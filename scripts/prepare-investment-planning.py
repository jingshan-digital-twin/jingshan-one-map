"""Build local planning services and classify survey parcels in the original CRS.

Run with Python, pyogrio, pyproj, shapely, numpy, rasterio and Pillow.
Inputs are the three SHPs, the land survey FileGDB, and an empty output directory.
"""
import argparse
import gzip
import json
import math
import sqlite3
from pathlib import Path

import numpy as np
import pyogrio
import pyogrio.raw
import shapely
from pyproj import CRS, Transformer
from planning_cartography import MAX_ZOOM, build_roofs, build_tiles


LAYERS=json.loads((Path(__file__).resolve().parents[1]/'src/jingshan/planning-symbology.json').read_text(encoding='utf8'))
USES={'0508':'物流仓储用地','05H1':'商业服务业设施用地','0601':'工业用地','1201':'空闲地'}


def project(geoms, source, target):
    transformer = Transformer.from_crs(source, target, always_xy=True)
    return shapely.transform(geoms, transformer.transform, interleaved=False)


def clean_value(v):
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, float) and not math.isfinite(v):
        return None
    if v is None or isinstance(v, (str, float, bool, int)):
        return v
    return str(v)


def control(path, style, districts, dest):
    key,name=style['key'],style['name']
    meta, fids, wkb, fields = pyogrio.raw.read(path,return_fids=True)
    geoms = shapely.from_wkb(wkb)
    original_crs = CRS(meta['crs'])
    geo = project(geoms,original_crs,4326)
    invalid = ~shapely.is_valid(geoms)
    geoms[invalid] = shapely.make_valid(geoms[invalid])
    if shapely.is_empty(geoms).any() or shapely.is_missing(geoms).any():
        raise ValueError(f'{name} contains empty geometries')
    bounds = shapely.total_bounds(geo).tolist()
    db = sqlite3.connect(dest / (key+'.sqlite'))
    db.execute('create table features(fid integer primary key, feature blob not null)')
    db.execute('create table tiles(z integer,x integer,y integer,png blob not null,primary key(z,x,y)) without rowid')
    db.execute('create table metadata(json text not null)')
    keys = list(meta['fields'])
    for i,(fid,g) in enumerate(zip(fids,geo)):
        props = {k:clean_value(col[i]) for k,col in zip(keys, fields)}
        props.update(name=f'{name} {fid}',region='京山市',kind='planning-'+key)
        feature = dict(type='Feature',id=f'planning-{key}-{fid}',properties=props,geometry=shapely.geometry.mapping(g))
        db.execute('insert into features values(?,?)',(int(fid),gzip.compress(json.dumps(feature,ensure_ascii=False,separators=(',',':')).encode(),compresslevel=1)))
    details = dict(name=name,count=len(fids),bounds=bounds,maxZoom=MAX_ZOOM,filename=path.name,crs=original_crs.to_string(),roofs=True,pattern=style['pattern'],color=style['color'])
    db.execute('insert into metadata values(?)',(json.dumps(details,ensure_ascii=False),))
    db.commit()
    print(key,len(geoms),'building tiles',flush=True)
    web = project(geoms,original_crs,3857)
    build_tiles(db,web,style)
    build_roofs(db,geo,districts,style)
    print(key,db.execute('select count(*) from tiles').fetchone()[0],'tiles',flush=True)
    db.commit()
    db.close()
    return original_crs, shapely.STRtree(geoms), details


def urban_relation(parcel, tree):
    """Classify the whole survey polygon, including holes and adjoining development polygons."""
    matches = tree.query(parcel, predicate='intersects')
    if not len(matches):
        return 'outside', 0.
    zones = tree.geometries.take(matches)
    coverage = zones[0] if len(matches)==1 else shapely.union_all(zones)
    if coverage.covers(parcel):
        return 'inside', 100.
    inside = parcel.intersection(coverage).area
    if inside == 0:
        return 'outside', 0.
    if parcel.difference(coverage).area == 0:
        return 'inside', 100.
    return 'crossing', inside / parcel.area * 100.


def main():
    parser = argparse.ArgumentParser()
    for flag in ('urban','ecology','farmland','survey','output'):
        parser.add_argument('--'+flag,type=Path,required=True)
    parser.add_argument('--screen-only',action='store_true',help='Reuse this edition’s tiles and screen survey parcels against the source geometries')
    parser.add_argument('--reuse-controls',type=Path,help='Use an existing control service edition for a new survey screening edition')
    parser.add_argument('--regions',type=Path,required=True,help='Published business administration FeatureCollection')
    args = parser.parse_args()
    features=json.loads(args.regions.read_text(encoding='utf8'))['features']
    districts=[(f['properties']['name'],shapely.from_geojson(json.dumps(f['geometry'])).bounds) for f in features if f['properties']['kind'] in ('town-boundary','city-boundary')]
    if not districts or not any(name=='京山市' for name,_ in districts):raise ValueError('Missing city boundary')
    dest = args.output
    dest.mkdir(parents=True,exist_ok=True)
    control_dir=args.reuse_controls or dest
    if args.reuse_controls and any(dest.iterdir()):
        raise ValueError('Choose an empty output directory for the new screening edition')
    if args.screen_only or args.reuse_controls:
        controls=[]
        existing=json.loads((control_dir/'manifest.json').read_text(encoding='utf8'))
        for style in LAYERS:
            key=style['key']
            path=getattr(args,key)
            info,_,wkb,_=pyogrio.raw.read(path,columns=[])
            geometries=shapely.from_wkb(wkb)
            details=existing['layers'][key]
            if details['filename']!=path.name or details['count']!=len(geometries):
                raise ValueError('Control source differs from published edition')
            invalid=~shapely.is_valid(geometries)
            geometries[invalid]=shapely.make_valid(geometries[invalid])
            controls.append((CRS(info['crs']),shapely.STRtree(geometries),details))
    else:
        if any(dest.iterdir()):
            raise ValueError('Choose an empty output directory for this edition')
        controls = [control(getattr(args,style['key']),style,districts,dest) for style in LAYERS]
    clause='DLBM IN ('+','.join("'"+code+"'" for code in USES)+')'
    meta,fids,wkb,fields = pyogrio.raw.read(args.survey,layer='DLTB',where=clause,return_fids=True)
    geoms=shapely.make_valid(shapely.from_wkb(wkb))
    eligible = ~(shapely.is_missing(geoms) | shapely.is_empty(geoms))
    by_key={style['key']:record for style,record in zip(LAYERS,controls)}
    for key in ('ecology','farmland'):
        crs,tree,_=by_key[key]
        native = geoms if CRS(meta['crs'])==crs else project(geoms,meta['crs'],crs)
        hits=tree.query(native,predicate='intersects')
        eligible[hits[0]] = False
    urban_crs,urban_tree,_=by_key['urban']
    if not urban_crs.is_projected:
        raise ValueError('Urban coverage needs a projected CRS for area comparisons')
    urban_parcels=geoms if CRS(meta['crs'])==urban_crs else project(geoms,meta['crs'],urban_crs)
    townmeta,_,townwkb,townfields=pyogrio.raw.read(args.survey,layer='XZQ',columns=['XZQMC'])
    towntree=shapely.STRtree(shapely.from_wkb(townwkb))
    candidates=[]
    for i in np.flatnonzero(eligible):
        g=geoms[i]
        if g.geom_type not in ('Polygon','MultiPolygon') or g.area<=0:
            continue
        attrs={k:clean_value(col[i]) for k,col in zip(meta['fields'],fields)}
        fid=int(fids[i])
        name=attrs.get('ZLDWMC') or '京山市'
        code=str(attrs.get('TBBH') or fid)
        towns=towntree.query(project(g.representative_point(),meta['crs'],townmeta['crs']),predicate='within')
        survey_town=str(townfields[0][towns[0]]) if len(towns)==1 else ''
        land_code,land_name=attrs['DLBM'],attrs['DLMC']
        if USES[land_code]!=land_name:raise ValueError('Unrecognised survey class')
        relation,percent=urban_relation(urban_parcels[i],urban_tree)
        p=dict(urbanRelation=relation,urbanInsidePercent=percent,ecologyIntersects=False,farmlandIntersects=False,name=f'{name}{land_name} {code}',kind='investment-reserve',region='京山市',landUse=land_name,landUseCode=land_code,
               currentUseStatus='待核实',reserveBasis='调查空闲地' if land_code=='1201' else '存量建设用地摸排',surveyUnitCode=attrs.get('ZLDWDM'),
               area=round(float(attrs.get('TBMJ') or g.area),2),geometryArea=round(g.area,2),surveyTown=survey_town,sourceFid=fid,surveyParcel=code,surveyUnit=name,sourceLayer='2022 年度国土变更调查 DLTB',
               screeningStatus='拟储备·待核实',screened=True,
               center=list(project(g.representative_point(),meta['crs'],4326).coords[0]),
               surveyOwner=attrs.get('QSDWMC'),ownershipCode=attrs.get('QSXZ'),surveyId=str(attrs.get('BSM') or fid))
        candidates.append(dict(type='Feature',id=('js-vacant-2022-' if land_code=='1201' else 'js-land-2022-')+str(fid),properties=p,
                               geometry=shapely.geometry.mapping(project(g,meta['crs'],4326))))
    (dest/'reserves.json').write_text(json.dumps(candidates,ensure_ascii=False,separators=(',',':')),encoding='utf8')
    result=dict(controlEdition=(existing.get('controlEdition',control_dir.name) if args.screen_only or args.reuse_controls else dest.name),layers={style['key']:record[2] for style,record in zip(LAYERS,controls)},surveyCandidates=len(fids),landUses=USES,eligible=len(candidates))
    (dest/'manifest.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf8')
    print(json.dumps(result,ensure_ascii=False),flush=True)


if __name__=='__main__':
    main()
