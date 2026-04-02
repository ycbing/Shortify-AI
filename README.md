# Shortify AI - AI 短剧创作平台

用 AI 创作短剧，从创意到成片只需 5 分钟。

## 技术栈

- **前端**: Next.js 16 (App Router) + React 19 + TypeScript
- **UI**: Tailwind CSS + shadcn/ui
- **数据库**: PostgreSQL + Drizzle ORM
- **认证**: NextAuth.js (Auth.js v5) — JWT strategy
- **AI**: GLM API (智谱) — 剧本生成
- **图片生成**: CogView API (智谱)
- **配音**: Edge-TTS
- **视频合成**: FFmpeg

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
# 编辑 .env.local 填入你的配置
```

### 3. 初始化数据库

```bash
npm run db:push
```

### 4. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

## 功能

- 🎭 **AI 智能编剧**: 输入创意，AI 自动生成结构化剧本
- 🎨 **AI 分镜生成**: CogView API 生成高质量分镜图片
- 🎙️ **AI 智能配音**: Edge-TTS 生成自然流畅的中文语音
- 🎬 **一键视频合成**: FFmpeg 将图片、配音合成为视频

## 项目结构

```
app/          # Next.js App Router 页面和 API
components/   # React 组件 (UI + 业务)
lib/          # 核心库 (认证、数据库、AI)
types/        # TypeScript 类型定义
scripts/      # 数据库初始化脚本
```

## 部署

```bash
npm run build
npm run start
```
