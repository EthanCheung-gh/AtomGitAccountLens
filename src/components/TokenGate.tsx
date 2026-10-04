import { useState } from 'react'
import type { FormEvent } from 'react'
import { TOKEN_CREATE_URL, apiErrorMessage } from '../api/client'

interface TokenGateProps {
  onSignIn: (token: string, remember: boolean) => Promise<unknown>
}

export default function TokenGate({ onSignIn }: TokenGateProps) {
  const [token, setToken] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = token.trim()
    if (!trimmed) {
      setError('请输入访问令牌。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSignIn(trimmed, remember)
    } catch (err) {
      setError(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="token-gate">
      <div className="card token-card">
        <h2>连接你的 GitCode 账号</h2>
        <p className="muted token-step">
          1. 打开
          <a href={TOKEN_CREATE_URL} target="_blank" rel="noreferrer">
            GitCode 访问令牌页面
          </a>
          创建令牌（建议勾选 <code>read_user</code> 等读取权限）
        </p>
        <p className="muted token-step">2. 将生成的令牌粘贴到下面，数据只在你的浏览器内分析。</p>

        <form onSubmit={handleSubmit}>
          <div className="token-input-row">
            <input
              className="input"
              type={show ? 'text' : 'password'}
              placeholder="粘贴访问令牌（仅保存在本页内存）"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button
              type="button"
              className="btn"
              onClick={() => setShow((v) => !v)}
            >
              {show ? '隐藏' : '显示'}
            </button>
          </div>

          <label className="token-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            <span>
              在本设备记住令牌
              <span className="muted">
                （明文存于本浏览器 localStorage，公共电脑请勿勾选）
              </span>
            </span>
          </label>

          {error && <p className="token-error">{error}</p>}

          <button type="submit" className="btn primary token-submit" disabled={busy}>
            {busy ? '验证中…' : '开始分析'}
          </button>
        </form>

        <p className="muted token-privacy">
          隐私说明：令牌仅保存在本页内存（勾选记住时另存本设备），所有请求直连
          api.gitcode.com 官方接口，不经过任何第三方服务器。
        </p>
      </div>
    </section>
  )
}
