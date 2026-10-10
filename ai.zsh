# AiUtility zsh 整合：按 Ctrl+G 再按 Ctrl+A（或 a）開啟 AI 指令助手 TUI。
# 在 ~/.zshrc 加入：source /path/to/AiUtility/ai.zsh
# 需要 `ai` 指令在 PATH（npm install -g .）。
ai-tui-widget() {
  zle -I                       # 讓 zle 讓出終端
  ai tui </dev/tty >/dev/tty   # TUI 自己管 alternate screen，離開後畫面完全還原
  zle reset-prompt             # 重畫提示字元；輸入到一半的 BUFFER 會保留
}
zle -N ai-tui-widget
bindkey '^G^A' ai-tui-widget
bindkey '^Ga' ai-tui-widget
