#!/bin/bash

set -euo pipefail

log_info() { echo -e "\033[0;34m[INFO]\033[0m $1"; }
log_success() { echo -e "\033[0;32m[SUCCESS]\033[0m $1"; }
log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; }

# ========== 配置加载 ==========
load_config() {
    if [ ! -f ".env.prod" ]; then
        log_error "配置文件 .env.prod 不存在"
        exit 1
    fi

    set -o allexport
    # shellcheck source=/dev/null
    source .env.prod
    set +o allexport

    # 必需配置检查
    local required_vars=("REMOTE_HOST" "REMOTE_USER" "APP_NAME")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var:-}" ] || [ "${!var}" = "your-server-ip-or-domain.com" ]; then
            log_error "缺少必需配置: $var"
            exit 1
        fi
    done

    # 设置默认值
    REMOTE_PORT="${REMOTE_PORT:-22}"
    REMOTE_BASE="${REMOTE_BASE:-/opt}"
    SERVICE_PORT="${SERVICE_PORT:-8080}"
    BIND_HOST="${BIND_HOST:-0.0.0.0}"
    DATABASE_FILE="${DATABASE_FILE:-brainbow.db}"
    SERVER_SOURCE_PATH="${SERVER_SOURCE_PATH:-server}"
    CORS_ALLOW_ORIGIN="${CORS_ALLOW_ORIGIN:-http://localhost:3000,http://localhost:5173}"

    # 派生路径
    REMOTE_DIR="$REMOTE_BASE/$APP_NAME"
    BACKUP_DIR="$REMOTE_BASE/${APP_NAME}_backups"
}

# ========== 部署步骤 ==========
stop_remote_service() {
    log_info "停止远程服务..."
    ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "sudo systemctl stop $APP_NAME 2>/dev/null || true"
    log_success "远程服务已停止"
}

backup_remote() {
    log_info "备份远程版本..."
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="${APP_NAME}_backup_${timestamp}.tar.gz"

    # shellcheck disable=SC2087,SC2153
    ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" << ENDSSH
        mkdir -p "$BACKUP_DIR"
        if [ -d "$REMOTE_DIR" ]; then
            tar -czf "$BACKUP_DIR/$backup_file" -C "$REMOTE_BASE" "$APP_NAME"
            echo "已创建备份: $backup_file"
        fi
        sudo chown -R $REMOTE_USER:$REMOTE_USER "$BACKUP_DIR" 2>/dev/null || true
ENDSSH
}

sync_files() {
    log_info "同步文件到远程服务器..."

    if [ ! -d "$SERVER_SOURCE_PATH" ]; then
        log_error "目录不存在: $SERVER_SOURCE_PATH"
        exit 1
    fi

    # 同步server文件
    rsync -avz -e "ssh -p $REMOTE_PORT" \
        --exclude='.git' --exclude='target' --exclude='node_modules' \
        "$SERVER_SOURCE_PATH/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"

    # 数据库同步（仅 FORCE_DB_OVERWRITE=true 时启用）
    if [ "${FORCE_DB_OVERWRITE:-false}" = "true" ]; then
        if [ -f "$DATABASE_FILE" ]; then
            scp -P "$REMOTE_PORT" "$DATABASE_FILE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"
            log_success "数据库文件已覆盖（FORCE_DB_OVERWRITE）"
        else
            log_error "本地数据库文件不存在: $DATABASE_FILE"
            exit 1
        fi
    else
        log_info "跳过数据库同步（保留远端数据。用 deploy-force-db 强制覆盖）"
    fi
}

setup_permissions() {
    log_info "设置权限..."
    # shellcheck disable=SC2087,SC2153
    ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" << ENDSSH
        find $REMOTE_DIR -type d -exec chmod 755 {} \;
        find $REMOTE_DIR -type f -exec chmod 644 {} \;
        [ -f "$REMOTE_DIR/brainbow" ] && chmod +x "$REMOTE_DIR/brainbow"
        [ -f "$REMOTE_DIR/$DATABASE_FILE" ] && chmod 666 "$REMOTE_DIR/$DATABASE_FILE"
ENDSSH
}

