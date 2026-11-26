"""Package a native 100 m population GeoTIFF and the published township boundaries.
Usage: python scripts/prepare-jingshan-population.py source.tif towns.geojson out.json
Each block contains lossless row-major runs of (length, persons, township index).
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.features import rasterize
from rasterio.warp import transform_geom

BLOCK = 32
SOURCE_ID = "jingshan_population_100m"


def package(raster_path, boundaries, synced):
    with rasterio.open(raster_path) as src:
        if (src.count != 1 or src.crs.to_epsg() != 4547 or src.res != (100, 100)
                or src.transform.b != 0 or src.transform.d != 0 or src.transform.e != -100
                or src.units[0] != "persons/cell" or not np.issubdtype(src.dtypes[0], np.integer)):
            raise ValueError("Expected north-up EPSG:4547, 100 m, integer persons/cell")
        masked = src.read(1, masked=True)
        counts = masked.filled(-1)
        valid = ~np.ma.getmaskarray(masked)
        if np.any(counts[valid] < 0):
            raise ValueError("Invalid negative population")
        total = int(counts[valid].sum(dtype=np.int64))
        if total != int(src.tags()["population_total"]):
            raise ValueError("Raster checksum total disagrees with metadata")
        towns = sorted((f for f in boundaries["features"] if f["properties"]["kind"] == "town-boundary"),
                       key=lambda f: f["properties"]["adcode"])
        if not towns:
            raise ValueError("Township boundaries missing")
        names = ["京山市"] + [f["properties"]["name"] for f in towns]
        zones = rasterize([(transform_geom("EPSG:4326", src.crs, f["geometry"]), i + 1)
                           for i, f in enumerate(towns)], out_shape=counts.shape, transform=src.transform,
                          fill=0, all_touched=False, dtype="uint8")
        zones[~valid] = 0
        tr = Transformer.from_crs(src.crs, "EPSG:4326", always_xy=True)

        def corner(x, y):
            return [round(v, 9) for v in tr.transform(*(src.transform * (x, y)))]

        tiles = []
        for y in range(0, src.height, BLOCK):
            for x in range(0, src.width, BLOCK):
                values = counts[y:y+BLOCK, x:x+BLOCK]
                h, w = values.shape
                n = int(np.count_nonzero(values >= 0))
                if not n:
                    continue
                areas, local = np.unique(zones[y:y+h, x:x+w], return_inverse=True)
                people, area = values.ravel(), local.ravel()
                ends = np.r_[0, np.flatnonzero((people[1:] != people[:-1]) | (area[1:] != area[:-1])) + 1, len(people)]
                runs = np.column_stack((np.diff(ends), people[ends[:-1]], area[ends[:-1]])).ravel().tolist()
                nw, sw, se, ne = corner(x,y), corner(x,y+h), corner(x+w,y+h), corner(x+w,y)
                tile = {"type":"Feature", "id":f"js-pop-block-{y}-{x}",
                        "geometry":{"type":"Polygon","coordinates":[[nw,sw,se,ne,nw]]},
                        "properties":{"kind":"population-raster-block","name":f"人口网格分块 {y}-{x}","region":"京山市",
                                      "row":y,"col":x,"width":w,"height":h,"cellSizeM":100,
                                      "controls":[corner(x+w/2,y),corner(x+w,y+h/2),corner(x+w/2,y+h),corner(x,y+h/2),corner(x+w/2,y+h/2)],
                                      "regions":[names[i] for i in areas],"runs":runs,"validCells":n}}
                tiles.append(tile)
        digest = hashlib.sha256(raster_path.read_bytes()).hexdigest()
        print(json.dumps({"valid":int(valid.sum()),"populated":int((counts>0).sum()),"people":total,
                          "noData":int((~valid).sum()),"unassignedPeople":int(counts[valid & (zones==0)].sum()),
                          "blocks":len(tiles),"sha256":digest}))
        return {"id":SOURCE_ID,"name":"京山市实有人口网格（100米）","category":"人口地理","department":"本地数据",
                "source":{"serviceId":"jingshan-building-population-100m","serviceName":raster_path.name,
                          "syncedAt":synced,"count":int(valid.sum())},
                "description":"实有人口按建筑中心归集至 100 米网格，原始坐标系为 CGCS2000 三度带（中央经线 114°）。每个像元记录人数，密度按 0.01 平方公里换算。镇街按像元中心归属，未匹配镇街的有效格计入市级。零人口与无数据分别处理。",
                "features":tiles}


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    for arg in ("raster","boundaries","output"):
        ap.add_argument(arg,type=Path)
    ap.add_argument("--synced",required=True)
    a = ap.parse_args()
    data = package(a.raster,json.loads(a.boundaries.read_text(encoding="utf-8-sig")),a.synced)
    a.output.write_text(json.dumps(data,ensure_ascii=False,separators=(",",":"),allow_nan=False),encoding="utf-8")
