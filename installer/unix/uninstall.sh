#!/usr/bin/env bash
# 알리 주문 통계 - 제거 (자동 업데이트 예약 해제 + 설치 폴더 삭제)
# 크롬에 등록된 확장은 chrome://extensions 에서 직접 "삭제" 하세요.
set -euo pipefail

if [ "$(uname -s)" = "Darwin" ]; then DEF_HOME="$HOME/Library/Application Support/AliOrderStats"
else DEF_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/ali-order-stats"; fi
AOS_HOME="${AOS_HOME:-$DEF_HOME}"

PLIST="$HOME/Library/LaunchAgents/com.aliorderstats.updater.plist"
if [ -f "$PLIST" ]; then launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload "$PLIST" >/dev/null 2>&1 || true; rm -f -- "$PLIST"; fi
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
if [ -f "$UNIT_DIR/aliorderstats-update.timer" ]; then
  systemctl --user disable --now aliorderstats-update.timer >/dev/null 2>&1 || true
  rm -f -- "$UNIT_DIR/aliorderstats-update.timer" "$UNIT_DIR/aliorderstats-update.service"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi
if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -q '# aliorderstats'; then
  crontab -l 2>/dev/null | grep -v '# aliorderstats' | crontab -
fi

case "$AOS_HOME" in
  */AliOrderStats|*/ali-order-stats) [ -d "$AOS_HOME" ] && rm -rf -- "$AOS_HOME" ;;
  *) echo "설치 폴더 이름이 예상과 달라 삭제하지 않았습니다: $AOS_HOME" ;;
esac
echo "제거 완료. 크롬의 chrome://extensions 에서 '알리 주문 통계'도 삭제하세요."
