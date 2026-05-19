#!/bin/bash
set -e

echo "📦 安装服务端依赖..."
cd /usr/local/wecom-clone/server && npm install

echo "📦 安装客户端依赖..."
cd /usr/local/wecom-clone/client && npm install

echo ""
echo "✅ 安装完成！启动方式："
echo ""
echo "  终端1（服务端）：cd /usr/local/wecom-clone/server && npm run dev"
echo "  终端2（客户端）：cd /usr/local/wecom-clone/client && npm run dev"
echo ""
echo "  浏览器打开：http://localhost:5173"
echo "  演示账号：admin / 123456"
