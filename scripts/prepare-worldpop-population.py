"""Clip the WorldPop R2025A China 2025 30-arcsecond raster to the published CIM boundaries.

Usage: python prepare-worldpop-population.py china.tif administration.geojson output.json
Requires rasterio, shapely 2.1+ and pyproj. The boundary input is a GeoJSON FeatureCollection.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

import rasterio
from pyproj import Geod
from rasterio.windows import Window, from_bounds
from shapely import STRtree, box, orient_polygons, set_precision, union_all
from shapely.geometry import mapping, shape


GRID = 0.0000001
GEOD = Geod(ellps="WGS84")
RASTER_SHA256 = "da62b04b9c979fc9920e813cce07efa15c97213b17974830d6c3b7f6d57b5002"


def polygonal(geom):
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    return union_all([part for part in getattr(geom, "geoms", [])
                      if part.geom_type in ("Polygon", "MultiPolygon") and not part.is_empty])


def area_m2(geom):
    return abs(GEOD.geometry_area_perimeter(orient_polygons(geom))[0])


def build(source, boundaries):
    features = boundaries["features"]
    city = set_precision(shape(next(f["geometry"] for f in features
                                    if f["properties"]["kind"] == "city-boundary")), GRID)
    regions = []
    claimed = None
    for f in sorted((f for f in features if f["properties"]["kind"] == "town-boundary"),
                    key=lambda f: f["properties"]["adcode"]):
        geom = set_precision(shape(f["geometry"]), GRID).intersection(city)
        if claimed is not None:
            geom = polygonal(geom.difference(claimed))
        if not geom.is_empty:
            regions.append((f["properties"]["adcode"], f["properties"]["name"], geom))
            claimed = geom if claimed is None else claimed.union(geom)
    remainder = polygonal(city.difference(claimed))
    if not remainder.is_empty:
        regions.append(("420882", "京山市", remainder))
    tree = STRtree([region[2] for region in regions])

    if source.crs.to_epsg() != 4326 or abs(source.res[0] - 1 / 120) > 1e-8:
        raise ValueError("Expected the native WGS84 30-arcsecond WorldPop raster")
    window = from_bounds(*city.bounds, transform=source.transform)
    row0, col0 = math.floor(window.row_off), math.floor(window.col_off)
    height = math.ceil(window.row_off + window.height) - row0
    width = math.ceil(window.col_off + window.width) - col0
    values = source.read(1, window=Window(col0, row0, width, height), masked=True)
    cells, fractions = [], []
    native_count = empty_count = 0
    area_sum = estimated = 0.0
    for y in range(height):
        for x in range(width):
            row, col = row0 + y, col0 + x
            west, north = source.transform * (col, row)
            east, south = source.transform * (col + 1, row + 1)
            pixel = set_precision(box(west, south, east, north), GRID)
            parts = []
            for idx in sorted(tree.query(pixel, predicate="intersects")):
                code, name, region = regions[idx]
                part = polygonal(pixel.intersection(region))
                if not part.is_empty and part.area > 0:
                    parts.append((code, name, part))
            if not parts:
                continue
            native_count += 1
            masked = bool(values.mask[y, x])
            empty_count += int(masked)
            count = None if masked else float(values[y, x])
            if count is not None and (not math.isfinite(count) or count < 0):
                raise ValueError(f"Invalid population at {row},{col}")
            full_area = area_m2(pixel)
            for code, name, part in parts:
                area_sum += part.area
                center = part.representative_point()
                props = {"name": f"{name}人口网格 {row}-{col}", "region": name, "kind": "population-grid",
                         "center": [round(center.x, 7), round(center.y, 7)]}
                if count is not None:
                    allocation = count * area_m2(part) / full_area
                    props["densityPerKm2"] = round(count * 1e6 / full_area, 3)
                    props["population"] = math.floor(allocation)
                    fractions.append((allocation - props["population"], len(cells)))
                    estimated += allocation
                cells.append({"type": "Feature", "id": f"wp25-{row}-{col}-{code}",
                              "geometry": mapping(part), "properties": props})
    if abs(area_sum - city.area) / city.area > 0.00001:
        raise ValueError("Grid fragments do not cover the city")
    remaining = round(estimated) - sum(f["properties"].get("population", 0) for f in cells)
    for _, idx in sorted(fractions, key=lambda entry: -entry[0])[:remaining]:
        cells[idx]["properties"]["population"] += 1
    print(f"{native_count} native pixels ({empty_count} NoData); {len(cells)} fragments; "
          f"{round(estimated):,} estimated residents; {area_m2(city)/1e6:.2f} km²")
    return {"id": "worldpop_population_2025", "name": "人口密度网格（2025）", "department": "WorldPop",
            "category": "人口地理", "source": {"serviceId": "worldpop-chn-2025-r2025a-v1",
            "serviceName": "WorldPop Global 2015–2030 · 中国 2025", "syncedAt": "2026-11-21", "count": len(cells)},
            "description": "WorldPop（南安普顿大学），中国 2025 年人口估算，Global 2015–2030 R2025A v1，30 角秒。"
            "按京山市、镇街边界裁切，人口按市内面积分摊，密度为人/平方公里。无数据独立显示。"
            "原始数据 https://hub.worldpop.org/geodata/summary?id=76799 ，"
            "经裁切和密度换算，按 CC BY 4.0 使用（https://creativecommons.org/licenses/by/4.0/）。",
            "features": cells}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    for arg in ("raster", "boundaries", "output"):
        parser.add_argument(arg, type=Path)
    args = parser.parse_args()
    with args.raster.open("rb") as source_file:
        if hashlib.file_digest(source_file, "sha256").hexdigest() != RASTER_SHA256:
            raise ValueError("Expected the original CHN 2025 R2025A v1 constrained 1km_ua GeoTIFF")
    with rasterio.open(args.raster) as raster:
        dataset = build(raster, json.loads(args.boundaries.read_text(encoding="utf-8-sig")))
    args.output.write_text(json.dumps(dataset, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
                           encoding="utf-8")
