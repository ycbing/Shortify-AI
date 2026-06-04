// ============================================
// POST /api/admin/model-configs  — 创建/更新全局配置
// GET  /api/admin/model-configs  — 获取所有全局配置
// PUT  /api/admin/model-configs  — 更新配置
// DELETE /api/admin/model-configs — 删除配置
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, modelConfigs } from "@/lib/db";
import { encrypt, decrypt, maskApiKey } from "@/lib/crypto";
import { eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("admin-model-configs-api");

// 管理员用户 ID 列表（首个注册用户即为管理员）
const ADMIN_USER_IDS = (process.env.ADMIN_USER_IDS || "").split(",").filter(Boolean);

function isAdmin(userId: string): boolean {
  if (ADMIN_USER_IDS.length > 0) {
    return ADMIN_USER_IDS.includes(userId);
  }
  // 回退: 检查是否为首个用户
  // 通过简单的 user_id 判断，实际生产中应有 role 字段
  return userId === "f9d3168a-f21f-44e2-8343-d47d7690298e";
}

// GET — 列出所有全局配置
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (!isAdmin(session.user.id)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const rows = await db.select().from(modelConfigs).orderBy(modelConfigs.id);

    const result = rows.map((r) => ({
      id: r.id,
      serviceType: r.serviceType,
      provider: r.provider,
      modelName: r.modelName,
      apiKeyMasked: r.apiKey ? maskApiKey(decrypt(r.apiKey)) : "",
      hasApiKey: !!r.apiKey,
      baseUrl: r.baseUrl || "",
      isDefault: r.isDefault ?? false,
      config: (r.config as Record<string, unknown>) || {},
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));

    return NextResponse.json({ configs: result });
  } catch (error) {
    log.error("获取全局配置失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "获取配置失败" }, { status: 500 });
  }
}

// POST — 创建新配置
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (!isAdmin(session.user.id)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await request.json();
    const { serviceType, provider, modelName, apiKey, baseUrl, isDefault, config } = body;

    if (!serviceType || !provider || !modelName) {
      return NextResponse.json(
        { error: "缺少必填字段: serviceType, provider, modelName" },
        { status: 400 }
      );
    }

    // 加密 API Key
    const encryptedKey = apiKey ? encrypt(apiKey) : null;

    const [inserted] = await db
      .insert(modelConfigs)
      .values({
        serviceType,
        provider,
        modelName,
        apiKey: encryptedKey,
        baseUrl: baseUrl || null,
        isDefault: isDefault ?? false,
        config: config || {},
      })
      .returning();

    // 如果标记为默认，取消同类型的其他默认标记
    if (isDefault) {
      await db
        .update(modelConfigs)
        .set({ isDefault: false })
        .where(
          eq(modelConfigs.serviceType, serviceType)
        );
      await db
        .update(modelConfigs)
        .set({ isDefault: true })
        .where(eq(modelConfigs.id, inserted.id));
    }

    log.info("创建全局模型配置", {
      id: inserted.id,
      serviceType,
      provider,
      modelName,
      adminId: session.user.id,
    });

    return NextResponse.json({
      id: inserted.id,
      serviceType: inserted.serviceType,
      provider: inserted.provider,
      modelName: inserted.modelName,
      hasApiKey: !!inserted.apiKey,
      baseUrl: inserted.baseUrl,
      isDefault: inserted.isDefault,
      config: inserted.config,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes("duplicate key") || msg.includes("unique constraint")) {
      return NextResponse.json(
        { error: "该服务类型的此提供商+模型组合已存在" },
        { status: 409 }
      );
    }
    log.error("创建全局配置失败", { error: msg });
    return NextResponse.json({ error: "创建配置失败" }, { status: 500 });
  }
}

// PUT — 更新配置
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (!isAdmin(session.user.id)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const body = await request.json();
    const { id, apiKey, isDefault, ...updates } = body;

    if (!id) {
      return NextResponse.json({ error: "缺少配置 ID" }, { status: 400 });
    }

    // 构建更新字段
    const setFields: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.serviceType !== undefined) setFields.serviceType = updates.serviceType;
    if (updates.provider !== undefined) setFields.provider = updates.provider;
    if (updates.modelName !== undefined) setFields.modelName = updates.modelName;
    if (updates.baseUrl !== undefined) setFields.baseUrl = updates.baseUrl || null;
    if (updates.config !== undefined) setFields.config = updates.config;
    if (apiKey !== undefined) {
      setFields.apiKey = apiKey ? encrypt(apiKey) : null;
    }
    if (isDefault !== undefined) {
      setFields.isDefault = isDefault;
      // 取消同类型的其他默认标记
      if (isDefault && updates.serviceType) {
        await db
          .update(modelConfigs)
          .set({ isDefault: false })
          .where(eq(modelConfigs.serviceType, updates.serviceType));
      }
    }

    const [updated] = await db
      .update(modelConfigs)
      .set(setFields)
      .where(eq(modelConfigs.id, id))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    return NextResponse.json({
      id: updated.id,
      serviceType: updated.serviceType,
      provider: updated.provider,
      modelName: updated.modelName,
      hasApiKey: !!updated.apiKey,
      baseUrl: updated.baseUrl,
      isDefault: updated.isDefault,
      config: updated.config,
    });
  } catch (error) {
    log.error("更新全局配置失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "更新配置失败" }, { status: 500 });
  }
}

// DELETE — 删除配置
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    if (!isAdmin(session.user.id)) {
      return NextResponse.json({ error: "无权限" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少配置 ID" }, { status: 400 });
    }

    const [deleted] = await db
      .delete(modelConfigs)
      .where(eq(modelConfigs.id, parseInt(id, 10)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    log.info("删除全局模型配置", {
      id: deleted.id,
      serviceType: deleted.serviceType,
      adminId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("删除全局配置失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "删除配置失败" }, { status: 500 });
  }
}
