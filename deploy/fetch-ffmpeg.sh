#!/usr/bin/env bash
# ── 取一份静态 ffmpeg（给视频出海报帧用） ──
#
# 为什么是"随部署产物走"的静态二进制，而不是 apt 装一份：
# 远端版本会随发行版漂移、可能要 root、更新时还可能被换掉。
# 后端只认 FFMPEG_PATH > 应用同目录 bin/ffmpeg > PATH 这个顺序
# （见 src/shared/config.rs 的 resolve_ffmpeg），所以把它放在 bin/ 下即可。
#
# 为什么必须校验 sha256：这是一段要跑在服务器上、还要解不可信视频的二进制。
# 首次获取请按脚本提示把 sha256 写进 deploy/ffmpeg.lock —— 不填就拒绝下载，
# 宁可多一步人工，也不装一个来路不明的东西。
#
# 许可：johnvansickle 的静态构建是 **GPLv3**。这里以**子进程**方式调用（不链接
# libav*），所以不构成对本项目的传染；但把二进制随产物发出去时，别把这句话删了。
#
# 体积：ffmpeg 与 ffprobe 各约 77MB。ffprobe 只用于给"浏览器读不出容器"的视频
# 回填时长，所以**发布时默认不带它**（见 Makefile / deploy.sh 的 WITH_FFPROBE）。
#
# 用法：
#   deploy/fetch-ffmpeg.sh          # 下载 + 校验 + 解出 ffmpeg/ffprobe 到 vendor/ffmpeg/bin/
#   make fetch-ffmpeg
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_FILE="$PROJECT_DIR/deploy/ffmpeg.lock"
DEST_DIR="$PROJECT_DIR/vendor/ffmpeg"
BIN_DIR="$DEST_DIR/bin"

log()  { printf '\033[0;36m[fetch-ffmpeg]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[fetch-ffmpeg]\033[0m %s\n' "$*" >&2; exit 1; }

[ -f "$LOCK_FILE" ] || die "缺少 $LOCK_FILE（一行：<版本> <sha256>）"

read -r VERSION EXPECTED_SHA <<<"$(grep -v '^\s*#' "$LOCK_FILE" | grep -v '^\s*$' | head -1 || true)"
[ -n "${VERSION:-}" ] || die "$LOCK_FILE 里没有版本号"
[ -n "${EXPECTED_SHA:-}" ] || die "$LOCK_FILE 里没有 sha256"

case "$EXPECTED_SHA" in
	__*|PENDING*|TODO*|"")
		die "尚未固定校验和。首次获取请：
  curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-$VERSION-amd64-static.tar.xz -o /tmp/ffmpeg.tar.xz
  sha256sum /tmp/ffmpeg.tar.xz
然后把 <版本> <sha256> 写进 $LOCK_FILE 再重跑。"
		;;
esac

URL="https://johnvansickle.com/ffmpeg/releases/ffmpeg-$VERSION-amd64-static.tar.xz"

log "下载 $URL"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
curl -fsSL "$URL" -o "$TMP_DIR/ffmpeg.tar.xz" || die "下载失败（版本号或网络问题）"

log "校验 sha256"
ACTUAL_SHA="$(sha256sum "$TMP_DIR/ffmpeg.tar.xz" | awk '{print $1}')"
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
	die "sha256 不匹配：
  期望 $EXPECTED_SHA
  实得 $ACTUAL_SHA
（换了版本就必须一起换 lock 文件里的哈希）"
fi

log "解出 ffmpeg / ffprobe"
mkdir -p "$TMP_DIR/extract"
tar -xJf "$TMP_DIR/ffmpeg.tar.xz" -C "$TMP_DIR/extract"
EXTRACTED="$(find "$TMP_DIR/extract" -maxdepth 1 -type d -name 'ffmpeg-*' | head -1)"
[ -n "$EXTRACTED" ] || die "压缩包里没找到 ffmpeg-* 目录"

mkdir -p "$BIN_DIR"
# ffprobe 是可选能力（用来回填旧视频的时长）：有就一起带上，没有也不影响出图
for bin in ffmpeg ffprobe; do
	if [ -f "$EXTRACTED/$bin" ]; then
		install -m 0755 "$EXTRACTED/$bin" "$BIN_DIR/$bin"
	else
		log "压缩包里没有 $bin（可选）"
	fi
done

[ -x "$BIN_DIR/ffmpeg" ] || die "解出来的 ffmpeg 不可执行"

log "完成：$("$BIN_DIR/ffmpeg" -version 2>/dev/null | head -1)"
log "产物：$BIN_DIR/ffmpeg（make build-backend 会拷进 build/bin/，随部署一起走）"
