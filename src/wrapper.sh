# >>> claude-auto-retry-windows >>>
# Shadows `claude` in bash/zsh (e.g. Git Bash on Windows) so it runs through the
# auto-retry launcher. Calling `command claude` when already active means this
# function never recurses.
claude() {
  if [ "${CLAUDE_AUTO_RETRY_ACTIVE}" = "1" ]; then
    command claude "$@"
    return $?
  fi
  export CLAUDE_AUTO_RETRY_ACTIVE=1
  node "__LAUNCHER_PATH__" "$@"
  local _car_exit=$?
  unset CLAUDE_AUTO_RETRY_ACTIVE
  return $_car_exit
}
# <<< claude-auto-retry-windows <<<
