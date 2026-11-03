#!/usr/bin/env bash
# 알리 주문 통계 - 설치 프로그램 (macOS / Linux)
#
#   ./installer/unix/install.sh            저장소를 받은 폴더에서 실행
#   ./installer/unix/install.sh --no-schedule   자동 업데이트 예약 없이 설치
#
# 1) 확장 파일을 고정된 설치 폴더로 복사 (경로가 바뀌지 않아야 크롬이 계속 같은 확장으로 인식)
# 2) 6시간마다 GitHub 에서 새 버전을 받는 업데이터 예약 (macOS launchd / Linux systemd 사용자 타이머 또는 cron)
# 3) 크롬 확장 프로그램 페이지를 열고, 설치 폴더 경로를 클립보드에 복사
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_EXT="$(cd "$HERE/../.." && pwd)/aliexpress-stats"
SCHEDULE=1
[ "${1:-}" = "--no-schedule" ] && SCHEDULE=0

if [ "$(uname -s)" = "Darwin" ]; then OS=mac; DEF_HOME="$HOME/Library/Application Support/AliOrderStats"
else OS=linux; DEF_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/ali-order-stats"; fi
export AOS_HOME="${AOS_HOME:-$DEF_HOME}"
mkdir -p "$AOS_HOME"
cp "$HERE/update.sh" "$HERE/uninstall.sh" "$AOS_HOME/"
chmod +x "$AOS_HOME/update.sh" "$AOS_HOME/uninstall.sh"

echo "▶ 확장 설치: $AOS_HOME/extension"
if [ -f "$REPO_EXT/manifest.json" ]; then AOS_SOURCE="$REPO_EXT" "$AOS_HOME/update.sh" --force
else "$AOS_HOME/update.sh" --force; fi

if [ "$SCHEDULE" -eq 1 ]; then
  if [ "$OS" = mac ]; then
    PLIST="$HOME/Library/LaunchAgents/com.aliorderstats.updater.plist"
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.aliorderstats.updater</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$AOS_HOME/update.sh</string></array>
  <key>EnvironmentVariables</key><dict><key>AOS_HOME</key><string>$AOS_HOME</string></dict>
  <key>StartInterval</key><integer>21600</integer>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST"
    echo "▶ 자동 업데이트 예약: launchd (6시간마다)"
  elif command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1; then
    UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
    mkdir -p "$UNIT_DIR"
    printf '[Unit]\nDescription=AliOrderStats updater\n\n[Service]\nType=oneshot\nEnvironment="AOS_HOME=%s"\nExecStart=/bin/bash "%s/update.sh"\n' "$AOS_HOME" "$AOS_HOME" > "$UNIT_DIR/aliorderstats-update.service"
    printf '[Unit]\nDescription=AliOrderStats updater timer\n\n[Timer]\nOnBootSec=5min\nOnUnitActiveSec=6h\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n' > "$UNIT_DIR/aliorderstats-update.timer"
    systemctl --user daemon-reload
    systemctl --user enable --now aliorderstats-update.timer >/dev/null
    echo "▶ 자동 업데이트 예약: systemd 사용자 타이머 (6시간마다)"
  elif command -v crontab >/dev/null 2>&1; then
    LINE="0 */6 * * * AOS_HOME=\"$AOS_HOME\" /bin/bash \"$AOS_HOME/update.sh\" >/dev/null 2>&1 # aliorderstats"
    ( crontab -l 2>/dev/null | grep -v '# aliorderstats' || true; echo "$LINE" ) | crontab -
    echo "▶ 자동 업데이트 예약: cron (6시간마다)"
  else
    echo "▶ 자동 업데이트를 예약할 방법이 없습니다. 필요할 때 $AOS_HOME/update.sh 를 실행하세요."
  fi
fi

EXT="$AOS_HOME/extension"
COPIED=""
for c in pbcopy wl-copy xclip xsel; do
  if command -v "$c" >/dev/null 2>&1; then
    case "$c" in xclip) printf '%s' "$EXT" | xclip -selection clipboard ;; xsel) printf '%s' "$EXT" | xsel -b ;; *) printf '%s' "$EXT" | "$c" ;; esac
    COPIED=" (클립보드에 복사됨)"; break
  fi
done

if [ "$OS" = mac ]; then open -a "Google Chrome" "chrome://extensions" >/dev/null 2>&1 || true
else for b in google-chrome google-chrome-stable chromium chromium-browser; do command -v "$b" >/dev/null 2>&1 && { "$b" chrome://extensions >/dev/null 2>&1 & break; }; done; fi

cat <<EOF

설치 폴더: $EXT$COPIED

크롬에 처음 한 번만 등록하면 됩니다.
  1. chrome://extensions 열기
  2. 오른쪽 위 "개발자 모드" 켜기
  3. "압축해제된 확장 프로그램을 로드합니다" → 위 설치 폴더 선택

이후 업데이트는 자동으로 적용됩니다. 제거: "$AOS_HOME/uninstall.sh"
EOF
