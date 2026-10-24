# 拾集 · shiji

个人开发的多商家商城项目。前端采用 React + TypeScript + Vite，后端计划使用 Java / Spring；覆盖买家购物、商家经营与平台管理，Agent 暂不开发。

当前按批次实现：**第 1 批仅前端基础与买家首页，后端未实现。** 具体执行与验证结果见 [分批进度](docs/18-分批开发进度.md)，现有完整 HTML 原型不等同于正式业务实现。

## 目录

| 目录 | 职责 |
| --- | --- |
| [frontend](frontend/README.md) | 所有前端内容：React 源码、图片素材、HTML 原型和前端脚本；独立依赖与启动构建 |
| [backend](backend/README.md) | Java / Spring 后端预留；本批仅说明 |
| [docs](docs/09-原型进度与文档维护.md) | 产品决策、数据库评审、OpenAPI 和执行记录 |
| scripts | 本机 JDK/Maven 与历史可选工具入口 |

前端相关文件全部归入 frontend；根目录 docs 为共用文档，scripts 与 compose.yaml 为共用环境工具。前后端在同一个仓库中分目录、分依赖、分启动；前端不直接连接数据库。正式仓库为 [kitty191/shiji](https://github.com/kitty191/shiji)。

## 当前边界

沿用暖橙、局部毛玻璃、内容最大 1280px、四列方向、分类价格在上/排序独立在下、首页不显示总数、右侧收放工具栏。首版仅桌面，当前保留每页 12 件，不新增滚动续载或 Agent。

复用本机已有 JDK 21 / Maven / Node、MySQL 与 Redis；Docker 工具镜像仅备用，不重复下载安装数据库。项目数据库账号/空库仍待配置，不一次性创建 28 张候选业务表。凭证和运行数据不进入 Git。

接口以 [OpenAPI](docs/openapi.json) 为主，业务依据见 [决策记录](docs/04-决策记录.md)，环境说明见 [本地开发环境](docs/17-本地开发环境.md)。

## 第 1 批运行与验证

已安装并锁定前端依赖，初建时离线 npm ci 复现通过；2026-10-24 第 1 批缺陷修正后，TypeScript/生产构建和 7 项逻辑测试通过。浏览器与契约样本验证的范围及限制见 [分批进度](docs/18-分批开发进度.md#4-2026-10-24-第-1-批缺陷修正)。

从项目根目录进入前端，以下命令已实际执行：

```bash
cd frontend
npm run dev
```

浏览器打开 http://127.0.0.1:5173/#/buyer；停止时按 Ctrl+C。实际开发预览检查结束后已停止，本项目不会自动后台运行。

构建与测试在 frontend 内分别运行 npm run build、npm test。全新检出时使用 npm ci 安装锁定依赖；本轮已执行 npm ci --offline 从缓存验证。前端环境配置见 [前端说明](frontend/README.md)，Java 后端暂未实现。
