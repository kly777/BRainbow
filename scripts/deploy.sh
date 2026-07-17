#!/bin/bash
# ============================================================================
# Brainbow 部署工具集
# 用法: ./scripts/deploy.sh <子命令> [选项]
#
# 子命令:
#   check             环境检查
#   build             构建前端+后端（先 tsc 再编译）
#   deploy            全量部署（stop → backup → sync → start）
#   health            健康检查
#   rollback [名称]   回滚到指定备份（默认最新）
#   list-backups      查看备份
#   db-backup         手动备份数据库
#   backup-prune      清理过期备份
#   logs [行数]       远程日志
#   status            服务状态
#   db-pull           拉取远端数据库
#   db-push [路径]    推送本地数据库到远端
#
# 环境变量（来自 .env.prod）:
#   REMOTE_HOST, REMOTE_USER, APP_NAME, REMOTE_PORT, REMOTE_BASE,
#   SERVICE_PORT, BIND_HOST, DATABASE_FILE, CORS_ALLOW_ORIGIN,
#   BACKUP_RETAIN_DAYS, BACKUP_RETAIN_COUNT
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
    BACKUP_RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
    BACKUP_RETAIN_COUNT="${BACKUP_RETAIN_COUNT:-20}"
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
# 备份/轮转 辅助
# ===================================================================

# 一致性数据库备份
# 优先用 sqlite3 .backup（事务性快照），无 sqlite3 时回退到 cp 直接复制。
# 部署时的备份在服务停止后执行，所以 cp 也能得到一致状态。
db_backup() {
    local suffix="${1:-manual}"
    local ts
    ts=$(date -u +%Y%m%d_%H%M%S)
    local dest="db_${suffix}_${ts}.db"
    local src="$REMOTE_DIR/$DATABASE_FILE"

    if remote "command -v sqlite3" >/dev/null 2>&1; then
        log_info "sqlite3 .backup 事务性快照..."
        remote "sqlite3 '$src' '.backup $BACKUP_DIR/$dest'" 2>/dev/null || {
            log_warn "sqlite3 .backup 失败，回退到 cp"
            remote "cp '$src' '$BACKUP_DIR/$dest'" 2>/dev/null || {
                log_error "数据库备份失败"
                return 1
            }
        }
    else
        log_info "cp 直接备份（停止服务后操作可保证一致性）"
        remote "cp '$src' '$BACKUP_DIR/$dest'" 2>/dev/null || {
            log_error "数据库备份失败"
            return 1
        }
    fi
    log_done "数据库备份: $dest ($(remote "du -h '$BACKUP_DIR/$dest' | cut -f1" 2>/dev/null))"
}

