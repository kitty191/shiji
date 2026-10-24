# 拾集 · Docker 容器开发

更新日期：2026-10-23  
状态：D072 优先复用现有环境，前端暂停。MySQL / Redis 使用 Mac 已有服务；Docker 仅保留已下载的可选开发工具，当前不配置数据库、前端或 Agent 容器。

## 1. 当前 Compose

[compose.yaml](../compose.yaml) 只含 tools profile 的 java-tools / node-tools，固定此前已验证的 Maven/JDK 21 和 Node 24 镜像摘要，按需输出版本后退出。pull_policy: never 禁止自动下载，缺少缓存则报错；不发布端口，不注入数据库密码。默认无常驻应用服务。

## 2. 本机数据库

复用原 MySQL / Redis，不把宿主机程序当成容器镜像，也不将旧数据目录挂给其他版本。项目账号与独立开发库尚未配置，不需要为此另装数据库。当前不执行 DDL、清库、数据迁移或删除卷。

## 3. 文件与检查

当前 Compose 使用空 env-file，不读取本机 .env 或 D071 废弃的 .env.docker。检查入口为 ./scripts/dev compose --profile tools config --quiet；其他本机环境入口见 [本地开发环境](17-本地开发环境.md)。本轮仅做语法、配置与文档检查，没有运行工具容器或重新检查数据库。

## 4. 镜像与 Docker 登录

