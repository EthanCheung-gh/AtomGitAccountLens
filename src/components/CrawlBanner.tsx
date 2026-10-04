import { useAppStore } from '../state/AppStore'
import ProgressBar from './ProgressBar'

/** 抓取状态横幅：运行中（进度+中断）/ 错误（重试）/ 已中断（重新抓取） */
export default function CrawlBanner() {
  const { crawl, abortCrawl, startCrawl } = useAppStore()
  if (crawl.kind === 'idle' || crawl.kind === 'done') return null

  if (crawl.kind === 'running') {
    const p = crawl.progress
    return (
      <div className="crawl-banner running" role="status">
        <div className="crawl-banner-text">
          <span className="crawl-dot" aria-hidden="true" />
          {p.message}
        </div>
        <ProgressBar current={p.current} total={p.total} />
        <button type="button" className="btn danger crawl-abort" onClick={abortCrawl}>
          中断
        </button>
      </div>
    )
  }

  if (crawl.kind === 'error') {
    return (
      <div className="crawl-banner error" role="alert">
        <div className="crawl-banner-text">抓取失败：{crawl.message}</div>
        <button type="button" className="btn" onClick={startCrawl}>
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="crawl-banner aborted" role="status">
      <div className="crawl-banner-text">已中断，未保存本轮抓取结果。</div>
      <button type="button" className="btn" onClick={startCrawl}>
        重新抓取
      </button>
    </div>
  )
}
