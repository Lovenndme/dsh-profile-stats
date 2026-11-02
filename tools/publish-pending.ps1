<#
.SYNOPSIS
  Local fallback for the batched release: bump the patch version at publish time, publish, and tag.

.DESCRIPTION
  Mirrors .github/workflows/publish-pending.yml so this machine can do the same thing when GitHub is
  unreachable. Day-to-day work only commits; the version is decided here:

    1. find the last release tag (`v*`)
    2. if there are no commits after it, exit quietly
    3. otherwise bump the patch version, write a CHANGELOG section from the commit subjects,
       commit that, publish to npm, and tag the released commit

  Credentials: $env:NPM_TOKEN, else $HOME/.dsh/.npm-publish-token.
#>
param(
  [switch]$NoPush,
  [string]$LogDir = (Join-Path $HOME '.dsh/dsh-profile-stats')
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$pkgPath = Join-Path $repo 'package.json'
$changelogPath = Join-Path $repo 'CHANGELOG.md'

function Write-Log([string]$message) {
  $stamp = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
  Write-Host "[$stamp] $message"
  try {
    if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }
    Add-Content -Path (Join-Path $LogDir 'publish.log') -Value "[$stamp] $message" -Encoding utf8
  } catch { }
}

function Get-Token {
  if ($env:NPM_TOKEN) { return $env:NPM_TOKEN.Trim() }
  $file = Join-Path $HOME '.dsh/.npm-publish-token'
  if (Test-Path $file) { return (Get-Content $file -Raw).Trim() }
  throw '找不到 npm 发布凭据：请设置 $env:NPM_TOKEN，或把 token 写入 ~/.dsh/.npm-publish-token'
}

Push-Location $repo
try {
  $last = (git describe --tags --abbrev=0 --match 'v*' 2>$null)
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($last)) {
    $last = $null
    $count = [int](git rev-list --count HEAD)
    Write-Log '还没有发布标签，按全部提交计算'
  } else {
    $count = [int](git rev-list --count "$last..HEAD")
    Write-Log "上次发布标签 $last"
  }
  Write-Log "上次发布后新增提交 $count 个"
  if ($count -le 0) {
    Write-Log '没有待发布的提交，跳过'
    exit 0
  }

  # 必须用 node 改 package.json：PowerShell 的 ConvertTo-Json + Set-Content -Encoding utf8 会写入
  # UTF-8 BOM，而 DSH 加载 bundle 时 JSON.parse 遇到 BOM 直接失败，插件会被静默跳过（sidepanel 入口消失）。
  $current = ((Get-Content $pkgPath -Raw | ConvertFrom-Json).version)
  $nodeForJson = (Get-Command node -ErrorAction SilentlyContinue)
  if (-not $nodeForJson) {
    $bundledNode = Join-Path $HOME '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path $bundledNode) { $nodeForJson = [pscustomobject]@{ Source = $bundledNode } }
  }
  if (-not $nodeForJson) { throw '找不到 node，无法安全改写 package.json' }
  $next = & $nodeForJson.Source -e @"
const fs = require('fs')
const path = process.argv[1]
const raw = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
const pkg = JSON.parse(raw)
const [major, minor, patch] = pkg.version.split('-')[0].split('.').map(Number)
pkg.version = major + '.' + minor + '.' + (patch + 1)
fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
console.log(pkg.version)
"@ $pkgPath
  $next = ($next | Select-Object -Last 1).Trim()
  Write-Log "版本 $current → $next"

  $range = if ($last) { "$last..HEAD" } else { 'HEAD' }
  $subjects = (git log --no-merges --pretty='- %s' $range) -join "`n"
  $body = (Get-Content $changelogPath -Raw) -replace '(?s)^# Changelog\r?\n', ''
  $header = "# Changelog`n`n## $next — $((Get-Date).ToString('yyyy-MM-dd'))`n`n"
  Set-Content $changelogPath ($header + $subjects + "`n" + $body) -Encoding utf8 -NoNewline

  git add package.json CHANGELOG.md
  git -c user.name=Lovenndme -c user.email=catherineessie773@gmail.com commit -q -m "release: v$next"
  if (-not $NoPush) { git push origin HEAD | Out-Null; Write-Log '发布提交已推送' }

  $verify = Join-Path (Split-Path $repo -Parent) 'profile-stats-verify'
  $nodePath = (Get-Command node -ErrorAction SilentlyContinue)
  if (-not $nodePath) {
    $bundled = Join-Path $HOME '.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/node/bin/node.exe'
    if (Test-Path $bundled) { $nodePath = [pscustomobject]@{ Source = $bundled } }
  }
  if ($nodePath -and (Test-Path (Join-Path $verify 'client-smoke.mjs'))) {
    & $nodePath.Source (Join-Path $verify 'client-smoke.mjs') *> $null
    if ($LASTEXITCODE -ne 0) { Write-Log '客户端冒烟测试失败，已提交但不发布'; exit 1 }
    & $nodePath.Source (Join-Path $verify 'host-integration.mjs') *> $null
    if ($LASTEXITCODE -ne 0) { Write-Log '宿主集成测试失败，已提交但不发布'; exit 1 }
    Write-Log '测试通过'
  }

  $token = Get-Token
  $auth = "//registry.npmjs.org/:_authToken=$token"
  $npmCmd = (Get-Command npm -ErrorAction SilentlyContinue)
  $previousEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = (& $npmCmd.Source publish --access public "--$auth" 2>&1 | Out-String)
  } catch {
    $output = "exception: $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $previousEap
  }
  Remove-Item Env:NPM_TOKEN -ErrorAction SilentlyContinue
  if ($output -match 'npm error' -or $output -match 'exception:') {
    Write-Log "发布失败：$($output.Trim())"
    exit 1
  }
  Write-Log "已发布 $next"

  git tag "v$next" 2>$null
  if (-not $NoPush) { git push origin "v$next" | Out-Null }
  Write-Log "已打标签 v$next"
} finally {
  Pop-Location
}
