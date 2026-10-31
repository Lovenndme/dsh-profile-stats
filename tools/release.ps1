<#
.SYNOPSIS
  One-step release for dsh-profile-stats: test -> bump -> commit -> push -> npm publish -> verify.

.DESCRIPTION
  Credentials are never stored in this repository. A granular npm token with "Bypass 2FA" and
  read/write access to `dsh-profile-stats` is read from $env:NPM_TOKEN, or from the file
  `$HOME/.dsh/.npm-publish-token` (recommended: keep it outside every checkout, tighten its ACL).

.EXAMPLE
  pwsh tools/release.ps1              # patch bump, e.g. 1.3.1 -> 1.3.2
  pwsh tools/release.ps1 minor        # 1.3.1 -> 1.4.0
  pwsh tools/release.ps1 1.4.0        # explicit version
  pwsh tools/release.ps1 none         # keep the version (only publish)
#>
param(
  [Parameter(Position = 0)][string]$Bump = 'patch',
  [switch]$SkipTests,
  [switch]$SkipPush
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $repo 'package.json'

function Get-Token {
  if ($env:NPM_TOKEN) { return $env:NPM_TOKEN.Trim() }
  $file = Join-Path $HOME '.dsh/.npm-publish-token'
  if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
  throw "找不到发布凭据：请设置 `$env:NPM_TOKEN，或把 token 写入 $file"
}

function Step([string]$text) { Write-Host "`n== $text" -ForegroundColor Cyan }

# --- tests -------------------------------------------------------------------
$testDir = Join-Path (Split-Path $repo -Parent) 'profile-stats-verify'
if (-not $SkipTests) {
  Step '测试'
  $checker = Join-Path $testDir 'client-smoke.mjs'
  $hostTest = Join-Path $testDir 'host-integration.mjs'
  if (Test-Path $checker) { node $checker; if ($LASTEXITCODE -ne 0) { throw '客户端冒烟测试失败' } } else { Write-Host '  (跳过：没有 client-smoke.mjs)' }
  if (Test-Path $hostTest) { node $hostTest; if ($LASTEXITCODE -ne 0) { throw '宿主集成测试失败' } } else { Write-Host '  (跳过：没有 host-integration.mjs)' }
}

# --- version -----------------------------------------------------------------
Step '版本'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$current = [version]$manifest.version
$next = switch -Regex ($Bump) {
  '^none$' { $manifest.version }
  '^patch$' { '{0}.{1}.{2}' -f $current.Major, $current.Minor, ($current.Build + 1) }
  '^minor$' { '{0}.{1}.0' -f $current.Major, ($current.Minor + 1) }
  '^major$' { '{0}.0.0' -f ($current.Major + 1) }
  default {
    if ($Bump -notmatch '^\d+\.\d+\.\d+$') { throw "无法识别的版本参数：$Bump" }
    $Bump
  }
}
if ($next -ne $manifest.version) {
  (Get-Content $manifestPath -Raw) -replace ('"version":\s*"' + [regex]::Escape($manifest.version) + '"'), ('"version": "' + $next + '"') |
    Set-Content $manifestPath -Encoding utf8 -NoNewline
}
Write-Host "  $($manifest.version) -> $next"

# --- commit + push -----------------------------------------------------------
Step '提交并推送'
Push-Location $repo
try {
  git add -A
  $dirty = (git status --porcelain) -join ''
  if ($dirty) {
    git commit -m "release: $next" | Out-Null
  } else {
    Write-Host '  (没有需要提交的改动)'
  }
  if (-not $SkipPush) { git push origin main | Out-Null; Write-Host '  已推送 main' }
} finally { Pop-Location }

# --- publish -----------------------------------------------------------------
Step '发布到 npm'
$token = Get-Token
$auth = "//registry.npmjs.org/:_authToken=$token"
Push-Location $repo
try {
  $output = (npm publish --access public "--$auth" 2>&1) -join "`n"
} finally { Pop-Location }
if ($output -match 'npm error') { throw "发布失败：`n$output" }
Write-Host ($output -split "`n" | Where-Object { $_ -match 'notice (version|total files)|^\+ ' } | ForEach-Object { "  $_" })

# --- verify (registry propagation takes a minute or two) ---------------------
Step '校验 registry'
for ($i = 1; $i -le 10; $i++) {
  Start-Sleep -Seconds 20
  try {
    $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $doc = Invoke-RestMethod -Uri "https://registry.npmjs.org/dsh-profile-stats?ts=$stamp" -Headers @{ 'Cache-Control' = 'no-cache' }
    Write-Host ("  [{0}] latest = {1}" -f $i, $doc.'dist-tags'.latest)
    if ($doc.'dist-tags'.latest -eq $next) { Write-Host "`n完成：dsh-profile-stats@$next 已上线" -ForegroundColor Green; return }
  } catch {
    Write-Host ("  [{0}] 查询失败：{1}" -f $i, $_.Exception.Message)
  }
}
Write-Host "`n已发布，但 registry 尚未返回 $next（通常是 CDN 延迟，过几分钟用 npm view 复查）" -ForegroundColor Yellow
