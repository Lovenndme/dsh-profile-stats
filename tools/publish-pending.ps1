<#
.SYNOPSIS
  Publish only when the local version is ahead of the registry. Designed to run on a schedule.

.DESCRIPTION
  Workflow it supports: while working, bump `version` in package.json and add a CHANGELOG entry, commit, and
  stop there. This script runs every few hours, sees that the local version is newer than npm's `latest`,
  publishes it, and then verifies the registry caught up.

  It never bumps the version itself — a publish batch must not invent changelog entries. If local version
  equals the registry version it exits quietly (exit 0, "nothing to publish").

  Credentials: $env:NPM_TOKEN, else $HOME/.dsh/.npm-publish-token (never stored in this repository).
#>
param(
  [switch]$Force,
  [string]$LogDir = (Join-Path $HOME '.dsh/dsh-profile-stats')
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$pkgPath = Join-Path $repo 'package.json'

function Write-Log([string]$message) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  $line = "[$stamp] $message"
  Write-Host $line
  try {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    Add-Content -Path (Join-Path $LogDir 'publish.log') -Value $line -Encoding utf8
  } catch {
    /* 日志写不进去不影响发布 */
  }
}

function Get-Token {
  if ($env:NPM_TOKEN) { return $env:NPM_TOKEN.Trim() }
  $file = Join-Path $HOME '.dsh/.npm-publish-token'
  if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
  throw '找不到 npm 发布凭据：请设置 $env:NPM_TOKEN，或把 token 写入 ~/.dsh/.npm-publish-token'
}

$local = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version
$latest = $null
try {
  $latest = (Invoke-RestMethod -Uri 'https://registry.npmjs.org/dsh-profile-stats/latest' -TimeoutSec 20).version
} catch {
  Write-Log "读取 registry 版本失败，跳过本轮：$($_.Exception.Message)"
  exit 0
}

Write-Log "本地 $local / 线上 $latest"

function Compare-Semver([string]$left, [string]$right) {
  $a = $left.Split('-')[0].Split('.') | ForEach-Object { [int]$_ }
  $b = $right.Split('-')[0].Split('.') | ForEach-Object { [int]$_ }
  for ($i = 0; $i -lt 3; $i++) {
    $x = if ($i -lt $a.Count) { $a[$i] } else { 0 }
    $y = if ($i -lt $b.Count) { $b[$i] } else { 0 }
    if ($x -ne $y) { return $(if ($x -gt $y) { 1 } else { -1 }) }
  }
  return 0
}

if (-not $Force -and (Compare-Semver $local $latest) -le 0) {
  Write-Log '没有待发布版本，跳过'
  exit 0
}

# 发布前跑一遍测试：坏版本不进 npm
$verify = Join-Path (Split-Path $repo -Parent) 'profile-stats-verify'
$node = (Get-Command node -ErrorAction SilentlyContinue)
if (-not $node) {
  $bundled = Join-Path $HOME '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe'
  if (Test-Path $bundled) { $node = [pscustomobject]@{ Source = $bundled } }
}
if ($node -and (Test-Path (Join-Path $verify 'client-smoke.mjs'))) {
  & $node.Source (Join-Path $verify 'client-smoke.mjs') *> $null
  if ($LASTEXITCODE -ne 0) { Write-Log '客户端冒烟测试失败，跳过发布'; exit 1 }
  & $node.Source (Join-Path $verify 'host-integration.mjs') *> $null
  if ($LASTEXITCODE -ne 0) { Write-Log '宿主集成测试失败，跳过发布'; exit 1 }
  Write-Log '测试通过'
}

$token = Get-Token
$auth = "//registry.npmjs.org/:_authToken=$token"

# npm 会把 "npm notice …" 写到 stderr，而 $ErrorActionPreference='Stop' 会把原生 stderr 当成
# 终止错误（NativeCommandError）→ 发布被中断。这一段临时放宽，只看输出里有没有 npm error。
$npmCmd = (Get-Command npm -ErrorAction SilentlyContinue)
if (-not $npmCmd) {
  $bundledNpm = Join-Path $HOME '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/npm/bin/npm-cli.js'
  if (-not (Test-Path $bundledNpm)) {
    $bundledNpm = 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js'
  }
  if ((Test-Path $bundledNpm) -and $node) {
    $npmCmd = [pscustomobject]@{ Source = $node.Source; Prefix = @($bundledNpm) }
  }
}
if (-not $npmCmd) {
  Write-Log '找不到 npm，无法发布'
  exit 1
}

$previousEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
Push-Location $repo
try {
  if ($npmCmd.Prefix) {
    $output = (& $npmCmd.Source $npmCmd.Prefix[0] publish --access public "--$auth" 2>&1 | Out-String)
  } else {
    $output = (& $npmCmd.Source publish --access public "--$auth" 2>&1 | Out-String)
  }
} catch {
  $output = "exception: $($_.Exception.Message)"
} finally {
  Pop-Location
  $ErrorActionPreference = $previousEap
}
Remove-Item Env:NPM_TOKEN -ErrorAction SilentlyContinue
if ($output -match 'npm error' -or $output -match 'exception:') {
  Write-Log "发布失败：$($output.Trim())"
  exit 1
}
Write-Log "已发布 $local"

for ($i = 1; $i -le 10; $i++) {
  Start-Sleep -Seconds 20
  try {
    $now = (Invoke-RestMethod -Uri 'https://registry.npmjs.org/dsh-profile-stats/latest' -TimeoutSec 20).version
    if ((Compare-Semver $now $local) -eq 0) { Write-Log "registry 已生效：$now"; exit 0 }
  } catch { }
}
Write-Log '已发布，但 registry 尚未返回新版本（CDN 延迟，稍后自动生效）'
exit 0
