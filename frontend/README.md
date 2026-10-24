# 拾集前端

基于 React、TypeScript、Vite 和 React Router 构建的桌面端商城界面。

提供商品浏览、搜索、分类与价格筛选、排序、分页和快捷工具栏。商品卡片进入正式详情页，可查看图集、切换规格、调整数量并查看价格库存；刷新保留选择，返回列表保留条件与浏览位置。店铺、购物车及账号等入口仍打开随附的 HTML 交互原型。详情购买按钮暂不可用。

## 本地运行

在 frontend 目录执行：

```bash
npm ci
npm run dev
```

访问 [本地预览](http://127.0.0.1:5173/#/buyer)。Node.js 版本要求见 [package.json](package.json)。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| npm run dev | 启动开发服务 |
| npm run build | TypeScript 检查与生产构建 |
| npm test | 运行商品查询、分页、SKU 与库存等逻辑测试 |
| npm run preview | 预览生产构建 |

## 数据配置

默认使用本地模拟数据。将 [.env.example](.env.example) 复制为 .env.local 后，可以调整：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| VITE_DATA_SOURCE | mock | 设置为 api 时请求商品查询接口 |
| VITE_API_BASE_URL | /api/v1 | API 请求地址前缀 |

开发服务将 /api 请求代理至 http://127.0.0.1:8080。接口结构见 [OpenAPI](../docs/openapi.json)。

## 目录

| 目录 | 内容 |
| --- | --- |
| src | 页面、组件、样式与数据访问代码 |
| assets | 原始图片素材 |
| demo | HTML 交互原型与导出脚本 |
| scripts | 静态资源同步脚本 |
| public | 开发与构建使用的静态资源 |

开发和构建前会自动将商品图片及交互原型同步到 public/images 和 public/prototype。
