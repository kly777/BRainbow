#!/bin/bash
# ============================================================================
# Brainbow 部署工具集
# 用法: ./scripts/deploy.sh <子命令> [选项]
#
# 子命令:
#   check             环境检查（Caddy、SSH 连通性、二进制存在性）
#   deploy            全量部署（stop → backup → sync → start）
#   health            健康检查（后端 API + Caddy + 前端静态页）
#   rollback [名称]   回滚到指定备份（默认最新）
#   list-backups      查看可用的备份
#   build             构建前端+后端（先 ts-check 再编译）
#
# 环境变量（来自 .env.prod）:
#   REMOTE_HOST, REMOTE_USER, APP_NAME, REMOTE_PORT, REMOTE_BASE,
#   SERVICE_PORT, BIND_HOST, DATABASE_FILE, CORS_ALLOW_ORIGIN
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 颜色 ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; NC='\033[0m'
log_info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
log_done()  { echo -e "${GREEN}[DONE]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERR]${NC}  $1"; }

# ===================================================================
# 配置加载
# ===================================================================
load_config() {
    local env_file="${1:-$PROJECT_DIR/.env.prod}"
    if [ ! -f "$env_file" ]; then
        log_error "配置文件 $env_file 不存在"
        log_info "请创建 .env.prod（可复制 .env.example）"
        exit 1
    fi

    set -o allexport
    # shellcheck source=/dev/null
    source "$env_file"
    set +o allexport

    # 必需项
    local required_vars=("REMOTE_HOST" "REMOTE_USER" "APP_NAME")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ] || [ "${!var}" = "your-server-ip-or-domain.com" ]; then
            log_error "缺少必需配置: $var"
            exit 1
        fi
    done

    # 默认值
    REMOTE_PORT="${REMOTE_PORT:-22}"
    REMOTE_BASE="${REMOTE_BASE:-/opt}"
    SERVICE_PORT="${SERVICE_PORT:-8080}"
    BIND_HOST="${BIND_HOST:-0.0.0.0}"
    DATABASE_FILE="${DATABASE_FILE:-brainbow.db}"
    CORS_ALLOW_ORIGIN="${CORS_ALLOW_ORIGIN:-http://localhost:3000,http://localhost:5173}"
    BUILD_TARGET="${BUILD_TARGET:-native}"

    REMOTE_DIR="$REMOTE_BASE/$APP_NAME"
    BACKUP_DIR="$REMOTE_BASE/${APP_NAME}_backups"
    SSH_CMD="ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST"
    SCP_CMD="scp -P $REMOTE_PORT"
    RSYNC_CMD="rsync -avz -e \"ssh -p $REMOTE_PORT\""
}

# ===================================================================
# SSH / Rsync 辅助
# ===================================================================
remote() {
    $SSH_CMD "$@"
}

# ===================================================================
# 子命令: check — 环境检查
# ===================================================================
cmd_check() {
    load_config
    echo "═══════════════════════════════════════════"
    log_info "环境检查: $APP_NAME → $REMOTE_HOST"
    echo "═══════════════════════════════════════════"

    # 1. SSH 连通性
    if remote "echo ok" 2>/dev/null | grep -q ok; then
        log_done "SSH 连接正常 ($REMOTE_USER@$REMOTE_HOST)"
    else
        log_error "SSH 连接失败，请检查: ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST"
        exit 1
    fi

    # 2. Caddy 已安装
    if remote "command -v caddy" >/dev/null 2>&1; then
        log_done "Caddy 已安装"
    else
        log_error "远程服务器未安装 Caddy"
        log_info "请先安装: ssh ... 'sudo apt install caddy'"
        exit 1
    fi

    # 3. Caddy 配置验证
    if remote "timeout 10 caddy validate --config /etc/caddy/Caddyfile 2>&1" | grep -q "Valid configuration"; then
        log_done "Caddy 配置有效"
    else
        log_error "Caddy 配置无效，请检查 /etc/caddy/Caddyfile"
        exit 1
    fi

    # 4. Caddy 运行中
    if remote "systemctl is-active caddy 2>/dev/null" | grep -q "active"; then
        log_done "Caddy 服务运行中"
    else
        log_warn "Caddy 未运行！请手动启动"
    fi

    # 5. 本地构建产物
    local binary="$PROJECT_DIR/build/brainbow"
    local dist="$PROJECT_DIR/build/dist"
    if [ -f "$binary" ]; then
        log_done "后端二进制存在 ($(du -h "$binary" | cut -f1))"
    else
        log_warn "后端二进制不存在，请先执行: make build 或 ./scripts/deploy.sh build"
    fi
    if [ -d "$dist" ] && [ -f "$dist/index.html" ]; then
        log_done "前端构建产物存在 ($(du -sh "$dist" | cut -f1))"
    else
        log_warn "前端构建产物不存在，请先执行: make build 或 ./scripts/deploy.sh build"
    fi

    log_done "环境检查通过"
}

