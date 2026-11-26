# 数智京山网球产业一张图 V3

Cesium 地图接入京山 CIM 的影像、建筑白模、道路面、行政区划、社区网格和公共设施。产业全景按 12 个环节展示京山企业，企业名录和数据中台共用本机数据库。

## 多人和 AI 协作

本仓库是一个项目组，同一套后端下承载三个端：**一张图**（`apps/one-map`）、**管理后台**（`apps/admin-console`）、**公众端**（`apps/public-portal`）。目录职责、共享层约束与新增端的步骤见 [项目组结构](ARCHITECTURE.md)。

首次获取项目运行 `git clone https://github.com/xiaob22838-dev/jingshan-digital-twin.git`，进入 `jingshan-digital-twin` 后按下方步骤启动。

每项任务从最新的 `origin/main` 建立单独分支。同一台电脑并行编辑时可以使用独立克隆或 `git worktree`。下面的命令创建一个调整企业名录的分支。

```sh
git fetch origin
git switch -c feature/enterprise-directory origin/main
```

提交前运行 `npm run build`，再将任务分支推送到 GitHub 并向 `main` 发起 Pull Request。合并后在本地 `main` 运行 `git pull --ff-only` 同步。

企业名录的可复用数据在 `server/industry-sources/`。Git 同步源码、业务样例和企业数据文件。本机数据库的草稿、已发布版本和后台操作记录保存在各自环境中。

## 本机启动

服务器部署见 [Docker 部署说明](DEPLOY.md) 和 [Windows 部署说明](DEPLOY-WINDOWS.md)。

源码包首次安装时，使用 Node.js 24 和 PostgreSQL for Windows。将 PostgreSQL 的 `bin` 目录加入 PATH，或设置 `PG_BIN` 指向该目录。在项目目录运行 `npm.cmd ci` 安装依赖。

