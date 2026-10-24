# 拾集前端 · 第 1 批

React + TypeScript + Vite，使用本机 Node / npm；与 ../backend 分别管理依赖和启动。

本批：工程基础、公共头部、买家首页、搜索/分类/价格筛选/排序、工具栏收放与返回顶部、加载/失败/空状态、URL 条件恢复；使用契约形状的模拟数据，不连接 MySQL / Redis。

详情、店铺、购物车、账号、消息等入口暂时在新标签页打开现有 HTML 原型。卡片使用“查看详情”，没有假装 React 加购或结算已实现；下一批再迁移详情/规格/购物车。商家与平台随后分批完成。

## 启动与检查

安装/构建/浏览器结果以根目录 README 和 docs/18-分批开发进度.md 的实际记录为准，未执行的检查不算通过。

首次依赖以 package-lock.json 为准；安装在本目录，不在项目根或后端安装 npm 包。准备完成后运行 npm run dev，本机使用 127.0.0.1:5173。npm run build 先做 TypeScript 检查再构建，npm test 检查金额、查询、排序、分页与商品流令牌生命周期规则。

前端源码、原型、图片素材和同步脚本均在本 frontend 目录内。predev / prebuild 从本目录 assets/demo/products 与 demo/index.html 生成 public/images 与 public/prototype，生成目录不提交。商城样式和商品图片均来自此前认可的基线，不调用外部图片服务。

## 数据源

默认 mock。复制 .env.example 为本机 .env.local 后，VITE_DATA_SOURCE=api 可切换公开商品查询，VITE_API_BASE_URL 默认 /api/v1；Vite 将 /api 代理至本机 8080。真实 Java 接口仍未实现，API 模式不是已联调的承诺。

返回使用 Result<T>，code 为名称，金额为整数分，字段使用 snake_case，见 [OpenAPI](../docs/openapi.json)。P035 商家自填展示价的筛选/排序仍待定，本批默认样例全部采用 AUTO，未擅自冻结该规则。API 返回 MERCHANT 时仍按原值显示，不根据 SKU 差价添加“起”；AUTO 的在售区间价格保留起价标识，SOLD_OUT 显示“已售罄 · 价格仅供参考”并保留查看详情入口。

公开商品查询收到非空 feed_token 后，在当前 Hash URL 中替换保存；翻页、刷新、浏览器前后退继续携带，改变筛选、排序或 page_size 时重建。令牌补入当前历史项不会额外查询一次；FEED_EXPIRED 提示刷新商品列表，保留条件并从第一页重新查询。默认 mock 的令牌只作固定样本，不代表服务端推荐上下文已实现。

2026-10-24 已修复价格重置后的错误残留，7 项测试与默认/API 模式构建通过；浏览器契约样本验证不代表 Java 后端联调，见 [分批进度](../docs/18-分批开发进度.md#4-2026-10-24-第-1-批缺陷修正)。

## 目录归属

- src：正式 React 源码。
- assets：前端原始图片素材。
- demo：保留的 HTML 交互原型及导出脚本。
- scripts：前端素材同步脚本。
- public：构建前生成的静态资源。

共用接口和业务文档保留在根目录 docs，后端保留在 backend。