# ===================================================================
# 子命令: build — 构建（前端 tsc-check → vite → cargo）
# ===================================================================
cmd_build() {
    load_config
    echo "═══════════════════════════════════════════"
    log_info "构建 $APP_NAME"
    echo "═══════════════════════════════════════════"

    # 1. 前端类型检查
    log_info "前端类型检查..."
    (cd "$PROJECT_DIR/web" && npx tsc --noEmit) || {
        log_warn "TypeScript 检查未通过，是否继续构建？(y/n) "
        read -r ans
        [ "$ans" != "y" ] && { log_info "已取消"; exit 1; }
    }

    # 2. 前端构建
    log_info "前端构建 (vite)..."
    (cd "$PROJECT_DIR/web" && npx vite build)
    log_done "前端构建完成"

    # 3. 后端构建
    local build_cmd="cargo build --release"
    local bin_path="target/release/brainbow"
    if [ "$BUILD_TARGET" != "native" ] && [ -n "$BUILD_TARGET" ]; then
        build_cmd="cargo build --release --target $BUILD_TARGET"
        bin_path="target/$BUILD_TARGET/release/brainbow"
        log_info "后端构建 (cross-compile: $BUILD_TARGET)..."
    else
        log_info "后端构建 (cargo --release)..."
    fi
    (cd "$PROJECT_DIR" && eval "$build_cmd")
    log_done "后端构建完成"

    # 4. 清理并复制产物到 build/
    rm -rf "$PROJECT_DIR/build"
    mkdir -p "$PROJECT_DIR/build"
    cp -r "$PROJECT_DIR/web/dist" "$PROJECT_DIR/build/dist"
    if [ -f "$PROJECT_DIR/$bin_path" ]; then
        cp "$PROJECT_DIR/$bin_path" "$PROJECT_DIR/build/brainbow"
    else
        log_error "构建产物不存在: $bin_path"
        exit 1
    fi
    log_done "构建产物已整理到 build/"
    log_info "  binary: build/brainbow ($(du -h "$PROJECT_DIR/build/brainbow" | cut -f1))"
    log_info "  dist:   build/dist ($(du -sh "$PROJECT_DIR/build/dist" | cut -f1))"
}

# ===================================================================
# 子命令: deploy — 全量部署
# ===================================================================
cmd_deploy() {
    load_config
    echo "═══════════════════════════════════════════"
    log_info "部署 $APP_NAME → $REMOTE_HOST"
    echo "═══════════════════════════════════════════"

    # 前置检查
    local binary="$PROJECT_DIR/build/brainbow"
    local dist="$PROJECT_DIR/build/dist"
    if [ ! -f "$binary" ]; then
        log_error "后端二进制不存在: $binary"
        log_info "请先执行: ./scripts/deploy.sh build"
        exit 1
    fi
    if [ ! -d "$dist" ] || [ ! -f "$dist/index.html" ]; then
        log_error "前端构建产物不存在: $dist"
        log_info "请先执行: ./scripts/deploy.sh build"
        exit 1
    fi

    # Step 1: 停止远程服务
    log_info "停止远程服务..."
    remote "sudo systemctl stop $APP_NAME 2>/dev/null || true"
    log_done "已停止"

    # Step 2: 备份
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    log_info "备份当前版本..."
    remote "mkdir -p $BACKUP_DIR && \
        if [ -d $REMOTE_DIR ]; then \
            tar -czf $BACKUP_DIR/${APP_NAME}_backup_${timestamp}.tar.gz \
                -C $REMOTE_BASE $APP_NAME; \
            echo \"已创建备份: ${APP_NAME}_backup_${timestamp}.tar.gz\"; \
        fi" | while IFS= read -r line; do log_info "$line"; done
    log_done "备份完成"

    # Step 3: 同步文件
    # 前端文件放到 dist/ 子目录（Caddy 配置期望）
    # --exclude=$DATABASE_FILE 等保护远端数据不被 --delete 误删
    log_info "同步前端 + 后端..."
    # 先同步二进制到根目录
    eval "rsync -avz -e \"ssh -p $REMOTE_PORT\" \
        $binary $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/" 2>&1 | tail -3
    # 再同步前端到 dist/ 子目录
    eval "rsync -avz --delete -e \"ssh -p $REMOTE_PORT\" \
        $dist/ $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/dist/" 2>&1 | tail -3
    log_done "同步完成"

    # Step 4: 设置权限
    log_info "设置权限..."
    remote "\
        find $REMOTE_DIR -type d -exec chmod 755 {} \; 2>/dev/null; \
        find $REMOTE_DIR -type f -exec chmod 644 {} \; 2>/dev/null; \
        chmod +x $REMOTE_DIR/brainbow 2>/dev/null; \
        [ -f $REMOTE_DIR/$DATABASE_FILE ] && chmod 666 $REMOTE_DIR/$DATABASE_FILE || true"
    log_done "权限设置完成"

    # Step 5: 配置 systemd 服务（安装时只需一次，每次部署只用 restart）
    setup_systemd

    # Step 6: 启动服务
    log_info "启动服务..."
    remote "sudo systemctl daemon-reload && sudo systemctl enable $APP_NAME && sudo systemctl start $APP_NAME"
    log_done "服务已启动"

    # Step 7: 等待服务就绪
    wait_for_ready

    # Step 8: 重载 Caddy
    log_info "重载 Caddy..."
    remote "sudo systemctl reload caddy 2>/dev/null || sudo systemctl restart caddy" && \
        log_done "Caddy 已重载" || log_warn "Caddy 重载失败"

    echo ""
    log_done "部署完成"
}