本地已有镜像可以重复使用；本机已安装程序可以直接运行。只有明确需要的容器缺少对应镜像时才考虑获取镜像。Docker Hub 公开镜像允许匿名拉取，受额度限制；私有仓库需访问权限，Docker 登录与本机执行权限不同。[官方说明](https://docs.docker.com/docker-hub/usage/pulls/)

## 5. D071 撤回记录

已移除刚加入的 mysql / redis / frontend 定义、初始化和启动快捷入口、公共凭证模板及 Demo 静态服务脚本。原 Demo 和本机已有数据完整保留；未使用的私有 .env.docker 留在本机并由 Git 忽略，当前不再读取。

此前数据库镜像下载请求被拒绝，未下载/启动，因此没有本项目新数据库或前端容器需要删除。未删除任何既有镜像、卷、数据库、凭证或服务。

## 6. 后续

用户进一步要求直接使用已有 JDK；Java 开发和运行默认使用本机 JDK 21 / Maven，Docker 作为备用，不要求后端写好就自动迁入容器。已下载镜像保留，不重新下载或删除。

当前只推进既有环境的连接准备；前端后续再做。若以后需要其他容器，再根据功能和现有缓存配置，不默认添加消息队列、推荐、Agent 或额外数据库。

## 7. 已验证与未验证

D070 的 Docker / hello-world / 工具容器运行记录保留。D072 的脚本和 Compose 静态解析已检查；本机项目数据库认证、开发库与商城业务仍未验收。

## 8. Ubuntu 主机安装与核验指引（P044，历史自有环境）

D069 已切换为普通云服务器。本节保留旧 Ubuntu 的安装、失败及排查记录，不继续推进旧代理方案；云端安装方式待具体系统与镜像源核对后另列，不直接复制旧环境版本作为验收结果。

最新结果（2026-10-21）：用户粘贴输出确认 Docker Client/Server 均为 29.1.3（Ubuntu 包 29.1.3-0ubuntu3~24.04.2）、Compose 为 2.40.3+ds1-0ubuntu1~24.04.1，平台 linux/amd64，服务端 API 可响应；Buildx 版本与自启动尚未确认。hello-world 首次输出本地没有镜像后被 ^C 中断；后续完整错误确认 Docker Hub 域名对应目标的 HTTPS 连接被拒绝（connection refused），未能下载镜像。具体是解析异常还是网络路径/过滤问题仍待核对，尚无测试容器成功。因此当前状态为“软件与 API 已确认，仓库访问失败待排查”。

2026-10-21 已通过用户截图确认 Ubuntu 24.04.5 LTS x86-64 和 Mac SSH 登录。下一阶段安装 Docker / Compose，先使用 Ubuntu 软件仓库中的 `docker.io`、`docker-compose-v2` 和 `docker-buildx`，复用当前已能获取索引的软件源。此为个人开发环境的实施建议，不把发行版包称为 Docker 厂商的 docker-ce 包；不混装两套来源，也不使用旧版 Python docker-compose。具体安装版本在用户运行成功后记录。[Ubuntu Docker 说明](https://ubuntu.com/server/docs/how-to/containers/docker-for-system-admins/)、[Ubuntu Compose v2 包](https://packages.ubuntu.com/search?keywords=docker-compose-v2)

下列步骤在已连接 Ubuntu 的 SSH 终端中逐条执行；原始指引仅核对了官方文档与包信息；后续用户提供的实际结果见本节顶部，不代表所有步骤均执行或验收。若已另外安装过 Docker CE / Snap / Podman 或发生包冲突，先核对现状，不默认卸载现有运行时或数据。

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 docker-buildx
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo docker buildx version
systemctl is-active docker
sudo docker run --rm hello-world
```

`docker version` 应同时列出 Client 与 Server，Compose / Buildx 应返回各自版本，服务检查应为 active。hello-world 会从镜像仓库拉取测试镜像，执行后退出并移除本次测试容器；成功显示 Hello from Docker 才记为此次测试通过。软件包下载、Docker 守护进程启动、镜像仓库访问和容器运行分别判断，不因 Docker Hub 超时就直接重装 Docker。不凭主机软件安装视为商城容器启动或业务验收。

本轮保持 `sudo docker`，不自动把账号加入具有主机高权限的 docker 组，不开放 Docker TCP 管理接口。之后根据实际工程编写 Compose 配置、锁定应用镜像/依赖并处理日志容量；当前不创建数据库、业务容器或 Agent。systemctl 自启只作用于 Linux 内的 Docker，不代替 Windows/虚拟机的自动启动。

此前容器规划的官方资料核对日期为 2026-10-17；本节安装资料于 2026-10-21 核对。当前已确认一次 Mac 到 Linux SSH 登录，Docker/Compose 版本已获用户输出，Buildx、自启及测试容器仍待反馈。


### 首次镜像拉取的当前排查

`Unable to find image ... locally` 表示本地镜像缓存中没有目标，不等于远程仓库不存在或 Docker 安装失败。Docker run 默认在需要时拉取镜像；首次输出的 ^C 表示命令被中断；后续已收到明确连接错误，见下方新增记录。[run 行为](https://docs.docker.com/reference/cli/docker/container/run/)

建议先拆开验证，用户在当前 SSH 会话执行：

```bash
sudo docker pull hello-world:latest
```

成功出现 Downloaded newer image 或 Image is up to date 后再执行 `sudo docker run --rm hello-world`。如拉取等待较长或报错，取完整错误再排查，不默认改镜像站、禁用 TLS、重装 Docker 或把镜像访问异常归因于 Tailscale。当前没有确认镜像已下载或容器成功运行。[pull 说明](https://docs.docker.com/reference/cli/docker/image/pull/)


2026-10-21 后续：用户提供 `failed to resolve reference` 完整错误，底层为向解析所得目标的 TCP 443 连接被拒绝，不能把外层措辞直接当作域名不存在。Docker API 已响应，当前失败发生于下载前的仓库访问阶段。当时先提供下列只读检查；后续结果见本节末尾：

```bash
getent ahostsv4 registry-1.docker.io
resolvectl query registry-1.docker.io
curl -I --connect-timeout 10 --max-time 15 https://registry-1.docker.io/v2/
```

依据解析来源和 HTTPS 响应再区分域名解析、网络过滤或代理路径；不直接硬编码仓库 IP，不盲改系统 DNS 或容器 DNS。若后续确需代理，镜像拉取使用守护进程代理配置，不能假定 Mac 或终端代理自动适用于 Ubuntu Docker 服务。[守护进程代理说明](https://docs.docker.com/engine/daemon/proxy/)


后续解析核对：用户输出显示系统经 ens33 从网络取得 A/AAAA 记录，但 HTTPS 在 10 秒内连接超时。返回地址结合前一次连接目标变化可疑，优先排查 DNS 返回异常；尚未通过独立解析器对照，不把污染来源或具体网络设备写为已定位。下一步在 Ubuntu 执行 `resolvectl status` 查看 DNS 来源，并用 `nslookup registry-1.docker.io 223.5.5.5` 做指定解析器对照；若 nslookup 未安装，先反馈缺失，不自动安装或改配置。普通 DNS 查询仍可能被链路影响，结果不同不直接证明更换 DNS 即可访问 Docker Hub。


DNS 来源核对结果：用户输出显示外部域名使用 ens33 上的 VMware NAT DNS 转发地址；Tailscale 列出的域名主要为其内部名称与反向解析路由，当前证据不支持归因于 Tailscale。指定公共解析器的普通 DNS 查询多次超时，未取得可比较的回答；不能据此断言该公共服务故障或 VMware 配置损坏。随后提供普通 HTTPS 与经 HTTPS 的 DNS 查询测试；用户已反馈第一条返回 HTTP/1.1 200 OK，第二条后续反馈为连接失败（curl 7），未取得 DNS JSON 回答：

```bash
curl -I --connect-timeout 5 --max-time 10 https://www.baidu.com
curl -sS --connect-timeout 5 --max-time 10 --resolve cloudflare-dns.com:443:1.1.1.1 -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=registry-1.docker.io&type=A'
```

第二条仅对本次查询指定解析服务连接地址，保留 TLS 证书验证，不修改系统 DNS 或 Docker Hub 的地址。若该端点也超时，仍需结合宿主机网络/代理核对，不把单个站点超时视为整体断网。[Cloudflare DoH JSON 文档](https://developers.cloudflare.com/1.1.1.1/encryption/dns-over-https/make-api-requests/dns-json/)

最新验证：Ubuntu 访问百度 HTTPS 返回 200，确认该站点可达，不能据此推定 Docker Hub 或所有 HTTPS 站点可达。用户后续已切换手机热点，Docker Hub 拉取仍连接被拒绝，不能仅归因于校园网；加密 DNS 连接同样失败。用户起初反馈仅 Mac 有代理，后续补充 Mac 使用 Shadowrocket，Windows 已下载 Clash 但未打开；Windows 客户端具体版本、安装/订阅可用性及代理端口待核对。镜像拉取及测试容器仍未成功。


下一步建议做网络对照：Windows 暂时从校园网切至手机热点，虚拟机保持运行及原 NAT 设置，在 Ubuntu 执行 `sudo resolvectl flush-caches` 后重试 `sudo docker pull hello-world`。若 SSH 因切网断开，等待 Tailscale 恢复后重连。后续用户已反馈热点下仍连接被拒绝，未拉取成功。原对照判断标准：若成功，只能将问题缩小到原网络及其出口/解析路径，不直接宣称校园网主动封禁。若仍失败，继续核对宿主机代理/虚拟机网络，不据此直接改镜像源或重装。镜像成功拉取后仍需单独运行 hello-world 验证。


代理候选路径（待核对，未配置）：可评估 Ubuntu 经现有 Tailscale 连接 Mac 的 HTTP/混合代理端口，或通过 SSH 转发该端口；先确认 Mac 代理软件、协议、监听与端口并测试仓库 HTTPS，不能直接假设默认端口、开启对所有网卡监听或承诺一定可用。仅 Mac 开代理并不会自动让 Ubuntu Docker 走代理；若采用此路径，镜像拉取需要显式配置 Docker 守护进程，且会依赖 Mac 在线与代理可用。尚未修改任一设备的代理、DNS、防火墙或 Docker 配置。[Docker 守护进程代理](https://docs.docker.com/engine/daemon/proxy/)


用户补充 Windows 已下载 Clash 后，优先评估 Ubuntu → Windows 宿主机代理 → 镜像仓库的路径，减少对 Mac 在线的依赖。当前仅指导先打开 Windows 客户端、确认已有节点可用，再核对 HTTP/混合端口与允许局域网设置；不假定只开 Windows 系统代理就能代理 Ubuntu Docker，也不假定该程序为某个具体 Clash 分支。监听范围、宿主机虚拟网卡地址及防火墙按实际客户端和网络核对后再配置，不关闭防火墙或开放控制 API。[Mihomo 局域网代理配置说明（仅在客户端采用该内核时适用）](https://wiki.metacubex.one/config/general/)

2026-10-22 续接：用户反馈 SSH 重连成功，继续排查镜像下载；先核对 Windows Clash 的具体客户端、节点可用性、HTTP/混合端口和局域网监听设置。尚未收到设置截图或代理连通结果，不假定端口为默认值，也未修改 Docker 代理。
