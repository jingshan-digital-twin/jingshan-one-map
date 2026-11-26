import { cpSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const assets = new URL('node_modules/cesium/Build/Cesium/', root);
const target = new URL('public/cesium/', root);

mkdirSync(target, { recursive: true });
for (const folder of ['Assets', 'ThirdParty', 'Widgets', 'Workers']) {
  cpSync(fileURLToPath(new URL(folder, assets)), fileURLToPath(new URL(folder, target)), { recursive: true });
}
