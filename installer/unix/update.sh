#!/usr/bin/env bash
# 알리 주문 통계 - 업데이터 (macOS / Linux)
# GitHub 의 최신 버전이 설치된 버전보다 높으면 확장 폴더를 교체한다.
# 크롬은 다음 확인 주기(최대 30분) 또는 재시작 때 새 버전을 스스로 다시 로드한다.
#
#   AOS_HOME          설치 폴더 (기본: macOS ~/Library/Application Support/AliOrderStats, Linux ~/.local/share/ali-order-stats)
#   AOS_REPO          GitHub 저장소 (기본 waitle/Social-Credit-Stats)
#   AOS_BRANCH        브랜치 (기본 main)
#   AOS_SOURCE        GitHub 대신 로컬 폴더(aliexpress-stats)에서 설치
#   AOS_MANIFEST_URL  최신 manifest 주소 (기본: raw.githubusercontent.com)
#   AOS_ZIP_URL       소스 zip 주소 (기본: codeload.github.com)
#   인자 --force      버전과 관계없이 다시 설치
set -euo pipefail

default_home() {
  if [ "$(uname -s)" = "Darwin" ]; then echo "$HOME/Library/Application Support/AliOrderStats"
  else echo "${XDG_DATA_HOME:-$HOME/.local/share}/ali-order-stats"; fi
}
HOME_DIR="${AOS_HOME:-$(default_home)}"
REPO="${AOS_REPO:-waitle/Social-Credit-Stats}"
BRANCH="${AOS_BRANCH:-main}"
MANIFEST_URL="${AOS_MANIFEST_URL:-https://raw.githubusercontent.com/$REPO/$BRANCH/aliexpress-stats/manifest.json}"
ZIP_URL="${AOS_ZIP_URL:-https://codeload.github.com/$REPO/zip/refs/heads/$BRANCH}"
EXT_DIR="$HOME_DIR/extension"
LOG="$HOME_DIR/update.log"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

mkdir -p "$HOME_DIR"
log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$*" | tee -a "$LOG" >&2; }
ver_of() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -1; }
newer() { [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -1)" = "$2" ]; }   # $2 > $1

CUR=""
[ -f "$EXT_DIR/manifest.json" ] && CUR="$(ver_of "$EXT_DIR/manifest.json")"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/aos-update.XXXXXX")"
trap 'rm -rf -- "$TMP"' EXIT

if [ -n "${AOS_SOURCE:-}" ]; then
  SRC="$AOS_SOURCE"
else
  REMOTE="$(curl -fsSL --max-time 30 "$MANIFEST_URL" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1 || true)"
  if [ -z "$REMOTE" ]; then log "최신 버전을 확인하지 못했습니다 ($MANIFEST_URL)"; exit 1; fi
  log "설치본 ${CUR:-없음} / 원격 $REMOTE"
  if [ "$FORCE" -eq 0 ] && [ -n "$CUR" ] && ! newer "$CUR" "$REMOTE"; then log "최신 버전 사용 중 ($CUR)"; exit 0; fi
  curl -fsSL --max-time 120 -o "$TMP/src.zip" "$ZIP_URL"
  if command -v unzip >/dev/null 2>&1; then unzip -q "$TMP/src.zip" -d "$TMP/src"
  else python3 -m zipfile -e "$TMP/src.zip" "$TMP/src"; fi
  SRC="$(find "$TMP/src" -maxdepth 3 -type f -path '*/aliexpress-stats/manifest.json' | head -1 | xargs -I{} dirname {})"
fi

if [ -z "${SRC:-}" ] || [ ! -f "$SRC/manifest.json" ]; then log "확장 파일을 찾지 못했습니다"; exit 1; fi
NEW_VER="$(ver_of "$SRC/manifest.json")"
if [ "$FORCE" -eq 0 ] && [ -n "$CUR" ] && [ -n "${AOS_SOURCE:-}" ] && ! newer "$CUR" "$NEW_VER"; then log "최신 버전 사용 중 ($CUR)"; exit 0; fi

# 새 폴더를 다 만든 뒤 이름만 바꿔 교체 → 중간에 실패해도 기존 설치가 망가지지 않는다
STAGE="$HOME_DIR/extension.new"
OLD="$HOME_DIR/extension.old"
rm -rf -- "$STAGE" "$OLD"
cp -R "$SRC" "$STAGE"
[ -d "$EXT_DIR" ] && mv "$EXT_DIR" "$OLD"
mv "$STAGE" "$EXT_DIR"
rm -rf -- "$OLD"
log "업데이트 완료 ${CUR:-없음} → $NEW_VER"
