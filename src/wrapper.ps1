# >>> claude-auto-retry-windows >>>
# `claude` = vanilla, `claudem` = monitored (psmux auto-retry). The +variants
# (claude+ / claudem+) are provided as .cmd shims next to claude.exe. The launcher
# resolves the mode (overridable per-launch with --monitor / --no-monitor); the
# real claude.exe is run by full path inside the launcher, so this never recurses.
function claude {
    if ($env:CLAUDE_AUTO_RETRY_ACTIVE -eq '1') {
        $real = (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($real) { & $real.Source @args } else { Write-Error 'claude.exe not found on PATH' }
        return
    }
    $env:CLAUDE_AUTO_RETRY_ACTIVE = '1'; $env:CLAUDE_AUTO_RETRY_DEFAULT = '0'
    try { & node "__LAUNCHER_PATH__" @args }
    finally {
        Remove-Item Env:\CLAUDE_AUTO_RETRY_ACTIVE -ErrorAction SilentlyContinue
        Remove-Item Env:\CLAUDE_AUTO_RETRY_DEFAULT -ErrorAction SilentlyContinue
    }
}
function claudem {
    if ($env:CLAUDE_AUTO_RETRY_ACTIVE -eq '1') {
        $real = (Get-Command claude -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($real) { & $real.Source @args } else { Write-Error 'claude.exe not found on PATH' }
        return
    }
    $env:CLAUDE_AUTO_RETRY_ACTIVE = '1'; $env:CLAUDE_AUTO_RETRY_DEFAULT = '1'
    try { & node "__LAUNCHER_PATH__" @args }
    finally {
        Remove-Item Env:\CLAUDE_AUTO_RETRY_ACTIVE -ErrorAction SilentlyContinue
        Remove-Item Env:\CLAUDE_AUTO_RETRY_DEFAULT -ErrorAction SilentlyContinue
    }
}
# <<< claude-auto-retry-windows <<<
