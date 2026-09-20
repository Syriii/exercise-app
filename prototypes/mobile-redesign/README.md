# 移动端 UI / UX 交互原型

独立 Vue 3 原型。只用示例数据、内存状态和本地图片预览；没有 API 代理、生产访问、真实识别或数据上传。刷新重置示例；所有营养值只用于演示交互，不作饮食建议。

从仓库根目录运行：

```sh
node node_modules/vite/bin/vite.js prototypes/mobile-redesign --config prototypes/mobile-redesign/vite.config.mjs
```

打开 http://127.0.0.1:5188/ 。默认今天页，手机使用底部导航，桌面侧栏。顶部“原型”可切换异常场景、查看注册流程、恢复示例。真实选图仅在本机预览；“使用示例照片”可走完整模拟流程。

覆盖：五个主页面、照片／相册预览、模拟识别与失败、份量修改／替换／补充／删除、手动多选、批量训练、计划修改、身体记录、注册与首次设置、低频设置。导出、账号删除、提醒等仅展示模拟操作，不连接服务。

这是本机预览地址，不是公网或手机访问地址。实体手机摄像头、相册和软键盘仍需正式接入后的真机验收。完整检查记录及占位范围见 [VERIFICATION.md](./VERIFICATION.md)。

## 素材

`public/assets/sample-lunch.png`：Nutrition5k / Google Research / Thames et al., CVPR 2021，公开样本 dish_1562691032，CC BY 4.0。来源 https://github.com/google-research-datasets/Nutrition5k 。未修改原始文件，界面仅用 object-fit 裁切展示。照片及条目均为演示素材，示例营养与照片不作为真实对应评测。

食物分类 SVG 为本原型原创示意插图，不代表精确品种或模型分割结果。
