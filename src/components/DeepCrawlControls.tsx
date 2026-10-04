import { useMemo } from 'react'
import { useAppStore } from '../state/AppStore'
import { deepCommitCount } from '../lib/aggregate'
import { formatCount } from '../lib/format'
import ProgressBar from './ProgressBar'

/**
 * 深度抓取（逐仓库全时段提交）的统一入口：
 * 运行中显示进度+中断；否则显示范围开关+按钮+失败/截断提示。
 * snapshot 不存在时不渲染。
 */
export default function DeepCrawlControls() {
  const {
    snapshot,
    crawl,
    deepCrawl,
    startDeepCrawl,
    resetDeepCrawl,
    abortDeepCrawl,
    deepScope,
    setDeepScope,
  } = useAppStore()

  const deepTotal = useMemo(
    () => deepCommitCount(snapshot?.commitsRecentByRepo),
    [snapshot],
  )

  if (!snapshot) return null

  if (deepCrawl.kind === 'running') {
    return (
      <>
        <p className="muted deep-crawl-msg">{deepCrawl.message}</p>
        <ProgressBar current={deepCrawl.current} total={deepCrawl.total} />
        <button
          type="button"
          className="btn danger deep-crawl-abort"
          onClick={abortDeepCrawl}
        >
          中断深度抓取
        </button>
      </>
    )
  }

  return (
    <>
      <div className="deep-controls-row">
        <label
          className="deep-scope-check"
          title="默认只抓 namespace 为本人的仓库；勾选后也抓你加入的社区/组织仓库（配合「仅统计本人提交」过滤仍可干净分析）"
        >
          <input
            type="checkbox"
            checked={deepScope === 'all'}
            onChange={(e) => setDeepScope(e.target.checked ? 'all' : 'personal')}
          />
          含我加入的社区/组织仓库
        </label>
        <div className="deep-buttons">
          <button
            type="button"
            className="btn"
            onClick={startDeepCrawl}
            disabled={crawl.kind === 'running'}
            title="逐仓库全时段翻页抓取提交（走限流队列，可中断，增量续抓）"
          >
            {deepCrawl.kind === 'aborted'
              ? '继续深度抓取'
              : deepTotal > 0
                ? `深度抓取提交（已 ${formatCount(deepTotal)} 条）`
                : '深度抓取提交'}
          </button>
          {deepTotal > 0 && (
            <button
              type="button"
              className="btn"
              onClick={resetDeepCrawl}
              disabled={crawl.kind === 'running'}
              title="清空已抓取的提交数据并从头全量重抓（旧版本只抓了每仓库最近 100 条时用这个升级为全时段）"
            >
              重置并全量重抓
            </button>
          )}
        </div>
      </div>
      {deepCrawl.kind === 'error' && (
        <p className="token-error">深度抓取失败：{deepCrawl.message}</p>
      )}
      {deepCrawl.kind === 'done' && deepCrawl.failed > 0 && (
        <p className="token-error">
          上次深度抓取有 {deepCrawl.failed} 个仓库拉取失败（多为空仓库或令牌缺少项目读取权限），
          空结果不会计入增量，再次点击可重试。
        </p>
      )}
      {deepCrawl.kind === 'done' && deepCrawl.truncated > 0 && (
        <p className="token-error">
          有 {deepCrawl.truncated} 个仓库超过单仓库上限（5000 条提交）被截断。
        </p>
      )}
    </>
  )
}
