# 数智京山网球产业一张图 V3 Docker 部署

适用于装有 Docker Engine 和 Docker Compose v2 的 Linux 服务器。首次构建需要访问 Docker Hub 和 npm 仓库。应用镜像由当前源码在服务器上构建，镜像包含京山大屏、API、京网通预览、Cesium 资源、参考路网和演示数据。

## 启动

解压部署包，在含有 `compose.yaml` 的目录执行：

```sh
cp docker.env.example docker.env
chmod 600 docker.env
```

编辑 `docker.env`。设置 `APP_USER` 和至少 12 字符的 `APP_PASSWORD`，再设置一个独立的 `POSTGRES_PASSWORD`。可分别运行两次 `openssl rand -hex 24` 生成密码。默认通过 `127.0.0.1:8080` 访问，若 8080 被占用，可改 `APP_PORT`。

```sh
docker compose --env-file docker.env up -d --build --wait
docker compose --env-file docker.env ps
curl -fsS http://127.0.0.1:8080/api/health
```

健康接口应返回 `{"ok":true}`。首次打开大屏时会初始化当前版演示数据。

## 访问

- 临时验收可通过 SSH 转发。在访问者自己的电脑运行 `ssh -L 8080:127.0.0.1:8080 user@服务器地址`，保持连接，然后用浏览器打开 `http://127.0.0.1:8080/`。
- 长期使用时，在服务器的 Nginx、Caddy 或已有网关配置 HTTPS，反向代理到 `127.0.0.1:8080`，保留浏览器发来的 `Host` 请求头。上传 GeoJSON 时，代理请求体限制建议至少为 20 MB。若代理自身也是容器，可将其接入 Compose 网络并转发到 `web:3000`，同样保留 `Host`。
- 浏览器弹出登录框时输入 `APP_USER` 和 `APP_PASSWORD`。同一账号可访问大屏、数据中心、API 和京网通预览。对外使用 HTTPS，并保持 PostgreSQL 端口未映射。

| 路径 | 页面 |
| --- | --- |
| `/` | 京山政务大屏 |
| `/?app=jingwangtong` | 京网通预览 |
| `/hubei.html` | 湖北产业链大屏 |

## 数据与升级

草稿、发布历史及协同台账存放在 PostgreSQL 18 卷 `postgres_data`。重建应用容器会继续使用该卷。部署包使用演示数据初始化，新环境可通过数据中心导入业务配置并发布。有多个部署目录时可用 `docker compose -p <项目名> --env-file docker.env …` 管理独立卷。

从已有版本升级时，保留服务器上的 `docker.env`，覆盖源码和部署文件，再执行上面的启动命令。

### 备份与迁移

服务器数据库逻辑备份：

```sh
docker compose --env-file docker.env exec -T db pg_dump -U jingshan -d jingshan --no-owner --no-privileges > jingshan-backup.sql
```

迁移原 Windows 环境时，可以从本机数据中心导出 JSON，再到服务器数据中心导入、保存和发布。需要同时迁移草稿、历史版本及台账时，从源数据库用 `pg_dump --no-owner --no-privileges` 导出完整逻辑备份。在服务器上仅启动空数据库，先导入备份，再启动应用：

```sh
docker compose --env-file docker.env up -d --wait db
docker compose --env-file docker.env exec -T db psql -v ON_ERROR_STOP=1 -U jingshan -d jingshan < jingshan-backup.sql
docker compose --env-file docker.env up -d --build --wait
```

以上恢复命令适用于空数据库。数据库首次建卷时读取初始口令，已有实例轮换口令需要同时更新数据库角色口令和 `docker.env`。

### 日志和停止

```sh
docker compose --env-file docker.env logs --tail=100 web db
docker compose --env-file docker.env down
```

普通 `down` 保留持久卷。带 `-v` 的停止命令会删除该项目数据库卷。
