import express, { Router } from 'express'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CimError } from './cim-error.ts'

const directory = fileURLToPath(new URL('../.local/3dtiles/', import.meta.url))
const localIndex = /^\/api\/jingshan\/cim\/local-tiles\/([a-z0-9][a-z0-9_-]{0,79})\/tileset\.json$/

export function localTilesetId(url: string) {
  return localIndex.exec(url)?.[1]
}

export async function readLocalTileset(id: string) {
  if (localTilesetId('/api/jingshan/cim/local-tiles/' + id + '/tileset.json') !== id) {
    throw new CimError('本地模型标识无效。', 400)
  }
  let source: string
  try {
    source = await readFile(join(directory, id, 'tileset.json'), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CimError('本机未找到该模型的 tileset.json。', 404, 'offline')
    }
    throw error
  }
  let index
  try {
    index = JSON.parse(source.replace(/^\uFEFF/, ''))
  } catch {
    throw new CimError('本地模型的 tileset.json 不是有效的 JSON。', 422)
  }
  if (typeof index?.asset?.version !== 'string' || !index.root?.boundingVolume) {
    throw new CimError('本地模型的 3D Tiles 版本或根节点包围体缺失。', 422)
  }
  // Some AgCIM exports specify the error only on the root tile.
  index.geometricError ??= index.root.geometricError
  if (!Number.isFinite(index.geometricError) || index.geometricError < 0) {
    throw new CimError('本地模型缺少有效的几何误差。', 422)
  }
  return index as { asset: { version: string }; root: Record<string, unknown>; geometricError: number }
}

export function localTilesRouter() {
  const router = Router()
  router.use((req, res, next) => {
    const origin = req.headers.origin
    if (origin && /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(origin)) {
      res.vary('Origin').set('Access-Control-Allow-Origin', origin)
    }
    next()
  })
  router.get('/:id/tileset.json', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-cache').json(await readLocalTileset(req.params.id))
    } catch (error) {
      if (!(error instanceof CimError)) throw error
      res.status(error.status).json({ error: error.message })
    }
  })
  router.use(express.static(directory, { index: false, redirect: false, maxAge: 0 }))
  router.use((_req, res) => { res.status(404).end() })
  return router
}
