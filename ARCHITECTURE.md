# 项目组结构

`jingshan-digital-twin` 是一个项目组仓库，同一套后端与共享领域代码下承载多个端。

```
apps/                  各端的入口与界面代码
  one-map/             一张图（京山网球产业一张图 + 湖北产业链演示页）
    index.html         入口，访问 /apps/one-map/
    hubei.html         湖北产业链演示页，访问 /apps/one-map/hubei.html
  admin-console/       管理后台
    index.html         平台后台，访问 /apps/admin-console/
    workspace/         工作区版后台，访问 /apps/admin-console/workspace/
  public-portal/       公众端（骨架就绪，模块待开发）
    index.html         访问 /apps/public-portal/
    src/               入口与页面代码
src/                   共享层
  jingshan/*.ts        领域模型、校验、分析、CIM 类型等，前后端共用
  jingshan/*.vue       现阶段各端界面组件（历史沉淀，按需下沉到 apps/<app>/src）
server/                统一后端 Express + PostgreSQL，所有端共用
public/                静态资源与地图数据，所有端共用
scripts/               数据库初始化、种子与发布脚本
```

## 关键约束

1. **`src/jingshan/*.ts` 是前后端共享层，不是一张图专属。** `server/` 与 `scripts/` 有 100+ 处直接 import，Dockerfile 运行阶段也单独 COPY 这批文件。不要把它整体搬进 `apps/`，也不要在其中写只有某个端才需要的界面逻辑。
2. **新端的界面代码放 `apps/<app>/src/`**，通过相对路径引用 `src/jingshan/*.ts` 的领域函数，不要复制一份。
3. **后端只保留一套** `server/`，各端通过 `/api` 访问；新增接口按业务模块拆文件，不要按端拆。
4. 各端共用一套 Vite 构建与 `public/`，因此地图资源、Cesium 只加载一份。

## 新增一个端

1. 建目录 `apps/<app>/`，放 `index.html`，脚本用 `<script type="module" src="./src/main.ts">`。
2. 写 `apps/<app>/src/main.ts` 与根组件。
3. 在 `vite.config.ts` 的 `build.rolldownOptions.input` 里加一条入口。
4. 若需保留可读路径，在 `vite.config.ts` 的 `legacyEntryRedirects` 与 `server/index.ts` 的 `legacyEntries` 里加映射。
5. 在 `Dockerfile` 的 build 阶段确认 `COPY apps ./apps`（已覆盖，无需改动）。

## 访问地址

| 端 | 开发地址 | 构建产物 |
|---|---|---|
| 一张图 | http://127.0.0.1:5173/apps/one-map/ | `dist/apps/one-map/index.html` |
| 湖北产业链 | http://127.0.0.1:5173/apps/one-map/hubei.html | `dist/apps/one-map/hubei.html` |
| 管理后台 | http://127.0.0.1:5173/apps/admin-console/ | `dist/apps/admin-console/index.html` |
| 工作区后台 | http://127.0.0.1:5173/apps/admin-console/workspace/ | `dist/apps/admin-console/workspace/index.html` |
| 公众端 | http://127.0.0.1:5173/apps/public-portal/ | `dist/apps/public-portal/index.html` |

旧地址 `/`、`/admin/`、`/workspace/`、`/hubei.html` 会 302 跳转到对应新地址，开发与生产环境均已处理。