setup_service() {
    log_info "配置 systemd 服务..."

    # shellcheck disable=SC2087,SC2153
    ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" << ENDSSH
        sudo tee /etc/systemd/system/$APP_NAME.service > /dev/null << SERVICE
[Unit]
Description=$APP_NAME Application
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
Environment="RUST_LOG=info"
Environment="SERVICE_PORT=$SERVICE_PORT"
Environment="BIND_HOST=$BIND_HOST"
Environment="DATABASE_URL=sqlite:$REMOTE_DIR/$DATABASE_FILE"
Environment="CORS_ALLOW_ORIGIN=$CORS_ALLOW_ORIGIN"

[Install]
WantedBy=multi-user.target
SERVICE

        sudo systemctl daemon-reload
        sudo systemctl enable $APP_NAME
        sudo systemctl restart $APP_NAME
ENDSSH
    log_success "服务已启动"
}

check_status() {
    log_info "检查服务状态..."
    ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "sudo systemctl status $APP_NAME --no-pager | head -15"
}

# ========== Caddy 生命周期管理 ==========

check_caddy() {
    log_info "检查 Caddy 状态..."

    # 1. 检查 Caddy 是否已安装
    if ! ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" "command -v caddy" >/dev/null 2>&1; then
        log_error "远程服务器未安装 Caddy"
        log_info "请先安装: sudo apt install caddy"
        exit 1
    fi

    # 2. 验证 Caddy 配置
    if ! ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "timeout 10 caddy validate --config /etc/caddy/Caddyfile 2>&1" | grep -q "Valid configuration"; then
        log_error "Caddy 配置无效，请检查 /etc/caddy/Caddyfile"
        exit 1
    fi
    log_success "Caddy 配置有效"

    # 3. 检查 Caddy 服务是否运行
    if ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "systemctl is-active caddy" 2>/dev/null | grep -q "active"; then
        log_success "Caddy 服务运行中"
    else
        log_warning "Caddy 未运行！请手动启动: ssh $REMOTE_USER@$REMOTE_HOST 'sudo systemctl start caddy'"
    fi
}

reload_caddy() {
    local caddyfile_remote="/etc/caddy/Caddyfile"
    log_info "重新加载 Caddy..."

    if ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "sudo systemctl reload caddy" 2>/dev/null; then
        log_success "Caddy 已重新加载"
    else
        log_warning "Caddy 重载失败（可能 sudo 受限），请手动执行: sudo systemctl reload caddy"
    fi
}

check_caddy_endpoint() {
    log_info "验证服务端点..."
    sleep 2

    # 1. 后端健康检查（直连端口）
    local http_code
    http_code=$(ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/api/health 2>/dev/null || echo '000'")
    if [ "$http_code" = "200" ]; then
        log_success "后端服务响应正常 (HTTP $http_code)"
    else
        log_warning "后端服务返回 HTTP $http_code，请检查"
    fi

    # 2. 通过 Caddy 反向代理访问 API
    http_code=$(ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "curl -s -o /dev/null -w '%{http_code}' http://localhost/api/health 2>/dev/null || echo '000'")
    if [ "$http_code" = "200" ]; then
        log_success "Caddy → 后端反向代理正常 (HTTP $http_code)"
    else
        log_warning "Caddy 反向代理返回 HTTP $http_code"
    fi

    # 3. 前端 SPA 是否可达
    http_code=$(ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" \
        "curl -s -o /dev/null -w '%{http_code}' http://localhost/ 2>/dev/null || echo '000'")
    if [ "$http_code" = "200" ]; then
        log_success "前端页面可达 (HTTP $http_code)"
    else
        log_warning "前端返回 HTTP $http_code"
    fi
}

log_warning() { echo -e "\033[0;33m[WARN]\033[0m $1"; }

# ========== 主流程 ==========
main() {
    load_config

    echo "========================================="
    log_info "部署 $APP_NAME 到 $REMOTE_HOST"
    echo "========================================="

    check_caddy
    stop_remote_service
    backup_remote
    sync_files
    setup_permissions
    setup_service
    reload_caddy
    check_status
    check_caddy_endpoint

    echo ""
    log_success "https://brainbow.top"
}

main "$@"
