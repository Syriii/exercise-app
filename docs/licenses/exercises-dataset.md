# Exercises Dataset 第三方许可说明

Exercise App 的公共动作目录派生自 [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)。公共源码只保留动作名称、身体部位、器械、目标肌群和中文动作步骤，不包含或分发上游 `images/`、`videos/`、媒体标识或媒体路径。

## 许可边界

- 代码、工具、数据结构和动作说明/翻译：MIT License。
- 上游图片与 GIF：© Gym visual，不属于 MIT License；克隆上游仓库不会获得媒体复用许可。本项目代码支持部署者从独立本地目录提供媒体，但不会提交、公开构建或默认部署这些文件。
- 项目内生成目录记录了上游 URL、MIT 标记与源文件 SHA-256，生成脚本会拒绝任何媒体字段进入产物。

## 可选本地媒体目录

仓库把可提交的目录数据、导入工具与不可提交的第三方媒体分开：

```text
exercise-app/
├── .runtime/exercise-catalog/source/       # 本地私有原始资料，Git/Docker 忽略
│   ├── data/exercises.json                 # 仅在重新生成目录时需要
│   ├── images/
│   └── videos/
├── apps/server/data/exercises.zh.json      # 可审阅、可分发的 MIT-only 生成目录
└── apps/server/scripts/generate-exercise-catalog.mjs
```

开发环境默认读取 `.runtime/exercise-catalog/source/`，也可通过 `EXERCISE_MEDIA_ROOT` 指向其他目录；生产模式要求该值为绝对路径。Docker 部署不直接使用宿主机路径作为应用路径，而由 `compose.exercise-media.yaml` 把 `EXERCISE_MEDIA_HOST_PATH` 只读挂载到容器内固定绝对路径。媒体目录只接受以下固定结构和文件名：

```text
source/
├── images/0001-<media-id>.jpg
└── videos/0001-<media-id>.gif
```

`.runtime/` 是可删除、可重建的本地状态，不作为产品文档、源码或部署产物。媒体接口要求登录，并按动作 ID 与 `image` / `animation` 两种固定类型读取；缺少目录或单个文件时，动作搜索和指导会自动回退到无媒体状态。部署者需要自行确认其许可覆盖具体使用和部署方式，并保留界面中的 `© Gym visual — https://gymvisual.com/` 署名。

## MIT License

Copyright (c) 2026 Hasan Emir Yıldırım

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation and data files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
