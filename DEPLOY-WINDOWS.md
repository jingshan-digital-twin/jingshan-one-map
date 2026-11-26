# 数智京山网球产业一张图 V3 Windows 部署

Windows 10/11 可通过 Docker Desktop 启动。Windows Server 可在 Hyper-V 的 Linux 虚拟机内运行同一份 Compose，也可使用下文的 Windows 原生部署。Docker 官方支持范围见 [Docker Desktop Windows 文档](https://docs.docker.com/desktop/setup/install/windows-install/)。

## Windows 10/11 + Docker Desktop

1. 启动 Docker Desktop，使用 Linux 容器模式。
2. 解压，在 `web-screen-dev` 中打开 PowerShell。复制配置模板并填写独立的应用和数据库密码。

```powershell
Copy-Item docker.env.example docker.env
notepad docker.env
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-Docker.ps1
```

端口默认是 8080，修改 `docker.env` 中的 `APP_PORT` 可换端口。浏览器打开 [本机大屏](http://127.0.0.1:8080/)，输入 `APP_USER` 和 `APP_PASSWORD`。停止容器可执行 `docker compose --env-file docker.env down`。数据存放在 PostgreSQL 卷中。备份、恢复和反向代理见 `DEPLOY.md`。

## Windows Server + Linux 虚拟机

启用 Hyper-V 后创建 Linux 虚拟机，在虚拟机内安装 Docker Engine 和 Compose v2。将本包传入虚拟机，按 `DEPLOY.md` 启动。公网入口可在虚拟机内配置 HTTPS 反向代理，或接入已有网关。Docker Desktop 的宿主机支持范围为 Windows 客户端系统。[Docker Windows 常见问题](https://docs.docker.com/desktop/troubleshoot-and-support/faqs/windowsfaqs/) · [Microsoft Hyper-V 来宾系统支持](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/supported-windows-guest-operating-systems-for-hyper-v-on-windows)

## Windows 原生运行

使用已安装的 Node.js 24 和 PostgreSQL。Windows Server 2022/2025 可选 PostgreSQL 18，Windows Server 2019 可选 PostgreSQL 17。从 Git 克隆源码后，先在项目目录执行 `npm.cmd ci` 和 `npm.cmd run build` 生成前端。以下命令以服务器上的 PostgreSQL 已能通过 `psql.exe` 连接为前提。[PostgreSQL Windows 安装器](https://www.postgresql.org/download/windows/)

1. 用 PostgreSQL 管理员连接本机数据库。

```powershell
psql.exe -h 127.0.0.1 -U postgres -d postgres
```

2. 在 `psql` 中创建应用用户、设置密码并创建数据库。

```sql
CREATE ROLE jingshan LOGIN;
\password jingshan
CREATE DATABASE jingshan OWNER jingshan ENCODING 'UTF8' TEMPLATE template0;
\q
```

3. 在 `web-screen-dev` 中复制配置。填写上一步设置的 `PGPASSWORD`，另设至少 12 字符的 `APP_PASSWORD`。若 PostgreSQL 使用其他端口，更新 `PGPORT`。

```powershell
Copy-Item windows.env.example windows.env
notepad windows.env
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Start-Windows.ps1
```

脚本在当前窗口运行，Ctrl+C 停止。浏览器访问 `http://127.0.0.1:8080/`。生产运行可把以下命令注册到服务器现有的服务管理工具，工作目录设为 `web-screen-dev`：

```powershell
node.exe --env-file=windows.env server/index.ts
```

服务器访问建议通过 IIS 或其他已有网关做 HTTPS 反代，目标为 `http://127.0.0.1:8080`，保留浏览器发来的 Host 请求头和原始端口。服务器防火墙只放行对外的 HTTPS 入口。已有业务数据可在原系统的数据中心导出 JSON，然后在新系统导入、保存并发布。
