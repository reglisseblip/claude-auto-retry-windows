# >>> claude-auto-retry-windows >>>
# Four ways to launch Claude (bash / Git Bash). The launcher resolves the mode;
# CLAUDE_AUTO_RETRY_DEFAULT sets each command's default, overridable per-launch
# with --monitor / --no-monitor. claude.exe is run by full path inside the
# launcher, and CLAUDE_AUTO_RETRY_ACTIVE guards against recursion if Claude itself
# shells out and calls `claude`.
#   claude    = vanilla            claudem   = monitored (psmux auto-retry)
#   claude+   = vanilla + skip     claudem+  = monitored + skip
claude() {
  if [ "${CLAUDE_AUTO_RETRY_ACTIVE}" = "1" ]; then command claude "$@"; return $?; fi
  CLAUDE_AUTO_RETRY_ACTIVE=1 CLAUDE_AUTO_RETRY_DEFAULT=0 node "__LAUNCHER_PATH__" "$@"
}
claudem() {
  if [ "${CLAUDE_AUTO_RETRY_ACTIVE}" = "1" ]; then command claude "$@"; return $?; fi
  CLAUDE_AUTO_RETRY_ACTIVE=1 CLAUDE_AUTO_RETRY_DEFAULT=1 node "__LAUNCHER_PATH__" "$@"
}
alias claude+='claude --dangerously-skip-permissions'
alias claudem+='claudem --dangerously-skip-permissions'
# <<< claude-auto-retry-windows <<<
