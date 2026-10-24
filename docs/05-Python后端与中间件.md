# Python / FastAPI 后端与中间件能力

更新日期：2026-10-20  
状态：后续 Python 版本的能力参考。用户已选择首版 Java / Spring、后续迁移 Python；当前 Agent 暂不开发，仅预留查询 API 契约。本文不作为当前商城实施方案，也不表示全部组件已纳入首版。

## 1. 能否接入

可以。FastAPI 提供 Web 接口与请求处理机制，Python 客户端、SDK 和独立工作进程可以连接消息服务、云存储与其他基础设施。

| 能力 | 实现方式 | 拾集中的用途 |
| --- | --- | --- |
| 消息队列 | RabbitMQ 等消息服务，Python 生产者和消费者；任务分发可配合 Celery | 通知、图片处理、长时间 Agent 任务 |
| 阿里云 OSS | 阿里云官方 Python SDK，封装为存储服务 | 商品图片、店铺 Logo、头像 |
| 全局请求处理 | FastAPI / ASGI Middleware | 请求 ID、日志、耗时、跨域处理 |
| 接口访问检查 | FastAPI Depends / Security，结合业务服务 | 获取当前用户、角色校验、店铺与资源归属校验 |
| 登录令牌 | PyJWT 等成熟库签发和校验 JWT；另外设计刷新与撤销策略 | 登录、访问认证与登录状态管理 |
| 统一异常处理 | FastAPI exception handler | 将业务异常转换为稳定错误码与响应 |

这些组件职责不同：消息队列是消息基础设施，OSS 是存储服务，JWT 是令牌格式，Middleware 是请求处理机制。均可进入同一个商城后端架构，不要求都实现成 Middleware。

## 2. 拦截器与认证怎么对应

如果以 Spring 的拦截器作参照，FastAPI 通常组合使用以下机制：

- Middleware：全局请求和响应处理。
- Depends / Security：按接口或路由组声明身份和权限要求。
- 业务服务：校验当前用户是否拥有目标店铺、商品或订单。
- Exception handler：统一返回错误信息。

例如“商家修改商品”需要先验证登录令牌，再检查店铺成员关系和商品归属。令牌有效不代表拥有所有商家资源权限。
JWT 签名不等于加密，载荷不保存密码或密钥；刷新、退出、撤销和权限变更后的行为需要业务设计。

Cookie 会话与 JWT 均为可选认证方案。JWT 也可以通过 Cookie 传输；令牌格式与浏览器存储、传输方式是不同选择。Java 首版确定认证行为后，Python 版本需保持相应契约兼容。

## 3. 引入消息队列后的运行结构

```text
Web 前端 → FastAPI 商城 API → PostgreSQL
                      ├→ OSS 存储服务 → 阿里云 OSS
                      ├→ Agent 模块 → 模型 API
                      └→ 消息生产者 → RabbitMQ → 独立 Worker
```

RabbitMQ 负责传递消息；Celery 是可选任务队列框架，提供任务分发等能力，Worker 负责实际执行。RabbitMQ 与 Celery 的职责不同。
上图中的 Agent 仅为未来扩展示意，当前不实施。以后启用时再决定是否与 Python 商城合并进程；消息服务和 Worker 按需要独立部署。当前 Java 首版见 [技术方案](02-技术与Agent方案.md)，预留范围见 [Agent 接口预留](11-Agent接口预留.md)。

消息队列接入后仍要处理失败重试与重复消费。订单与库存的核心状态由数据库事务保证；消息不能自动解决数据库提交与发消息之间的一致性。需要可靠业务事件时，可将待发送事件与业务状态一起写入数据库，再由发布进程投递，消费方保持幂等。

超时关闭以数据库截止时间与状态为准。可以后续增加任务队列触发，但仍保留数据库补偿扫描；首版既有的扫描 Worker 方案继续有效。FastAPI BackgroundTasks 不代替可靠队列与持久化任务。

## 4. 后续 Python 版本的接入参考

1. 基础阶段：认证授权、日志与统一异常、商品与订单、数据库事务。
2. 存储阶段：封装图片存储接口，接入 OSS，核验对象归属与上传限制。
3. 异步任务阶段：选一种消息队列，增加独立 Worker、重试、幂等与任务状态。
4. Agent（未来候选，暂缓）：仅在用户以后启用时复用受限业务服务；长任务确有需求时再进入 Worker，不是 Python 商城迁移的前置条件。

Java 首版先形成对应能力和接口约定；后续 Python 版按需要实现兼容替代。若希望重点练习消息队列和云服务，可另定里程碑；目前不自动扩大 P0。
OSS 使用所需权限的凭证并保存在服务端，不把长期 AccessKey 发给浏览器。此说明不表示已开通云资源或产生费用。

## 5. 官方依据

- [FastAPI Middleware](https://fastapi.tiangolo.com/tutorial/middleware/)：请求前后处理与执行顺序。
- [FastAPI Dependencies](https://fastapi.tiangolo.com/tutorial/dependencies/)：依赖注入与身份、角色要求。
- [FastAPI JWT 教程](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)：PyJWT、签名、过期校验与密码哈希。
- [FastAPI 异常处理](https://fastapi.tiangolo.com/tutorial/handling-errors/)：自定义异常处理。
- [RabbitMQ Python 教程](https://www.rabbitmq.com/tutorials/tutorial-one-python)：Python 生产者和消费者。
- [Celery 入门](https://docs.celeryq.dev/en/stable/getting-started/first-steps-with-celery.html)：Broker、任务与 Worker。
- [阿里云 OSS Python SDK](https://www.alibabacloud.com/help/en/oss/developer-reference/2-0-manual-preview-version/)：官方 SDK 和客户端接入。
- [OSS Python 上传文件](https://www.alibabacloud.com/help/en/oss/developer-reference/simple-upload-using-oss-sdk-for-python-v2)：上传操作与权限。
