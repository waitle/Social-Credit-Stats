# 알리 주문 통계 - 설치 프로그램 (Windows)
#   저장소를 받은 폴더에서 installer\windows\install.cmd 를 더블클릭하거나
#   powershell -ExecutionPolicy Bypass -File installer\windows\install.ps1
#
# 1) 확장 파일을 %LOCALAPPDATA%\AliOrderStats\extension 으로 복사 (고정 경로)
# 2) 작업 스케줄러에 6시간마다 업데이트 확인 등록 (관리자 권한 불필요)
# 3) 크롬 확장 프로그램 페이지를 열고, 설치 폴더 경로를 클립보드에 복사
param(
  [string]$InstallDir = "$env:LOCALAPPDATA\AliOrderStats",
  [string]$Repo = 'waitle/Social-Credit-Stats',
  [string]$Branch = 'main',
  [switch]$NoSchedule
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot 'update.ps1'), (Join-Path $PSScriptRoot 'uninstall.ps1') -Destination $InstallDir -Force

Write-Host "▶ 확장 설치: $InstallDir\extension"
$local = Join-Path $PSScriptRoot '..\..\aliexpress-stats'
if (Test-Path (Join-Path $local 'manifest.json')) {
  & (Join-Path $InstallDir 'update.ps1') -InstallDir $InstallDir -Source $local -Force
} else {
  & (Join-Path $InstallDir 'update.ps1') -InstallDir $InstallDir -Repo $Repo -Branch $Branch -Force
}

if (-not $NoSchedule) {
  # 작업 스케줄러 명령은 261자 제한이 있어 짧은 실행 파일을 거친다
  $runner = Join-Path $InstallDir 'run-update.cmd'
  Set-Content -Path $runner -Encoding ASCII -Value "@powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"%~dp0update.ps1`" -InstallDir `"%~dp0.`" -Repo $Repo -Branch $Branch"
  & schtasks.exe /Create /F /SC HOURLY /MO 6 /TN 'AliOrderStats Updater' /TR "`"$runner`"" | Out-Null
  if ($LASTEXITCODE -eq 0) { Write-Host '▶ 자동 업데이트 예약: 작업 스케줄러 (6시간마다)' }
  else { Write-Host "▶ 자동 업데이트를 예약하지 못했습니다. 필요할 때 $runner 를 실행하세요." }
}

$ext = Join-Path $InstallDir 'extension'
try { Set-Clipboard -Value $ext; $copied = ' (클립보드에 복사됨)' } catch { $copied = '' }
try { Start-Process 'chrome.exe' 'chrome://extensions' } catch { }

Write-Host ""
Write-Host "설치 폴더: $ext$copied"
Write-Host ""
Write-Host "크롬에 처음 한 번만 등록하면 됩니다."
Write-Host "  1. chrome://extensions 열기"
Write-Host "  2. 오른쪽 위 '개발자 모드' 켜기"
Write-Host "  3. '압축해제된 확장 프로그램을 로드합니다' → 위 설치 폴더 선택 (Ctrl+V 로 경로 붙여넣기)"
Write-Host ""
Write-Host "이후 업데이트는 자동으로 적용됩니다. 제거: $InstallDir\uninstall.ps1"
