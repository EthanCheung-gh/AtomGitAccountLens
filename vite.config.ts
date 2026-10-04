import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base 面向 GitHub Pages 项目页（https://<user>.github.io/AtomGitAccountLens/）
export default defineConfig({
  base: '/AtomGitAccountLens/',
  plugins: [react()],
})
