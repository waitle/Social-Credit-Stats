# 알리 주문 통계 - 제거 (자동 업데이트 예약 해제 + 설치 폴더 삭제)
# 크롬에 등록된 확장은 chrome://extensions 에서 직접 "삭제" 하세요.
param([string]$InstallDir = "$env:LOCALAPPDATA\AliOrderStats")
$ErrorActionPreference = 'Continue'
& schtasks.exe /Delete /F /TN 'AliOrderStats Updater' 2>$null | Out-Null
if ((Split-Path $InstallDir -Leaf) -eq 'AliOrderStats' -and (Test-Path $InstallDir)) {
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
} else {
  Write-Host "설치 폴더 이름이 예상과 달라 삭제하지 않았습니다: $InstallDir"
}
Write-Host "제거 완료. 크롬의 chrome://extensions 에서 '알리 주문 통계'도 삭제하세요."
