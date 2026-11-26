"""Draw the same planning symbols on XYZ tiles and on geographic 3-D district surfaces."""
from functools import lru_cache
import io
import math
import zlib

import numpy as np
from PIL import Image
from rasterio.features import rasterize
from rasterio.transform import from_bounds
import shapely

WORLD = math.pi * 6378137
MAX_ZOOM = 15
MARGIN = 2


def paint(padded, style, x=0, y=0):
    height, width = padded.shape[0]-2*MARGIN, padded.shape[1]-2*MARGIN
    solid = padded >= (52 if style['pattern']=='dots' else 28)
    def shifted(dx,dy):
        return solid[MARGIN+dy:MARGIN+dy+height, MARGIN+dx:MARGIN+dx+width]
    body = shifted(0,0)
    near = shifted(-1,0) & shifted(1,0) & shifted(0,-1) & shifted(0,1)
    core = near & shifted(-2,0) & shifted(2,0) & shifted(0,-2) & shifted(0,2)
    edge = body & ~near
    yy,xx = np.ogrid[y:y+height,x:x+width]
    pixels = np.zeros(body.shape,dtype='uint8')
    pixels[body] = 1
    if style['pattern']=='dots':
        pixels[body & ((xx%10-5)**2+(yy%10-5)**2<5)] = 2
        pixels[edge] = 3
    else:
        if style['pattern']=='hatch':
            pixels[body & ((xx+yy)%13<3)] = 2
        pixels[body & ~core] = 3
    # A one-pixel dark casing separates each bright boundary from light satellite pixels.
    outside = ~body & (shifted(-1,0)|shifted(1,0)|shifted(0,-1)|shifted(0,1))
    pixels[outside] = 4
    rgb = bytes.fromhex(style['color'][1:])
    halo = bytes.fromhex(style['halo'][1:])
    palette = bytes(3) + rgb*3 + halo
    alpha = bytes([0, 47 if style['pattern']=='dots' else 72, 217, 166 if style['pattern']=='dots' else 250, 119])
    image = Image.frombytes('P',(width,height),pixels.tobytes())
    image.putpalette(palette)
    output=io.BytesIO()
    image.save(output,format='PNG',bits=4,transparency=alpha)
    return output.getvalue()


def coverage(polygons,tree,box,size):
    indices=tree.query(shapely.box(*box))
    if not len(indices):
        return np.zeros(size,dtype='uint8')
    parts=shapely.clip_by_rect(polygons[indices],*box)
    parts=parts[~shapely.is_empty(parts)]
    if not len(parts):
        return np.zeros(size,dtype='uint8')
    return rasterize(parts,out_shape=size,transform=from_bounds(*box,size[1],size[0]),default_value=255,dtype='uint8')


def build_tiles(db, polygons, style):
    tree=shapely.STRtree(polygons)
    west,south,east,north=shapely.total_bounds(polygons)
    span=2*WORLD/2**MAX_ZOOM
    tx=lambda x: math.floor((x+WORLD)/span)
    ty=lambda y: math.floor((WORLD-y)/span)
    db.execute('create temp table cover(z integer,x integer,y integer,data blob,primary key(z,x,y)) without rowid')
    children=set()
    def save(z,x,y,data):
        db.execute('insert into cover values(?,?,?,?)',(z,x,y,zlib.compress(data.tobytes(),1)))
    empty=np.zeros((256,256),dtype='uint8')
    @lru_cache(maxsize=128)
    def read(z,x,y):
        row=db.execute('select data from cover where z=? and x=? and y=?',(z,x,y)).fetchone()
        return np.frombuffer(zlib.decompress(row[0]),dtype='uint8').reshape(256,256) if row else empty
    for col in range(tx(west),tx(east)+1,4):
        for row in range(ty(north),ty(south)+1,4):
            box=(-WORLD+col*span,WORLD-(row+4)*span,-WORLD+(col+4)*span,WORLD-row*span)
            mask=coverage(polygons,tree,box,(1024,1024))
            for dy in range(4):
                for dx in range(4):
                    piece=mask[dy*256:(dy+1)*256,dx*256:(dx+1)*256]
                    if piece.any():
                        x,y=col+dx,row+dy
                        save(MAX_ZOOM,x,y,piece)
                        children.add((x,y))
    for z in range(MAX_ZOOM,-1,-1):
        for x,y in sorted(children):
            m=MARGIN
            padded=np.empty((256+m*2,256+m*2),dtype='uint8')
            for dx,destx,srcx in [(-1,slice(0,m),slice(-m,None)),(0,slice(m,-m),slice(None)),(1,slice(-m,None),slice(0,m))]:
                for dy,desty,srcy in [(-1,slice(0,m),slice(-m,None)),(0,slice(m,-m),slice(None)),(1,slice(-m,None),slice(0,m))]:
                    padded[desty,destx]=read(z,x+dx,y+dy)[srcy,srcx]
            db.execute('insert into tiles values(?,?,?,?)',(z,x,y,paint(padded,style,x*256,y*256)))
        if z:
            parents={(x//2,y//2) for x,y in children}
            for x,y in parents:
                mosaic=np.block([[read(z,x*2,y*2),read(z,x*2+1,y*2)],[read(z,x*2,y*2+1),read(z,x*2+1,y*2+1)]])
                save(z-1,x,y,np.asarray(Image.fromarray(mosaic).resize((256,256),Image.Resampling.BOX)))
            children=parents
    db.execute('drop table cover')


def build_roofs(db, geo, districts, style):
    tree=shapely.STRtree(geo)
    db.execute('create table roofs(district text primary key,bounds text,png blob) without rowid')
    for name,box in districts:
        w,s,e,n=box
        aspect=(e-w)*math.cos(math.radians((s+n)/2))/(n-s)
        width=max(1,round(1536*min(1,aspect)))
        height=max(1,round(1536*min(1,1/aspect)))
        raw=coverage(geo,tree,box,(height*2,width*2))
        mask=np.asarray(Image.fromarray(raw).resize((width,height),Image.Resampling.BOX))
        png=paint(np.pad(mask,MARGIN),style)
        db.execute('insert into roofs values(?,?,?)',(name,','.join(map(str,box)),png))