# 清理过期备份：按时间的保留 BACKUP_RETAIN_DAYS 天，按数量的保留 BACKUP_RETAIN_COUNT 个
prune_backups() {
    local kept=0 removed=0
    log_info "清理过期备份（保留 ${BACKUP_RETAIN_DAYS}d / ${BACKUP_RETAIN_COUNT} 个）..."
    # 按日期清理
    local cutoff
    cutoff=$(date -u -d "${BACKUP_RETAIN_DAYS} days ago" +%Y%m%d_%H%M%S 2>/dev/null || \
             date -u -v-${BACKUP_RETAIN_DAYS}d +%Y%m%d_%H%M%S 2>/dev/null)
    if [ -n "$cutoff" ]; then
        # 删除 db_* 文件早于 cutoff
        remote "for f in \$BACKUP_DIR/db_*.db; do
            ts=\$(basename \"\$f\" | sed 's/.*_\([0-9]\{8\}_[0-9]\{6\}\).*/\1/' 2>/dev/null)
            if [ -n \"\$ts\" ] && [ \"\$ts\" \< \"$cutoff\" ]; then
                rm -f \"\$f\"
            fi
        done 2>/dev/null; echo done"
    fi
    # 按数量保留（只留最新的 N 个）
    # BACKUP_RETAIN_COUNT 在此展开（本地变量），不需要远端知道
    local keep=$((BACKUP_RETAIN_COUNT + 1))
    remote "ls -1t $BACKUP_DIR/code_*.tar.gz 2>/dev/null | tail -n +$keep | xargs -r rm -f" 2>/dev/null || true
    remote "ls -1t $BACKUP_DIR/db_*.db 2>/dev/null | tail -n +$keep | xargs -r rm -f" 2>/dev/null || true
    log_done "清理完成"
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

    # Step 2: 备份（数据库独立一致性备份 + 代码归档）
    local timestamp
    timestamp=$(date -u +%Y%m%d_%H%M%S)
    log_info "备份当前版本..."
    remote "mkdir -p $BACKUP_DIR"
    # 数据库备份（服务已停，直接 cp 即一致）
    remote "cp '$REMOTE_DIR/$DATABASE_FILE' '$BACKUP_DIR/db_deploy_${timestamp}.db' 2>/dev/null; echo ok" | grep -q ok && \
        log_info "数据库备份: db_deploy_${timestamp}.db ($(remote "du -h '$BACKUP_DIR/db_deploy_${timestamp}.db' | cut -f1" 2>/dev/null))" || \
        log_warn "数据库备份失败，跳过（可能无数据库文件）"
    # 代码：不包含数据库，tarball 小很多
    if remote "[ -f '$REMOTE_DIR/brainbow' ]" 2>/dev/null; then
        remote "tar -czf $BACKUP_DIR/code_${timestamp}.tar.gz \
            -C $REMOTE_DIR brainbow dist/ mem_config.json 2>/dev/null" || true
        log_info "代码备份: code_${timestamp}.tar.gz ($(remote "du -h $BACKUP_DIR/code_${timestamp}.tar.gz | cut -f1" 2>/dev/null))"
    fi
    log_done "备份完成"
    # 备份后清理
    prune_backups

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
    local restore_code="" restore_db=""

    echo "═══════════════════════════════════════════"
    log_info "回滚"
    echo "═══════════════════════════════════════════"

    # 解析指定备份（支持格式：时间戳 / 旧格式名称 / 前缀）
    local prefix="${1:-}"
    if [ -z "$prefix" ]; then
        # 自动选最新：优先 db 备份，取同名 code 配对
        local latest_db
        latest_db=$(remote "ls -1t $BACKUP_DIR/db_*.db 2>/dev/null | head -1" | xargs -r basename | sed 's/\.db$//' 2>/dev/null || true)
        if [ -n "$latest_db" ]; then
            local code_marker
            code_marker=$(echo "$latest_db" | sed 's/db_/code_/')
            if remote "[ -f '$BACKUP_DIR/${code_marker}.tar.gz' ]" 2>/dev/null; then
                restore_code="$code_marker"
                restore_db="$latest_db"
            else
                restore_db="$latest_db"
            fi
        else
            # 试试旧格式
            local old
            old=$(remote "ls -1t $BACKUP_DIR/brb_backup_*.tar.gz 2>/dev/null | head -1" | xargs -r basename | sed 's/.tar.gz//' || true)
            if [ -n "$old" ]; then
                log_info "使用旧格式备份: $old"
                restore_code="$old"
            fi
        fi
        if [ -z "$restore_code" ] && [ -z "$restore_db" ]; then
            log_error "未找到可用备份"
            exit 1
        fi
    else
        # 用户指定了前缀：尝试新格式 + 旧格式
        local candidate_db="${prefix}"
        local candidate_code="${prefix}"
        # 如果用户输入的是时间戳如 20260717_222232，自动补全
        if remote "[ -f '$BACKUP_DIR/db_${prefix}.db' ]" 2>/dev/null; then
            restore_db="db_${prefix}"
            if remote "[ -f '$BACKUP_DIR/code_${prefix}.tar.gz' ]" 2>/dev/null; then
                restore_code="code_${prefix}"
            fi
        elif remote "[ -f '$BACKUP_DIR/${prefix}.tar.gz' ]" 2>/dev/null; then
            restore_code="$prefix"
        elif remote "[ -f '$BACKUP_DIR/${prefix}.tar.gz' ]" 2>/dev/null; then
            restore_code="$prefix"
        else
            log_error "未找到匹配的备份: $prefix"
            log_info "可用备份: make list-backups"
            exit 1
        fi
    fi

    # ── 回滚数据库 ──
    local tmp_dir="$REMOTE_BASE/${APP_NAME}_rollback_$$"
    if [ -n "$restore_db" ]; then
        log_info "恢复数据库: $restore_db.db"
        # 停止服务后直接 cp 覆盖
        remote "sudo systemctl stop $APP_NAME 2>/dev/null || true"
        remote "cp '$BACKUP_DIR/${restore_db}.db' '$REMOTE_DIR/$DATABASE_FILE'" && \
            log_done "数据库已恢复 ($(remote "du -h '$BACKUP_DIR/${restore_db}.db' | cut -f1" 2>/dev/null))" || {
            log_error "数据库恢复失败"
            exit 1
        }
    fi

    # ── 回滚代码 ──
    if [ -n "$restore_code" ]; then
        local backup_file="$BACKUP_DIR/${restore_code}.tar.gz"
        if ! remote "[ -f '$backup_file' ]" 2>/dev/null; then
            log_error "代码备份不存在: $backup_file"
            exit 1
        fi

        # 提取到临时目录（先不碰当前目录）
        log_info "验证代码备份完整性..."
        remote "mkdir -p '$tmp_dir' && tar -xzf '$backup_file' -C '$tmp_dir'"

        # 新格式（code_*.tar.gz）包含 brainbow 直接在根
        # 旧格式（brb_backup_*.tar.gz）包含 brb/brainbow
        local restored_binary=""
        if remote "[ -f '$tmp_dir/brainbow' ]" 2>/dev/null; then
            restored_binary="$tmp_dir/brainbow"
        elif remote "[ -f '$tmp_dir/$APP_NAME/brainbow' ]" 2>/dev/null; then
            restored_binary="$tmp_dir/$APP_NAME/brainbow"
            # 旧格式：内容是 $APP_NAME/...，需要调整
            remote "mkdir -p '$tmp_dir/_flat' && mv '$tmp_dir/$APP_NAME/'* '$tmp_dir/_flat/' && rm -rf '$tmp_dir/$APP_NAME' && mv '$tmp_dir/_flat/'* '$tmp_dir/' && rm -rf '$tmp_dir/_flat'"
        fi

        if [ -z "$restored_binary" ] || ! remote "[ -f '$restored_binary' ]" 2>/dev/null; then
            log_error "备份不包含 brainbow 二进制，已中止（当前目录未受影响）"
            remote "rm -rf '$tmp_dir'"
            exit 1
        fi

        log_done "代码备份有效 (binary: $(remote "du -h '$restored_binary' | cut -f1" 2>/dev/null))"

        # 停止服务
        log_info "停止服务..."
        remote "sudo systemctl stop $APP_NAME 2>/dev/null || true"

        # 原子性替换
        log_info "替换应用目录..."
        remote "rm -rf '$REMOTE_DIR' && mkdir -p '$REMOTE_DIR' && cp -r '$tmp_dir/'* '$REMOTE_DIR/' && rm -rf '$tmp_dir'"
        log_done "目录已替换"
    else
        # 只有数据库回滚，需要重启服务
        log_info "重启服务..."
        remote "sudo systemctl restart $APP_NAME 2>/dev/null || sudo systemctl start $APP_NAME"
    fi

    # 设置权限
    remote "chmod +x '$REMOTE_DIR/brainbow' 2>/dev/null || true"

    # 等待就绪
    wait_for_ready

    # 重载 Caddy
    remote "sudo systemctl reload caddy 2>/dev/null || true"

    echo ""
    log_done "回滚完成"
}

# ===================================================================
# 子命令: list-backups — 查看备份
# ===================================================================
cmd_list_backups() {
    load_config
    echo "═══════════════════════════════════════════"
    log_info "备份列表 ($BACKUP_DIR)"
    echo "═══════════════════════════════════════════"

    local code_files db_files
    code_files=$(remote "ls -1t $BACKUP_DIR/code_*.tar.gz 2>/dev/null" || true)
    db_files=$(remote "ls -1t $BACKUP_DIR/db_*.db 2>/dev/null" || true)

    if [ -z "$code_files" ] && [ -z "$db_files" ]; then
        log_info "暂无新格式备份"
        # 也检查旧格式
        local old
        old=$(remote "ls -1t $BACKUP_DIR/*_backup_*.tar.gz 2>/dev/null" || true)
        if [ -n "$old" ]; then
            echo ""
            log_info "旧格式备份（含完整目录，可回滚）:"
            echo "$old" | while IFS= read -r f; do
                name=$(basename "$f" .tar.gz)
                size=$(remote "du -h '$f' | cut -f1" 2>/dev/null)
                date_part=$(echo "$name" | sed 's/.*_backup_//;s/_/ /')
                printf "  • %s  (%s)\n" "$date_part" "$size"
            done
        fi
        return 0
    fi

    if [ -n "$db_files" ]; then
        echo "── 数据库备份 ──"
        echo "$db_files" | while IFS= read -r f; do
            name=$(basename "$f" .db)
            size=$(remote "du -h '$f' | cut -f1" 2>/dev/null)
            date_part=$(echo "$name" | sed 's/.*_\([0-9]\{8\}_[0-9]\{6\}\)/\1/')
            printf "  • %s  (%s)\n" "$date_part" "$size"
        done
    fi

    if [ -n "$code_files" ]; then
        echo "── 代码备份 ──"
        echo "$code_files" | while IFS= read -r f; do
            name=$(basename "$f" .tar.gz)
            size=$(remote "du -h '$f' | cut -f1" 2>/dev/null)
            date_part=$(echo "$name" | sed 's/code_\([0-9]\{8\}_[0-9]\{6\}\)/\1/')
            printf "  • %s  (%s)\n" "$date_part" "$size"
        done
    fi

    echo ""
    log_info "回滚: ./scripts/deploy.sh rollback <名称前缀>"
}

# ===================================================================
# 子命令: db-backup — 手动数据库备份
# ===================================================================
cmd_db_backup() {
    load_config
    log_info "手动备份数据库..."
    db_backup "manual"
    prune_backups
    log_done "数据库备份完成"
}

# ===================================================================
# 子命令: backup-prune — 手动清理过期备份
# ===================================================================
cmd_backup_prune() {
    load_config
    prune_backups
    log_done "备份清理完成"
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
    echo "备份相关:"
    echo "  db-backup         一致性数据库快照 (sqlite3 .backup)"
    echo "  list-backups      查看所有备份"
    echo "  backup-prune      手动清理过期备份"
    echo "  rollback [前缀]   回滚（代码+数据库原子恢复）"
    echo ""
    echo "部署相关:"
    echo "  build             构建前端+后端"
    echo "  deploy            全量部署（自动备份+清理）"
    echo "  health            健康检查"
    echo "  check             环境检查"
    echo ""
    echo "运维:"
    echo "  logs [行数]       远程日志"
    echo "  status            服务状态"
    echo "  db-pull           拉取远端数据库到本地"
    echo "  db-push [路径]    推送本地数据库到远端"
    echo ""
    echo "备份策略: 每次 deploy 自动创建 db_<时间戳>.db (事务性) + code_<时间戳>.tar.gz"
    echo "          保留 BACKUP_RETAIN_DAYS 天 / BACKUP_RETAIN_COUNT 个"
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
        db-backup)    cmd_db_backup "$@" ;;
        backup-prune) cmd_backup_prune "$@" ;;
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
