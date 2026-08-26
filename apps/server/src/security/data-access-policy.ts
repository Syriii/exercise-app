export const directAccountTables = [
  "training_suggestions",
  "training_templates",
  "training_programs",
  "training_schedules",
  "training_sessions",
  "training_reminder_rules",
  "training_reminder_day_states",
  "nutrition_reminder_rules",
  "nutrition_reminder_day_states",
  "measurement_reminder_rules",
  "measurement_reminder_day_states",
  "personal_profiles",
  "goal_strategies",
  "body_measurements",
  "daily_planning_references",
  "diet_plans",
  "meals",
  "nutrition_day_states",
  "personal_food_templates",
  "meal_image_analyses",
] as const;

export const inheritedAccountTables = [
  "training_template_items",
  "training_program_units",
  "training_program_unit_items",
  "training_session_items",
  "training_session_sets",
  "training_session_item_revisions",
  "training_session_revisions",
  "body_measurement_revisions",
  "meal_revisions",
  "meal_contributions",
  "meal_contribution_revisions",
  "meal_image_analysis_attempts",
] as const;

export const internalTables = {
  users: "身份认证与管理员账号清单；不含健康记录",
  credentials: "登录前按用户名校验；只保存 Argon2id",
  sessions: "登录前按不可逆 token 摘要校验",
  app_settings: "全服务器注册开关",
  audit_events: "只写安全审计；没有用户读取路由",
  background_tasks: "API 按账号过滤，worker 跨账号消费，管理员只读聚合计数",
  background_task_attempts: "只由可信 worker 通过父任务访问",
  temporary_media: "API 按账号过滤，worker 清理，管理员只读聚合计数；对象键不出接口",
  runtime_heartbeats: "非用户运行心跳",
  maintenance_events: "非用户备份/恢复结果",
} as const;

export const rlsTables = [...directAccountTables, ...inheritedAccountTables] as const;