双击 `Start-Dev.cmd`，或运行 `npm.cmd run dev`，然后打开 [京山一张图](http://127.0.0.1:5173/apps/one-map/)。此前的 [湖北产业链大屏](http://127.0.0.1:5173/apps/one-map/hubei.html) 仍可单独打开。旧地址 `/` 与 `/hubei.html` 会自动跳转到新地址。

前端端口为 5173，API 端口为 3001。项目会初始化本机 PostgreSQL 实例（端口 55432，数据库 `web_screen_dev`）。业务数据和发布历史存放在 `.local/pgdata`。Ctrl+C 可停止前端和 API，运行 `npm.cmd run db:stop` 可停止项目数据库。

## 页面与操作

京山大屏默认使用浅蓝驾驶舱。右上角可切换深色布局，浏览器会记住选择。也可用链接参数 `?theme=light` 或 `?theme=classic` 指定版本。

- **一图总览**显示产业家底、当月运营、近期赛事、待办和场地利用率。时间轴可选择赛事，行政区选择器可下钻街镇或社区。
- **产业推介**从「场馆与供给」查看各场馆的场地总数、可用片数、周边居民和测算服务人口。进入「覆盖缺口」后，可筛选人口密集网格、服务圈外网格或圈内场地不足的网格，测试错时开放和每片场地的规划服务人数。选定目标后，「新建选址」只筛选能服务该网格的邻近地块，保留面积和规划约束初筛。「配套招商」可查看赛事热点周围的配套缺口。
- **赛事引流**包括赛前研判、赛中协同、赛后复盘。可切换全市路网和场馆周边。赛前研判将核心区内路段标红，缓冲区内路段标橙，支持按措施筛选、地图定位及导出研判。还可试算保障需求、查看赛中快照、生成任务和发布出行提示。
- **融合发展**从京山赛事场馆出发，按「京山本地／荆门周边（京山以外）／湖北省内（荆门以外）」查看推介线路、行程和合作商家。地图只突出当前线路，动画表示推介方向。左栏按月、季度、年或已办赛事查看到场、消费、票根核销和已报订单；右栏可切换线路、导出范围清单并进入线路管理。
- **京网通**可从页眉或 [公众端入口](http://127.0.0.1:5173/?app=jingwangtong) 打开。出行提示、商家、优惠和线路读取同一套已发布数据。演示预约、报名及领取记录保存在浏览器。
- **地图**远景按街镇汇总，中景聚合场馆，近景显示单片场地多边形和球场线。支持量测、圈选统计，以及按主题或部门浏览图层。左右面板可独立收起，地图工具栏的「铺满地图」可一次收起两栏。

## 时空大数据管理平台

驾驶舱右上角菜单可打开独立后台。开发入口为 [时空大数据管理平台](http://127.0.0.1:5173/apps/admin-console/)，[工作区版后台](http://127.0.0.1:5173/apps/admin-console/workspace/) 与之并存。后台与驾驶舱共用 PostgreSQL。公众端骨架位于 [公众端](http://127.0.0.1:5173/apps/public-portal/)，模块待开发。

- **资源目录**可检索空间数据、业务表单和地图服务，切换卡片或列表，按目录和协议筛选。可以创建多级专题，将同一资源纳入多个专题，并设置访客目录可见性。收藏保存在当前浏览器。资源卡片封面用于识别类型，进入地图预览可读取图层的实际内容。
- **空间数据与地图服务**支持编辑记录、导入预检、检查位置和字段、接入及检测服务。内部托管的空间数据随版本发布，可通过 `GET /api/jingshan/layers/{数据集ID}/features.geojson` 访问。服务实例的状态和地址在「服务管理」维护，停用或移除前可查看已发布版和草稿的场景引用。接入外部 GeoJSON 或 ArcGIS FeatureServer 时，在 `CIM_FEATURE_ORIGINS` 中登记可信来源。FeatureServer 使用支持 Query、数字对象编号和 WGS84 GeoJSON 输出的单个图层地址。
- **地图预览**从资源卡片进入后载入所选资源。在右侧「图层控制」选择另一图层并点击「叠加」，可继续加入多个图层，分别调整显隐与不透明度。点击矢量要素、人口网格或具备属性的模型构件可查看属性。测距工具按点击顺序累计距离，「全图」回到主资源范围。
- **空间文件与影像**在「空间数据」导入 WGS84 GeoJSON、带经度和纬度列的 CSV、单图层 Shapefile ZIP 及单要素表 GeoPackage。投影坐标的 SHP 随附 PRJ，中文属性可附 CPG。GeoPackage 支持 EPSG:4326 和 EPSG:3857 的二维点、线、面及多面。单文件 18 MiB、单数据集 12,000 条。GeoTIFF、COG、IMG 或 MBTiles 可先在已有 GIS 引擎发布为 WMS、WMTS 或 XYZ 后接入。3D Tiles 使用模型服务的 `tileset.json` 地址，本机已登记中心城区白模及两处网球中心模型。
- **业务表单**可设计字段、设置校验、直接编辑数据，支持 Excel 模板、批量导入预检和筛选导出。已有的产业经营、采购、场馆月报及赛后实绩沿用原业务字段。
- **一张图配置**先选全图默认或具体场景，再为底图、边界、道路、模型和业务图层选择数据源。点「保存草稿」，核对后发布或提交审批。绑定随版本持久化，历史版本可载入草稿。地图显示和统计台账分别配置，支持将 WFS、GeoJSON 和 ArcGIS 要素映射、核对并合并到草稿。
- **平台治理**提供发布审批、账号与角色、版本备份、数据库占用、最近一次服务检测状态及可导出的操作记录。「接口中心」可以实际请求已发布目录、数据、地图服务及健康接口。目录 API 支持 `q`、`type`、`page`、`pageSize`。
- **认证部署**沿用 HTTP Basic 和原有 `APP_USER` / `APP_PASSWORD`。生产静态部署启用认证，开发时可用 `PLATFORM_AUTH=1` 启用。管理员可以创建、停用账号和分配角色。数据维护员可以保存草稿、提交审批，审批员可以处理他人提交的版本。访客进入已发布资源目录和地图预览。发布版本、变更记录及账号权限由服务端校验。

荆门市 2026 年 0.5 米影像使用市大数据能力平台的 `JMS2026N05MYX/1` 资源。在本机 `.env` 配置完整网关地址 `JINGMEN_DSC_SERVICE_URL`、应用 `JINGMEN_DSC_APP_KEY` 和 `JINGMEN_DSC_APP_SECRET`，重启 API。打开「时空大数据管理平台 → 服务管理」可复测。服务端通过已配置的网关取得 WMTS 描述，并验证京山样点瓦片。验证通过后，可在驾驶舱「地图图层」中勾选该影像。业务码 `100107` 表示网关未找到该应用的资源授权信息。

在已接入 CIM 的开发环境中，在本机生成的 `.env` 设置 `CIM_SERVICE_ORIGIN` 为服务根地址，重启 API 后会初始化清单中的 13 项服务。需要使用固定证书时，将 `CIM_TLS_ORIGIN` 设置为已核准的同一 HTTPS 根地址，并在 `CIM_TLS_SHA256` 填入核准的指纹。首次克隆可以直接运行公开数据；内网地址和证书配置由各开发环境单独提供。

GeoJSON 使用 WGS84 和经度在前的坐标顺序。文件应为 `FeatureCollection`，每个要素应有唯一 `id` 和 `properties.name`、`region`、`kind`。可导出现有数据集查看字段样例。

| 数据集 ID | 几何和常用分析字段 |
| --- | --- |
| `courts` | 逐片 Polygon 或 MultiPolygon，`kind: court`，`facilityId`、`facilityName`、`courtCode`、`ownership`、布尔型 `open` |
| `venues` | 场馆面或点，场馆 ID 与赛历 `venueId` 对应 |
| `population` | 人口网格面，数值型 `population`、`youth` |
| `events` | 赛事位置，`date` 为 YYYY-MM-DD，保留 `attendance`、`visitors`、`venueId`、`level`、`status` |
| `hotels`、`parking`、`medical` | 酒店 `beds`、`available`，停车场 `spaces`、`available`，医疗 `minutes` |
| `parcels`、`constraints` | 面。地块 `area`（㎡）、`ownership`、`use`、`roadAccess`，约束 `constraint` 为永久基本农田、生态保护红线或城镇开发边界 |
| `businesses`、`projects` | 经营主体 `segment`（上游/中游/下游）与 `subtype`，项目 `progress`、`status`、可选 `parcelId` |
| `merchants`、`offers`、`route_packages` | 商家、票根优惠、线路套餐。线路 `scope` 取京山、荆门、湖北，使用从京山场馆到目的地的 LineString，可配置 `from`、`to`、`days`、`travelMinutes`、`price`、`itinerary` 与 `merchantIds`。优惠的 `merchantId` 对应商家 ID |
| `operations_monthly`、`venue_operations`、`event_live` | 月度运营、场馆利用率、赛中快照，按导出样例保留 `month`、`venueId`、`eventId` 和 `asOf` 等字段 |
| `administration` | 行政区面，`kind` 为 city-boundary 或 town-boundary，乡镇 `name` 与其他图层的 `region` 一致 |
| `road_network` | 可新建并发布以替换内置参考路网。使用 LineString 或 MultiLineString，填道路名 `name`、编号 `ref`、道路等级 `highway`、可选道路宽度 `widthM`（米） |
| `event_road_controls` | 可新建并发布核定路段。使用 LineString 或 MultiLineString，填写 `eventId`、`controlStatus`（closed、restricted、diversion），可填 `venueId`、`sectionCode`、`sectionName`、`startAt`、`endAt` |

## 数据口径

网球场地覆盖按人口网格中心到场馆的直线距离和当前出行方式的近似半径测算。场馆规划容量为可用场地片数乘以每片规划服务人口。居民在可达场馆的容量范围内分配，跨场馆总量去重。人口密集区以全市有面积且有人口网格的密度第 75 百分位为阈值。选址按目标网格中心与候选地块中心的距离筛选，可缓解人口为服务半径内的缺口估算，并受拟建片数约束。测算结果供规划比较，地块用途、权属和实地通行条件需核实。

融合发展用 `route_packages.ordersByMonth` 汇总月份订单。按赛事读取 `ordersByEvent[赛事 ID]`，或读取同一 `eventId` 记录的 `eventOrders`；票根核销相应使用 `redemptionsByEvent` 或 `eventRedemptions`。未报送与明确的零分开显示。已报订单占比说明预订去向，不能代替景区实际到访。月度网旅估算消费与票根核销来自 `operations_monthly`，单场消费和到访来自已办赛事回报，不能把月度经营表现归因到一场赛事。内置演示样例为「京山网球公开赛」补了明确归属的订单和核销记录。

运行 `node scripts/jingshan-v3-seed.mjs` 可重新生成样例。生成文件可以通过数据中台载入，发布后应用到已初始化的数据库。运营样例截至 2026-11-13，后续赛事的现场数据标为演练。覆盖率使用配置半径的距离近似，协同结果存入本地台账。参考路网来自 OpenStreetMap 快照，近景路面宽度按等级估算。模拟管控区和建议路段由赛事及场馆位置计算，源数据缺失的路名以编号和方位显示。发布核定路段后，对应赛事和场馆优先使用已发布方案。底图、区划及路网来源与许可见 [sources.txt](http://127.0.0.1:5173/jingshan/sources.txt)。

运行 `npm.cmd run build` 检查类型并构建前端。京山前端位于 `src/jingshan`，数据与协同接口位于 `server/jingshan.ts`。API 与数据库提供保存、发布和协同功能，启动时与前端一同运行。
