# Shortify AI 🎬

AI 驱动的短剧创作平台，从创意到成片一键搞定。

## ✨ 功能特性

- **🎭 AI 智能编剧** — 输入创意主题，AI 自动生成角色对话式结构化剧本
- **🎨 AI 分镜生成** — 智谱 CogView-3-Plus 生成高质量分镜图片
- **🎙️ 智能配音** — 讯飞 TTS 多角色多音色配音，Edge-TTS 降级方案
- **🎬 视频合成** — FFmpeg 多运镜合成（Ken Burns 推近/拉远/平移 + 淡入淡出）
- **🎥 AI 视频生成** — CogVideoX-3 图生视频，每镜头独立生成 + ffmpeg 拼接
- **📝 SRT 字幕** — 自动生成字幕并烧录到视频
- **🎵 BGM 背景音乐** — 上传自定义背景音乐，可调节音量混入
- **📤 视频导出** — COS 签名 URL 直接下载
- **🔗 在线分享** — 生成分享链接，封面图预览
- **📱 响应式设计** — 完美适配移动端和桌面端
- **💰 积分系统** — 注册送积分，各操作消耗积分

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| 前端框架 | Next.js 16 (App Router) + React 19 |
| UI 组件 | Tailwind CSS v4 + shadcn/ui |
| 数据库 | PostgreSQL + Drizzle ORM |
| 认证 | NextAuth.js v5 (JWT) |
| AI 剧本 | 智谱 GLM-4-Flash |
| AI 生图 | 智谱 CogView-3-Plus |
| AI 视频 | 智谱 CogVideoX-3 |
| AI 配音 | 讯飞 TTS (WebSocket) + Edge-TTS 降级 |
| 视频合成 | FFmpeg (Ken Burns 运镜 + concat + 字幕烧录) |
| 云存储 | 腾讯云 COS (私有桶 + 签名 URL) |
| AI 角色一致 | 可灵 Kling (图像/视频 character_reference) |
| 邮件服务 | 内置 SMTP 客户端 (零依赖) |

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- PostgreSQL
- FFmpeg
- NotoSansSC 字体（PDF 导出需要）

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/ycbing/Shortify-AI.git
cd Shortify-AI

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env.local

# 数据库迁移
npm run db:push

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000

### 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接字符串 |
| `AUTH_SECRET` | NextAuth 密钥 |
| `GLM_API_KEY` | 智谱 AI API Key |
| `IMAGE_MODEL` | 生图模型（默认 cogview-3-plus） |
| `XUNFEI_APPID` | 讯飞 TTS AppID |
| `XUNFEI_API_KEY` | 讯飞 TTS API Key |
| `XUNFEI_API_SECRET` | 讯飞 TTS API Secret |
| `COS_SECRET_ID` | 腾讯云 COS SecretId |
| `COS_SECRET_KEY` | 腾讯云 COS SecretKey |
| `COS_BUCKET` | COS 桶名 |
| `COS_REGION` | COS 地域 |

## 📁 项目结构

```
app/
├── page.tsx                         # 首页 (Landing Page)
├── dashboard/page.tsx               # 作品管理
├── create/
│   ├── page.tsx                     # 创意输入
│   ├── script/                      # 剧本编辑
│   ├── storyboard/                  # 分镜生成
│   ├── preview/                     # 视频预览
│   └── editor/[dramaId]/            # 剧集拖拽排序
├── view/[dramaId]/                  # 作品查看
├── settings/                        # 用户设置
├── sign-in/                         # 登录
├── sign-up/                         # 注册
└── api/
    ├── generate/
    │   ├── script/route.ts          # AI 剧本生成
    │   ├── storyboard/route.ts      # AI 分镜生成
    │   ├── voiceover/route.ts       # 配音生成
    │   ├── subtitle/route.ts        # 字幕生成
    │   └── video/route.ts           # 视频合成/AI视频生成
    ├── dramas/
    │   ├── route.ts                 # 作品列表/创建
    │   └── [dramaId]/
    │       ├── route.ts             # 作品详情/更新
    │       ├── copy/route.ts        # 复制作品
    │       ├── export/route.ts      # 视频导出
    │       └── share/route.ts       # 分享管理
    ├── compose/route.ts             # 一键合成
    ├── upload-bgm/route.ts          # BGM 上传
    ├── uploads/[...path]/route.ts   # 静态文件代理
    └── user/credits/route.ts        # 积分查询
components/
├── create/                          # 创作流程组件
├── drama/                           # 作品展示组件
├── landing/                         # 首页组件
└── ui/                              # UI 基础组件
lib/
├── ai/
│   ├── script-generator.ts          # 剧本生成（V2 角色对话格式）
│   ├── image-generator.ts           # 分镜图片生成
│   ├── voiceover-generator.ts       # 配音生成（多角色）
│   ├── subtitle-generator.ts        # SRT 字幕生成
│   ├── video-composer.ts            # FFmpeg 视频合成
│   ├── video-generator.ts           # CogVideoX AI 视频生成
│   ├── xunfei-tts.ts                # 讯飞 TTS 客户端
│   ├── cos-storage.ts               # COS 上传/签名
│   └── glm-client.ts                # 智谱 API 客户端
├── db/
│   ├── schema.ts                    # 数据库 Schema
│   └── index.ts                     # 数据库连接
├── credits.ts                       # 积分系统
├── auth.ts                          # NextAuth 配置
└── utils.ts                         # 工具函数
types/
├── drama.ts                         # 剧本类型定义
└── next-auth.d.ts                   # NextAuth 类型扩展
scripts/
├── init-db.ts                       # 数据库初始化
├── regenerate-kenburns.ts           # 运镜参数重新生成
└── test-cogvideo.ts                 # CogVideoX 测试
```

## 🌐 友情链接

- [Linux DO](https://linux.do/) — 高质量技术社区

## 📄 License

MIT
