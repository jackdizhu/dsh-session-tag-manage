#!/usr/bin/env bash
# ========================================
# DSH Session Tag Manage - 自动注册脚本 (Linux/macOS)
# ========================================
# 用途：自动安装宿主端和客户端插件到 DSH profile
# 使用：在项目根目录执行 ./scripts/auto-register.sh
# ========================================

set -e

# 获取项目根目录（脚本所在目录的上级目录）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "DSH Session Tag Manage - 自动注册"
echo "========================================"
echo ""
echo "项目根目录: $PROJECT_ROOT"
echo ""

# 检查 dsh 命令是否可用
if ! command -v dsh &> /dev/null; then
    echo "[错误] 未找到 dsh 命令，请先安装 DeepSeek Harness"
    echo "安装命令: npm install -g @deepseek-ai/dsh"
    exit 1
fi

# 检查插件目录是否存在
if [ ! -d "$PROJECT_ROOT/packages/dsh-session-host" ]; then
    echo "[错误] 未找到宿主端插件目录: packages/dsh-session-host"
    exit 1
fi

if [ ! -d "$PROJECT_ROOT/packages/dsh-session-client" ]; then
    echo "[错误] 未找到客户端插件目录: packages/dsh-session-client"
    exit 1
fi

# 构建插件
echo "[1/4] 构建插件..."
cd "$PROJECT_ROOT"
pnpm build
echo "[完成] 插件构建成功"
echo ""

# 安装宿主端插件
echo "[2/4] 安装宿主端插件..."
dsh plugin --profile web add "$PROJECT_ROOT/packages/dsh-session-host"
echo "[完成] 宿主端插件安装成功"
echo ""

# 安装客户端插件
echo "[3/4] 安装客户端插件..."
dsh plugin --profile web add "$PROJECT_ROOT/packages/dsh-session-client"
echo "[完成] 客户端插件安装成功"
echo ""

# 完成提示
echo "[4/4] 注册完成"
echo ""
echo "========================================"
echo "插件注册成功！"
echo "========================================"
echo ""
echo "启动 DSH:"
echo "  dsh web"
echo ""
echo "或使用本地开发模式（仅宿主端）:"
echo "  pnpm run dev"
echo ""
echo "注意：安装后需要重启 DSH 才能生效"
echo "========================================"
