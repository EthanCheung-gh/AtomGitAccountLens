import { TOKEN_CREATE_URL } from '../api/client'

interface ScopeGuideProps {
  /** 需要的权限说明，默认 read_user */
  scope?: string
  compact?: boolean
}

/** 令牌缺少 read_user 等权限时的引导卡（共识：引导而非白屏报错） */
export default function ScopeGuide({ scope = 'read_user', compact = false }: ScopeGuideProps) {
  return (
    <div className={`scope-guide ${compact ? 'compact' : ''}`}>
      <p>
        当前令牌缺少 <code>{scope}</code> 权限，这部分数据暂无法展示。
      </p>
      {!compact && (
        <p className="muted">
          可前往
          <a href={TOKEN_CREATE_URL} target="_blank" rel="noreferrer">
            GitCode 令牌管理页
          </a>
          重新创建勾选了 <code>{scope}</code> 的令牌，然后在本页「退出」重新登录并抓取。
        </p>
      )}
    </div>
  )
}
