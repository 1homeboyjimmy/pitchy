#!/usr/bin/env bash
# =============================================================================
# Скрипт первоначальной настройки staging-сервера (dev.pitchy.pro)
# Запускается ОДИН РАЗ из-под root на чистом сервере Ubuntu
# Использование: ssh root@193.187.94.144 'bash -s' < scripts/setup_staging_server.sh
# =============================================================================

set -euo pipefail

DEPLOY_USER="deploy"
REPO_URL="https://github.com/1homeboyjimmy/pitchy.git"
REPO_DIR="/opt/ai-startup"
SWAP_SIZE="4G"

echo "============================================"
echo "  Pitchy Staging Server Setup"
echo "  Server: 193.187.94.144"
echo "  Domain: dev.pitchy.pro"
echo "============================================"

# ---- 1. Обновление ОС и базовые утилиты ----
echo ""
echo "[1/8] Обновление ОС и установка базовых утилит..."
apt-get update -y
apt-get upgrade -y
apt-get install -y \
    curl \
    wget \
    git \
    htop \
    vim \
    unzip \
    jq \
    fail2ban \
    ufw \
    ca-certificates \
    gnupg \
    lsb-release \
    apt-transport-https \
    software-properties-common

# ---- 2. Создание swap ----
echo ""
echo "[2/8] Настройка swap (${SWAP_SIZE})..."
if [ ! -f /swapfile ]; then
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    # Оптимизация swappiness
    sysctl vm.swappiness=10
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    echo "  Swap создан: ${SWAP_SIZE}"
else
    echo "  Swap уже существует, пропускаем."
fi

# ---- 3. Создание пользователя deploy ----
echo ""
echo "[3/8] Создание пользователя ${DEPLOY_USER}..."
if ! id "$DEPLOY_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$DEPLOY_USER"
    usermod -aG sudo "$DEPLOY_USER"
    # Разрешаем sudo без пароля для deploy
    echo "${DEPLOY_USER} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/${DEPLOY_USER}
    chmod 440 /etc/sudoers.d/${DEPLOY_USER}
    echo "  Пользователь ${DEPLOY_USER} создан."
else
    echo "  Пользователь ${DEPLOY_USER} уже существует."
fi

# ---- 4. Установка Docker Engine ----
echo ""
echo "[4/8] Установка Docker CE..."
if ! command -v docker &>/dev/null; then
    # Добавляем Docker GPG ключ
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    # Добавляем Docker репозиторий
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt-get update -y
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Добавляем deploy в группу docker
    usermod -aG docker "$DEPLOY_USER"

    systemctl enable docker
    systemctl start docker
    echo "  Docker установлен: $(docker --version)"
else
    echo "  Docker уже установлен: $(docker --version)"
    # Убедимся что deploy в группе docker
    usermod -aG docker "$DEPLOY_USER" 2>/dev/null || true
fi

# ---- 5. Настройка UFW (Firewall) ----
echo ""
echo "[5/8] Настройка UFW..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
echo "y" | ufw enable
ufw status verbose
echo "  UFW настроен (22, 80, 443)."

# ---- 6. Клонирование репозитория ----
echo ""
echo "[6/8] Клонирование репозитория в ${REPO_DIR}..."
if [ ! -d "$REPO_DIR" ]; then
    git clone "$REPO_URL" "$REPO_DIR"
    chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$REPO_DIR"
    echo "  Репозиторий клонирован."
else
    echo "  Директория ${REPO_DIR} уже существует, пропускаем git clone."
    chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$REPO_DIR"
fi

# ---- 7. Генерация SSH deploy key ----
echo ""
echo "[7/8] Генерация SSH deploy key для git pull..."
DEPLOY_SSH_DIR="/home/${DEPLOY_USER}/.ssh"
DEPLOY_KEY="$DEPLOY_SSH_DIR/id_ed25519"
if [ ! -f "$DEPLOY_KEY" ]; then
    mkdir -p "$DEPLOY_SSH_DIR"
    ssh-keygen -t ed25519 -f "$DEPLOY_KEY" -N "" -C "deploy@staging-pitchy"
    chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$DEPLOY_SSH_DIR"
    chmod 700 "$DEPLOY_SSH_DIR"
    chmod 600 "$DEPLOY_KEY"
    chmod 644 "${DEPLOY_KEY}.pub"
    echo ""
    echo "  ===== DEPLOY KEY (добавьте в GitHub → Settings → Deploy keys) ====="
    cat "${DEPLOY_KEY}.pub"
    echo "  ===================================================================="
else
    echo "  SSH ключ уже существует."
fi

# ---- 8. Подготовка .env ----
echo ""
echo "[8/8] Подготовка .env из шаблона..."
cd "$REPO_DIR"
git checkout dev 2>/dev/null || git checkout main
if [ ! -f ".env" ] && [ -f ".env.staging.example" ]; then
    cp .env.staging.example .env
    chown "${DEPLOY_USER}:${DEPLOY_USER}" .env
    chmod 600 .env
    echo "  .env создан из .env.staging.example"
    echo "  ВАЖНО: Отредактируйте .env и заполните реальные секреты!"
else
    echo "  .env уже существует или шаблон не найден."
fi

# ---- Создание директории для бэкапов ----
mkdir -p "$REPO_DIR/backups"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "$REPO_DIR/backups"

# ---- Настройка fail2ban ----
echo ""
echo "Настройка fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

echo ""
echo "============================================"
echo "  ГОТОВО! Staging-сервер настроен."
echo "============================================"
echo ""
echo "Следующие шаги:"
echo "  1. Отредактируйте /opt/ai-startup/.env (заполните секреты)"
echo "  2. Сгенерируйте bcrypt хэш для Caddy Basic Auth:"
echo "     docker run --rm caddy caddy hash-password --plaintext \"YOUR_PASSWORD\""
echo "  3. Вставьте хэш в /opt/ai-startup/Caddyfile.staging"
echo "  4. Запустите стек:"
echo "     cd /opt/ai-startup"
echo "     docker compose -f docker-compose.staging.yml up -d"
echo "  5. Примените миграции:"
echo "     docker compose -f docker-compose.staging.yml exec backend python -m alembic upgrade head"
echo "  6. Добавьте deploy key в GitHub (показан выше)"
echo "  7. Добавьте GitHub Secrets: DEV_HOST, DEV_USERNAME, DEV_SSH_KEY"
echo ""
echo "  Проверка: curl -u team:PASSWORD https://dev.pitchy.pro/health"
echo ""