setup_systemd() {
    log_info "确保 systemd 服务存在..."
    remote "\
        if [ ! -f /etc/systemd/system/$APP_NAME.service ]; then \
            sudo tee /etc/systemd/system/$APP_NAME.service > /dev/null << 'SERVICE'
[Unit]
Description=Brainbow Application
After=network.target

[Service]
Type=simple
User=$REMOTE_USER
WorkingDirectory=$REMOTE_DIR
ExecStart=$REMOTE_DIR/brainbow
Restart=on-failure
RestartSec=5
MemoryMax=1024M
CPUQuota=80%
Environment=\"RUST_LOG=info\"
Environment=\"SERVICE_PORT=$SERVICE_PORT\"
Environment=\"BIND_HOST=$BIND_HOST\"
Environment=\"DATABASE_URL=sqlite:$REMOTE_DIR/$DATABASE_FILE\"
Environment=\"CORS_ALLOW_ORIGIN=$CORS_ALLOW_ORIGIN\"

[Install]
WantedBy=multi-user.target
SERVICE
        fi" > /dev/null 2>&1
}

wait_for_ready() {
    log_info "等待服务就绪..."
    local max_attempts=30
    local attempt=0
    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))
        if remote "curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 http://localhost:$SERVICE_PORT/api/health 2>/dev/null" 2>/dev/null | grep -q "200"; then
            log_done "服务就绪（第 ${attempt} 次探测）"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo ""
    log_error "服务启动超时（${max_attempts}s），请检查: make logs"
    return 1
}

