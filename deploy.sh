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

    # 派生路径
    REMOTE_DIR="$REMOTE_BASE/$APP_NAME"
    BACKUP_DIR="$REMOTE_BASE/${APP_NAME}_backups"
}

# ========== 部署步骤 ==========
backup_remote() {
    log_info "备份远程版本..."
    local timestamp
    timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_name="${APP_NAME}_backup_${timestamp}"

    # shellcheck disable=SC2087,SC2153
    ssh -p "$REMOTE_PORT" "$REMOTE_USER@$REMOTE_HOST" << ENDSSH
        mkdir -p "$BACKUP_DIR" "$REMOTE_DIR"
        if [ -d "$REMOTE_DIR" ]; then
            cp -r "$REMOTE_DIR" "$BACKUP_DIR/$backup_name"
            echo "已创建备份: $backup_name"
        fi
        sudo chown -R $REMOTE_USER:$REMOTE_USER "$REMOTE_DIR" "$BACKUP_DIR" 2>/dev/null || true
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

    # 复制数据库
    if [ -f "$DATABASE_FILE" ]; then
        scp -P "$REMOTE_PORT" "$DATABASE_FILE" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/"
        log_success "数据库文件已同步"
    else
        log_info "跳过数据库文件（本地不存在）"
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
Environment="RUST_LOG=info"
Environment="BIND_HOST=$BIND_HOST"
Environment="BIND_PORT=$SERVICE_PORT"
Environment="DATABASE_URL=sqlite:$REMOTE_DIR/$DATABASE_FILE"

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

# ========== 主流程 ==========
main() {
    load_config

    echo "========================================="
    log_info "部署 $APP_NAME 到 $REMOTE_HOST"
    echo "========================================="

    backup_remote
    sync_files
    setup_permissions
    setup_service
    check_status

    echo ""
    log_success "Listening on http://$REMOTE_HOST:$SERVICE_PORT"
}

main "$@"
