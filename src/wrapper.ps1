# >>> claude-auto-retry-windows >>>
# Shadows the `claude` command so it runs through the auto-retry launcher.
# Calling the real claude.exe by resolved path (inside the launcher) means this
# function never recurses.
function claude {
    if ($env:CLAUDE_AUTO_RETRY_ACTIVE -eq '1') {
        $real = (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($real) { & $real.Source @args } else { Write-Error 'claude.exe not found on PATH' }
        return
    }
    $env:CLAUDE_AUTO_RETRY_ACTIVE = '1'
    try {
        & node "__LAUNCHER_PATH__" @args
    } finally {
        Remove-Item Env:\CLAUDE_AUTO_RETRY_ACTIVE -ErrorAction SilentlyContinue
    }
}
# <<< claude-auto-retry-windows <<<