# ===================================================================
# 子命令: health — 健康检查
# ===================================================================
cmd_health() {
    load_config
    echo "═══════════════════════════════════════════"
    log_info "健康检查: $APP_NAME  on  $REMOTE_HOST"
    echo "═══════════════════════════════════════════"

    local ok=0 total=0

    # 1. 后端 health endpoint（直连）
    total=$((total + 1))
    local code
    code=$(remote "curl -s -o /dev/null -w '%{http_code}' http://localhost:$SERVICE_PORT/api/health 2>/dev/null || echo '000'")
    if [ "$code" = "200" ]; then
        log_done "后端 API (直连) → HTTP $code"
        ok=$((ok + 1))
    else
        log_error "后端 API (直连) → HTTP $code"
    fi

    # 2. 通过 Caddy HTTPS（用域名验证，证书绑定 brainbow.top）
    total=$((total + 1))
    code=$(remote "curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://brainbow.top/api/health 2>/dev/null || echo '000'")
    if [ "$code" = "200" ]; then
        log_done "后端 API (Caddy) → HTTP $code"
        ok=$((ok + 1))
    else
        log_error "后端 API (Caddy) → HTTP $code"
    fi

    # 3. 前端 SPA（通过 Caddy HTTPS）
    total=$((total + 1))
    code=$(remote "curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://brainbow.top/ 2>/dev/null || echo '000'")
    if [ "$code" = "200" ]; then
        log_done "前端 SPA (Caddy) → HTTP $code"
        ok=$((ok + 1))
    else
        log_error "前端 SPA (Caddy) → HTTP $code"
    fi

    # 4. 服务进程
    total=$((total + 1))
    if remote "systemctl is-active $APP_NAME 2>/dev/null" | grep -q "active"; then
        log_done "systemd 服务运行中"
        ok=$((ok + 1))
    else
        log_error "systemd 服务未运行"
    fi

    # 5. 资源使用（仅信息展示）
    remote "ps aux | grep brainbow | grep -v grep | awk '{print \$11, \$3, \$4}'" 2>/dev/null | while IFS= read -r line; do
        [ -n "$line" ] && log_info "进程资源: CPU=${line#* }"
    done
    log_info "二进制: $(remote "ls -lh $REMOTE_DIR/brainbow 2>/dev/null | awk '{print \$5}'" 2>/dev/null || echo 'N/A')"
    log_info "数据库: $(remote "ls -lh $REMOTE_DIR/$DATABASE_FILE 2>/dev/null | awk '{print \$5}'" 2>/dev/null || echo 'N/A')"

    echo ""
    log_info "检查结果: $ok/$total"
    if [ "$ok" -eq "$total" ]; then
        log_done "全部正常"
    else
        log_warn "$((total - ok)) 项异常"
    fi
}

# ===================================================================
# 子命令: rollback — 回滚
# ===================================================================
cmd_rollback() {
    load_config
    local backup_name="${1:-}"

    if [ -z "$backup_name" ]; then
        backup_name=$(remote "ls -1t $BACKUP_DIR/*.tar.gz 2>/dev/null | head -1" | xargs -r basename | sed 's/.tar.gz//')
        if [ -z "$backup_name" ]; then
            log_error "未找到可用备份"
            exit 1
        fi
        log_info "使用最新备份: $backup_name"
    fi

    local backup_file="$BACKUP_DIR/$backup_name.tar.gz"
    local tmp_dir="$REMOTE_BASE/${APP_NAME}_rollback_$$"
    local restore_dir="$tmp_dir/$APP_NAME"

    echo "═══════════════════════════════════════════"
    log_info "回滚 $backup_name"
    echo "═══════════════════════════════════════════"

    # 1. 验证备份文件存在
    if ! remote "[ -f '$backup_file' ]" 2>/dev/null; then
        log_error "备份文件不存在: $backup_name.tar.gz"
        return 1
    fi

    # 2. 提取到临时目录（先不碰当前目录）
    log_info "验证备份完整性..."
    remote "mkdir -p '$tmp_dir' && tar -xzf '$backup_file' -C '$tmp_dir'"

    if ! remote "[ -f '$restore_dir/brainbow' ]" 2>/dev/null; then
        log_error "备份不包含 brainbow 二进制，已中止（当前目录未受影响）"
        remote "rm -rf '$tmp_dir'"
        exit 1
    fi
    log_done "备份有效 (binary: $(remote "du -h '$restore_dir/brainbow' | cut -f1" 2>/dev/null))"

    # 3. 提取备份信息
    local backup_date size
    backup_date=$(echo "$backup_name" | sed 's/.*_backup_//;s/_/ /;s/\(..\)\(..\)/:\1:\2/')
    size=$(remote "du -sh '$restore_dir' | cut -f1" 2>/dev/null)
    log_info "备份时间: $backup_date, 大小: $size"

    # 4. 停止服务
    log_info "停止服务..."
    remote "sudo systemctl stop $APP_NAME 2>/dev/null || true"

    # 5. 原子性替换
    log_info "替换应用目录..."
    remote "rm -rf '$REMOTE_DIR' && mv '$restore_dir' '$REMOTE_DIR' && rm -rf '$tmp_dir'"
    log_done "目录已替换"

    # 6. 设置权限 + 启动
    log_info "设置权限..."
    remote "chmod +x '$REMOTE_DIR/brainbow' && \
        find '$REMOTE_DIR' -type d -exec chmod 755 {} \; && \
        find '$REMOTE_DIR' -type f -exec chmod 644 {} \;"

    log_info "启动服务..."
    remote "sudo systemctl start $APP_NAME"

    # 7. 等待就绪
    wait_for_ready

    # 8. 重载 Caddy
    remote "sudo systemctl reload caddy 2>/dev/null || true"

    echo ""
    log_done "回滚完成: $backup_name"
}

