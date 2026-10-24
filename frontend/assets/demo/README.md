# 演示商品图片

整理日期：2026-10-18

这组图片由内置 **imagegen** 生成，用于“拾集”桌面交互原型。它们是原创的虚构商品视觉，不是真实商家提供的商品照片，不表示对应实物、品牌、性能或售卖承诺。当前没有引用淘宝素材或第三方商品照片。

最终使用文件保存在本目录的 products 文件夹，已转为 480×480 JPEG 以便内嵌预览；只做尺寸与编码优化，没有重新绘制内容。会话原型内嵌这些优化文件，不依赖私人绝对路径。原图保留在工具默认输出中，仓库使用下列文件即可。

| 文件 | 演示用途 |
| --- | --- |
| [keyboard.jpg](products/keyboard.jpg) | 米白无线键盘款式 |
| [lamp.jpg](products/lamp.jpg) | 白色折叠台灯款式 |
| [box.jpg](products/box.jpg) | 米色桌面收纳盒 |
| [mug.jpg](products/mug.jpg) | 米白陶瓷杯 |
| [bag.jpg](products/bag.jpg) | 深橄榄绿通勤包 |
| [pencil-case.jpg](products/pencil-case.jpg) | 原色帆布笔袋 |
| [mat.jpg](products/mat.jpg) | 深灰加宽鼠标垫 |
| [notebook.jpg](products/notebook.jpg) | 暖橙色记事本 |
| [bottle.jpg](products/bottle.jpg) | 浅蓝随行水杯 |

未逐规格生成不同颜色图片。详情页说明颜色以所选规格为准，局部放大是同一图片的放大显示，不冒充独立拍摄的细节图。正式工程应使用与实际商品和 SKU 对应的素材。

## 生成提示词

使用内置工具分别生成 9 个独立素材，没有调用 CLI 或配置 API Key。每张提示词由下面的公共前缀、对应 Subject 以及公共后缀拼接。

公共前缀：

    Use case: product-mockup. Asset type: one square product photograph for a fictional e-commerce demo. Subject:

各文件的 Subject：

    keyboard:
    Compact unbranded ivory wireless computer keyboard, tactile matte keycaps, three-quarter overhead view.

    lamp:
    Unbranded white folding desk lamp with a slim straight adjustable arm, circular weighted base and narrow horizontal LED head, three-quarter front view.

    box:
    Small unbranded beige desktop organizer with three compartments and a shallow drawer, three-quarter front view.

    mug:
    Unbranded matte ivory ceramic coffee mug with round handle, no drink or steam, three-quarter view.

    bag:
    Unbranded compact dark olive green everyday backpack, woven fabric, front pocket and padded straps, three-quarter view.

    pencil-case:
    Unbranded natural canvas zip pencil pouch, beige fabric and bronze zipper, closed, three-quarter view.

    mat:
    Unbranded extra wide charcoal gray rectangular desk mouse mat, neat stitched edge, no mouse, three-quarter overhead view.

    notebook:
    Unbranded small warm orange cloth-bound notebook with elastic band, closed, three-quarter overhead view.

    bottle:
    Unbranded matte pale blue 500ml reusable water bottle with matching screw cap, three-quarter view.

公共后缀：

    Photorealistic studio catalog photography, realistic materials, soft light from upper left, gentle contact shadow, seamless warm light-gray backdrop, object centered and entirely visible with generous margins on every side, consistent neutral catalog style. No text, no logos, no watermark, no decorations, no collage, no UI. This is an original fictional product visualization.
