# 上线后逐页可用性评估

## 结论与范围

当前版本具备记录能力，但尚未整体达到普通用户低负担日常使用的目标。主要问题是旧业务流程与新能力并存，而非缺少颜色、图标或更多说明。照片单项结果、份量编辑、设置目录可保留；先处理输入丢失、账号入口缺失，再收敛训练与饮食主流程。

- 基线：本地 446a707，应用代码对应已发布 S1；后续 S2–S4 未实现，不以设计文档冒充现状。
- 方法：当前规范/路由/组件审查，412×839 CSS px 手机模拟视口、内存假账号走查。完成注册、四步设置、五个主入口、身体/账号/反馈、训练实际录入/历史、新照片单项等状态。
- 截图与复现数据：`/tmp/exercise-usability-audit/`，17个初始状态及1个照片结果截图，`results.json`、`checks.json`。截图是内部滚动容器当前位置，不等于整页长截图。
- 未访问生产健康记录，未对真实用户做访谈，未重新评估模型营养准确性。未做实体 Android、iOS、屏幕阅读器或所有异常/管理员流程验收。
- 通用参照：[NN/g 十项可用性原则](https://www.nngroup.com/articles/ten-usability-heuristics/)中的贴近用户语言、识别优于回忆、用户控制和必要信息优先；[Material 导航原则](https://m2.material.io/design/navigation/understanding-navigation.html)支持稳定一级入口。遵循原则不等于证明所有用户行为一致。

## 应保留的部分

1. 五个底部入口稳定，当前页有明确选中态；本轮全部截图状态没有整页横向溢出。
2. 新照片可形成独立食物，直接计入；改份量、设常用、移除均就近操作，无必经整餐确认。单项改量失败保留输入的组件实现也合理。
3. 设置已采用摘要目录和独立保存，不能再说它仍是全部表单铺开的长设置页。
4. 历史默认按日期列出事实、可按模块筛选；餐食和测量已有返回业务页的入口。
5. 问题报告由用户主动生成、预览后分享；删除账号明确说明影响并验证身份。不要为了简化删除这些保障。

## 严重：输入被遗漏且界面声称保存成功

### U01 训练保存契约不符合直觉【已在浏览器复现】

- 位置：[TrainingPage.vue:241](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/TrainingPage.vue:241)、[TrainingPage.vue:615](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/TrainingPage.vue:615)、[TrainingPage.vue:668](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/TrainingPage.vue:668)。
- 复现：两个动作分别填10、12次，保存第一个后，第二个输入变为空；重新填12次并点击“保存并结束”，历史中第二个仍是未处理，12次没有保存。
- 原因：保存任一动作后重建全部 actualForms；结束请求仅有 revision/status，不提交未保存动作。
- 用户影响：运动后一次填写多个动作是合理操作，却会漏掉刚填的内容；“这次训练已保存”不能表达这个结果。
- 建议：整条训练一次保存且失败保留所有输入；修复期间也不能让局部返回覆盖其他草稿，结束前须明确处理未保存内容。

## 主要：增加理解成本或缺少基本路径

### U02 切换底部页后饮食草稿不恢复【已复现】

- 位置：[App.vue:7](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/app/App.vue:7)、[NutritionPage.vue:583](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/NutritionPage.vue:583)。
- 在新餐名称填“未保存草稿”，点底部历史再回饮食，新建表单不再显示。组件内状态随着路由卸载；不能据此泛化所有表单都已测过。
- 建议：账号隔离的会话内草稿和明确放弃操作；返回原草稿，失败重试不重复记账。不要直接将健康明细长期写入 localStorage。

### U03 账号有能力却没有日常入口【源码及账号页核对】

- 位置：[SettingsPage.vue:501](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/SettingsPage.vue:501)、[router/index.ts:28](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/router/index.ts:28)、[ChangePasswordPage.vue:34](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/ChangePasswordPage.vue:34)。
- 当前挂载页面的账号区只有导出与删除，没有普通用户的“退出登录”和“修改密码”入口。旧 Dashboard 的退出按钮未被当前 RouterView 使用；存在 logout 方法不代表用户能操作。
- 改密页可由直接路由访问，但没有普通改密场景的取消/返回，保存后固定去今天。
- 建议：账号页补齐改密、退出；普通改密返回账号页，首次强制改密仍保持必要约束。不得让用户把注销账号当作退出。

### U04 训练主流程仍是实时训练模式【源码及手机走查】

- 位置：[TrainingPage.vue:689](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/TrainingPage.vue:689)、[TrainingPage.vue:977](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/TrainingPage.vue:977)。
- 首页是直接开始/新建方案/帮我排一份，并列单次方案和周期计划。空白开始后还先展示“计划动作”“已完成0项/还需练0项”，实际录入被称作“额外动作”。
- 每组同时出现次数、重量、秒数和距离，并非按动作类型选择相关字段；最后仍需保存并结束。
- 建议：按已确认设计回到看/改计划与记录实际两个分支；力量默认组数×次数+重量，差异组和其他计量按需展开。周期安排作为计划深层能力，不删除多周规划。

### U05 饮食首页把内部结构交给用户操作【源码及手机走查】

- 位置：[NutritionPage.vue:592](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/NutritionPage.vue:592)、[NutritionPage.vue:609](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/NutritionPage.vue:609)、[NutritionPage.vue:624](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/NutritionPage.vue:624)、[NutritionPage.vue:720](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/NutritionPage.vue:720)。
- 系统参考、饮食安排、剩余量和全天确认位于实际餐食前；每一餐都铺开复用、照片、搜索和手工营养表单。
- 常用、最近一餐、个人记录、公开包装食品仍是多组选择；空搜索不是全部可用食物。手填表单仍要求用户理解估算基准、整餐/单项、替代全部营养等概念。
- 当前假数据场景未记餐主内容高1975px，建立一顿空餐后3884px；这是本次视口测量，不是所有账号的固定页长。
- 建议：日期+已记录/参考+拍照/添加食物+餐食摘要；详情按需进入。统一一个食物目录/分类/常用排序。保留未知值与照片估算身份，但不要求全天确认。

### U06 今天不是简短概览【源码及截图】

- 位置：[TodayPage.vue:222](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/TodayPage.vue:222)。
- 强调还可以吃、安排或开始训练；新账号首屏被身体提醒占用，营养数字在其后。训练/饮食/身体提醒均可占独立区域；缺少约定的上一餐时间+名称入口。
- 建议：两张摘要卡，已记录营养/上一餐、计划记录进度或实际训练摘要；两个记录入口。测量到期只轻提示，不把提醒变成首页主体。

### U07 首次使用衔接和完成状态不足【部分复现，部分源码】

- 位置：[router/index.ts:37](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/router/index.ts:37)、[SettingsPage.vue:200](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/SettingsPage.vue:200)、[SettingsPage.vue:355](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/SettingsPage.vue:355)。
- 注册实际进入今天，用户自行去设置才遇到向导；向导可整体“以后再设置”。是否需要向导取决于资料修订和测量是否全空，不是独立完成状态；只保存基础资料就不再满足 pristine。
- 四步结构本身可保留，但提醒步骤未提供明确的独立“跳过提醒”；目标页直接展开宏量分配等较专业选项。
- 建议：前三个必要步骤可靠续填，提醒可跳过，完成后回今天；未知计算输入不强迫造值，详细营养偏好按需显示。

### U08 身体数据入口和记录管理不完整【源码及手机走查】

- 位置：[SettingsPage.vue:404](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/SettingsPage.vue:404)、[SettingsPage.vue:257](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/SettingsPage.vue:257)、[postgres-repository.ts:133](/Users/xiesh/Codes/personal/exercise-app/apps/server/src/modules/planning/postgres-repository.ts:133)。
- 目录式设置已有效降低负担，但每周体重仍藏在“设置”；测量页有新增和修正，没有删除记录入口或就近身体趋势。
- 补记日期与 measuredAt 分离：新增使用当前录入时间，列表按 measuredAt 倒序，补记旧日期可能成为当前最新测量。这是代码确认的数据语义风险，本轮未另做数据库复现。
- 建议：保留摘要目录，一级改为我的，身体数据置前；新增、改错、删除清楚分开；当前值以实际日期排序并显示日期。

### U09 历史回看合理，编辑与趋势未收敛【源码及手机走查】

- 位置：[HistoryPage.vue:444](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/HistoryPage.vue:444)、[HistoryPage.vue:479](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/HistoryPage.vue:479)、[HistoryPage.vue:548](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/HistoryPage.vue:548)。
- 默认近期记录和按类型筛选合理；训练详情却内嵌另一套修正、补记、版本查看。趋势在列表后，是横向滚动大表；只有能量/蛋白质而非完整四项。
- 身体链接只打开测量页，不定位该记录；跳转没有携带历史筛选/返回位置。从历史改完一条再找下一条不顺畅。
- 建议：记录/趋势分开，原业务编辑器复用，携带记录、日期、筛选和返回位置；趋势按具体问题展示，不默认跨模块大表。

## 次要：表达和视觉效率

### U10 重复页名和过大的段间留白挤压首屏【Hallmark 辅助检查】

- 位置：[AppShell.vue:79](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/app/AppShell.vue:79)、[app.css:400](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/styles/app.css:400)、[TrainingPage.vue:693](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/TrainingPage.vue:693)。
- 可对应 Hallmark 的 “Eyebrow on every section”：手机栏已有页名，内容再次以小标签+大标题重复，并留较多空白。训练空白记录首屏看不到动作输入，历史首屏用于标题和筛选的空间偏大。
- 建议：合并重复标题、减少装饰性间距，将常用信息前移；不要简单缩小字体或触控目标。保持目前一致配色和稳定导航即可，无需为反模板而更换全套风格。

### U11 反馈和导出偏开发者语言【源码及截图】

- 位置：[FeedbackPage.vue:50](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/FeedbackPage.vue:50)、[SettingsPage.vue:502](/Users/xiesh/Codes/personal/exercise-app/apps/web/src/views/SettingsPage.vue:502)。
- “Bug反馈”“准备JSON导出”“清空近期日志”不是日常用户最关心的表达；生成报告后虽然不会自动上传，但缺少明确的交付对象说明。
- 建议：显示问题反馈/导出我的数据，格式和日志放说明或次级操作；明确复制后交给谁，但不改成自动上传。

## 顺序与结论

- 本次共11组问题：严重1组、主要8组、次要2组。严重性按普通用户任务损失划分，不按配色或设计风格划分。
- 先处理 U01/U02 输入保护与 U03 账号入口，再完成已确认的饮食、训练闭环，随后收敛今天/历史/我的与首屏层级。此为评估建议，不自动改变交付计划或授权开发。
- 不建议重做产品讨论或继续新增并列入口。当前设计方向大体合理，主要工作是把已确认设计真正落实到当前实现。