# ===================================================================
# 子命令: list-backups — 查看备份
# ===================================================================
cmd_list_backups() {
    load_config
    echo "═══════════════════════════════════════════"
    log_info "备份列表 ($BACKUP_DIR)"
    echo "═══════════════════════════════════════════"

    local backups
    backups=$(remote "ls -1t $BACKUP_DIR/*.tar.gz 2>/dev/null" || true)
    if [ -z "$backups" ]; then
        log_info "暂无备份"
        return 0
    fi

    local i=0
    echo "$backups" | while IFS= read -r f; do
        i=$((i + 1))
        name=$(basename "$f" .tar.gz)
        size=$(remote "du -h '$f' | cut -f1" 2>/dev/null)
        date_part=$(echo "$name" | sed 's/.*_backup_//;s/_/ /')
        printf "  %2d. %s  (%s)\n" "$i" "$date_part" "$size"
    done

    echo ""
    log_info "回滚: ./scripts/deploy.sh rollback <备份名>"
}

# ===================================================================
# 子命令: logs — 查看远程日志
# ===================================================================
cmd_logs() {
    load_config
    local lines="${1:-50}"
    remote "journalctl -u $APP_NAME -n $lines --no-pager"
}

# ===================================================================
# 子命令: status — 远程服务状态
# ===================================================================
cmd_status() {
    load_config
    remote "sudo systemctl status $APP_NAME --no-pager 2>&1 | head -20"
    echo "---"
    remote "journalctl -u $APP_NAME -n 10 --no-pager"
}

# ===================================================================
# 子命令: db-pull — 拉取远端数据库
# ===================================================================
cmd_db_pull() {
    load_config
    local ts
    ts=$(date +%y%m%d_%H%M%S)
    mkdir -p "$PROJECT_DIR/db"
    $SCP_CMD "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/$DATABASE_FILE" \
        "$PROJECT_DIR/db/${DATABASE_FILE%.*}_${ts}.db"
    log_done "数据库已拉取到: db/${DATABASE_FILE%.*}_${ts}.db"
}

# ===================================================================
# 子命令: db-push — 推送本地数据库到远端
# ===================================================================
cmd_db_push() {
    load_config
    local src="${1:-$PROJECT_DIR/$DATABASE_FILE}"
    if [ ! -f "$src" ]; then
        log_error "文件不存在: $src"
        log_info "用法: ./scripts/deploy.sh db-push [path]"
        exit 1
    fi
    log_warn "即将覆盖远端数据库！"
    log_info "来源: $src"
    log_info "目标: $REMOTE_HOST:$REMOTE_DIR/$DATABASE_FILE"
    echo -n "确认？(y/N) "
    read -r ans
    [ "$ans" != "y" ] && { log_info "已取消"; exit 1; }

    remote "sudo systemctl stop $APP_NAME"
    $SCP_CMD "$src" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/$DATABASE_FILE"
    remote "sudo systemctl start $APP_NAME"
    log_done "数据库已推送并重启服务"
}

# ===================================================================
# 入口
# ===================================================================
usage() {
    echo "Brainbow 部署工具集"
    echo ""
    echo "用法: $0 <子命令> [选项]"
    echo ""
    echo "子命令:"
    echo "  check             环境检查"
    echo "  build             构建前端+后端"
    echo "  deploy            全量部署"
    echo "  health            健康检查"
    echo "  rollback [名称]   回滚"
    echo "  list-backups      查看备份"
    echo "  logs [行数]       远程日志"
    echo "  status            服务状态"
    echo "  db-pull           拉取远端数据库"
    echo "  db-push [路径]    推送本地数据库到远端"
}

main() {
    if [ $# -eq 0 ]; then
        usage
        exit 1
    fi

    local cmd="$1"
    shift

    case "$cmd" in
        check)        cmd_check "$@" ;;
        build)        cmd_build "$@" ;;
        deploy)       cmd_deploy "$@" ;;
        health)       cmd_health "$@" ;;
        rollback)     cmd_rollback "$@" ;;
        list-backups) cmd_list_backups "$@" ;;
        logs)         cmd_logs "$@" ;;
        status)       cmd_status "$@" ;;
        db-pull)      cmd_db_pull "$@" ;;
        db-push)      cmd_db_push "$@" ;;
        --help|-h)    usage ;;
        *)
            log_error "未知子命令: $cmd"
            usage
            exit 1
            ;;
    esac
}

main "$@"
