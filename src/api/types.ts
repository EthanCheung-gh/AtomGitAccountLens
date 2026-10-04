/**
 * GitCode /api/v5（Gitee v5 风格）响应类型。
 * 平台响应字段与文档存在漂移，所有非关键字段均为可选，取值处做防御式访问。
 */

export interface GitCodeUser {
  id?: number | string
  login: string
  name?: string | null
  avatar_url?: string | null
  html_url?: string | null
  bio?: string | null
  email?: string | null
  followers?: number | null
  following?: number | null
  top_languages?: string[] | null
  public_repos?: number | null
  created_at?: string | null
}

export interface GitCodeRepo {
  id?: number | string
  name?: string
  path?: string
  path_with_namespace?: string
  full_name?: string
  namespace?: { path?: string; name?: string } | null
  html_url?: string | null
  description?: string | null
  fork?: boolean
  private?: boolean
  forks_count?: number | null
  stargazers_count?: number | null
  watchers_count?: number | null
  language?: string | null
  created_at?: string | null
  updated_at?: string | null
  pushed_at?: string | null
  default_branch?: string | null
}

/** events 接口的原始条目（字段按 Gitee v5 风格 + 防御式可选） */
export interface RawGitCodeEvent {
  action_name?: string
  created_at?: string
  project?: {
    name?: string
    path?: string
    path_with_namespace?: string
    namespace?: string | { path?: string }
  } | null
  push_data?: { commit_count?: number; ref?: string } | null
  target_type?: string | null
  [key: string]: unknown
}

/** 归一化后的账号事件（聚合层使用） */
export interface AccountEvent {
  /** YYYY-MM-DD（来自日期键或 created_at 截断） */
  date: string
  action: string
  repoPath: string
  commitCount: number
  createdAt: string | null
}
