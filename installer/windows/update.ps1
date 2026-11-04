# 알리 주문 통계 - 업데이터 (Windows)
# GitHub 의 최신 버전이 설치된 버전보다 높으면 확장 폴더를 교체한다.
# 크롬은 다음 확인 주기(최대 30분) 또는 재시작 때 새 버전을 스스로 다시 로드한다.
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\AliOrderStats",
  [string]$Repo = 'waitle/Social-Credit-Stats',
  [string]$Branch = 'main',
  [string]$Source = '',          # GitHub 대신 로컬 aliexpress-stats 폴더에서 설치
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ext = Join-Path $InstallDir 'extension'
$log = Join-Path $InstallDir 'update.log'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
function Write-Log($m) { $line = "$(Get-Date -Format s) $m"; Add-Content -Path $log -Value $line -Encoding UTF8; Write-Host $line }
# raw.githubusercontent.com 은 JSON 을 text/plain 으로 내려줘서 Invoke-RestMethod 가 자동으로 해석하지 못한다 → 직접 파싱
function Get-Json($url) {
  $r = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers @{ 'Cache-Control' = 'no-cache' }
  $text = [Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()).TrimStart([char]0xFEFF)
  return $text | ConvertFrom-Json
}
function Get-Ver($dir) { $p = Join-Path $dir 'manifest.json'; if (Test-Path $p) { (Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json).version } }

$cur = Get-Ver $ext
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("aos-" + [guid]::NewGuid().ToString('N'))
try {
  if ($Source) {
    $src = (Resolve-Path $Source).Path
  } else {
    $remote = (Get-Json "https://raw.githubusercontent.com/$Repo/$Branch/aliexpress-stats/manifest.json").version
    if (-not $remote) { throw '원격 버전을 읽지 못했습니다' }
    Write-Log "설치본 $(if ($cur) { $cur } else { '없음' }) / 원격 $remote"
    if (-not $Force -and $cur -and ([version]$remote -le [version]$cur)) { Write-Log "최신 버전 사용 중 ($cur)"; return }
    New-Item -ItemType Directory -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'src.zip'
    Invoke-WebRequest -UseBasicParsing "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $zip
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $src = Get-ChildItem $tmp -Directory | ForEach-Object { Join-Path $_.FullName 'aliexpress-stats' } |
      Where-Object { Test-Path (Join-Path $_ 'manifest.json') } | Select-Object -First 1
  }
  if (-not $src -or -not (Test-Path (Join-Path $src 'manifest.json'))) { throw '확장 파일을 찾지 못했습니다' }
  $new = Get-Ver $src
  if (-not $Force -and $cur -and $Source -and ([version]$new -le [version]$cur)) { Write-Log "최신 버전 사용 중 ($cur)"; return }

  # robocopy /MIR: 설치 폴더를 새 버전과 똑같이 맞춘다 (폴더 경로는 그대로 → 크롬이 같은 확장으로 인식)
  New-Item -ItemType Directory -Force -Path $ext | Out-Null
  & robocopy $src $ext /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS /NP | Out-Null   # 파일이 잠겨 있어도 무한정 기다리지 않는다
  if ($LASTEXITCODE -ge 8) { throw "파일 복사 실패 (robocopy $LASTEXITCODE)" }
  Write-Log "업데이트 완료 $(if ($cur) { $cur } else { '없음' }) → $new"
} finally {
  if (Test-Path $tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
