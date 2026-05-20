# Contributing to Shortify AI

感谢你对 Shortify AI 的关注！欢迎提交 Issue 和 PR。

## 开发环境

### 环境要求

- Node.js >= 18
- PostgreSQL >= 14
- FFmpeg

### 使用 Docker（推荐）

```bash
docker compose up -d
# 访问 http://localhost:3000
```

### 本地开发

```bash
# 克隆项目
git clone https://github.com/ycbing/Shortify-AI.git
cd Shortify-AI

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local
# 编辑 .env.local，填入必要的 API Key

# 初始化数据库
npm run db:push

# 启动开发服务器
npm run dev

# （可选）启动 WebSocket 服务
npm run start:ws
```

访问 http://localhost:3000

## 代码规范

- TypeScript 严格模式
- ESLint 检查：`npm run lint`
- 提交前请确保 `npm run lint` 通过

## 提交 PR

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m "feat: 描述你的改动"`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

### Commit Message 格式

- `feat:` 新功能
- `fix:` Bug 修复
- `refactor:` 重构
- `docs:` 文档更新
- `style:` 代码格式（不影响逻辑）
- `chore:` 构建/工具变更

## Issue

- Bug 报告：请附上复现步骤和环境信息
- 功能建议：描述使用场景和期望行为
