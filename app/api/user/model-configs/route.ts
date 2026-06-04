// ============================================
// GET    /api/user/model-configs  — 获取用户配置
// PUT    /api/user/model-configs  — 创建/更新用户配置
// DELETE /api/user/model-configs  — 删除用户配置
// ============================================

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db, userModelConfigs } from "@/lib/db";
import { encrypt, decrypt, maskApiKey } from "@/lib/crypto";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("user-model-configs-api");

// GET — 获取用户的所有模型配置
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const rows = await db
      .select()
      .from(userModelConfigs)
      .where(eq(userModelConfigs.userId, session.user.id));

    const result = rows.map((r) => ({
      id: r.id,
      serviceType: r.serviceType,
      provider: r.provider,
      modelName: r.modelName,
      apiKeyMasked: r.apiKey ? maskApiKey(decrypt(r.apiKey)) : "",
      hasApiKey: !!r.apiKey,
      baseUrl: r.baseUrl || "",
      config: (r.config as Record<string, unknown>) || {},
    }));

    return NextResponse.json({ configs: result });
  } catch (error) {
    log.error("获取用户配置失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "获取配置失败" }, { status: 500 });
  }
}

// PUT — 创建或更新用户配置（upsert by userId + serviceType）
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const body = await request.json();
    const { serviceType, provider, modelName, apiKey, baseUrl, config } = body;

    if (!serviceType || !provider || !modelName) {
      return NextResponse.json(
        { error: "缺少必填字段: serviceType, provider, modelName" },
        { status: 400 }
      );
    }

    const userId = session.user.id;
    const encryptedKey = apiKey ? encrypt(apiKey) : null;

    // 尝试更新现有记录
    const existing = await db
      .select()
      .from(userModelConfigs)
      .where(
        and(
          eq(userModelConfigs.userId, userId),
          eq(userModelConfigs.serviceType, serviceType)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      // 更新
      const updateFields: Record<string, unknown> = {
        provider,
        modelName,
        baseUrl: baseUrl || null,
        config: config || {},
        updatedAt: new Date(),
      };
      if (apiKey !== undefined) {
        updateFields.apiKey = encryptedKey;
      }

      const [updated] = await db
        .update(userModelConfigs)
        .set(updateFields)
        .where(eq(userModelConfigs.id, existing[0].id))
        .returning();

      log.info("更新用户模型配置", {
        id: updated.id,
        serviceType,
        provider,
        userId,
      });

      return NextResponse.json({
        id: updated.id,
        serviceType: updated.serviceType,
        provider: updated.provider,
        modelName: updated.modelName,
        hasApiKey: !!updated.apiKey,
        baseUrl: updated.baseUrl,
        config: updated.config,
      });
    }

    // 新建
    const [inserted] = await db
      .insert(userModelConfigs)
      .values({
        userId,
        serviceType,
        provider,
        modelName,
        apiKey: encryptedKey,
        baseUrl: baseUrl || null,
        config: config || {},
      })
      .returning();

    log.info("创建用户模型配置", {
      id: inserted.id,
      serviceType,
      provider,
      userId,
    });

    return NextResponse.json({
      id: inserted.id,
      serviceType: inserted.serviceType,
      provider: inserted.provider,
      modelName: inserted.modelName,
      hasApiKey: !!inserted.apiKey,
      baseUrl: inserted.baseUrl,
      config: inserted.config,
    });
  } catch (error) {
    log.error("保存用户配置失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "保存配置失败" }, { status: 500 });
  }
}

// DELETE — 删除用户配置
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "缺少配置 ID" }, { status: 400 });
    }

    // 验证属于当前用户
    const [existing] = await db
      .select()
      .from(userModelConfigs)
      .where(eq(userModelConfigs.id, parseInt(id, 10)))
      .limit(1);

    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: "配置不存在" }, { status: 404 });
    }

    await db
      .delete(userModelConfigs)
      .where(eq(userModelConfigs.id, parseInt(id, 10)));

    log.info("删除用户模型配置", {
      id: parseInt(id, 10),
      userId: session.user.id,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error("删除用户配置失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "删除配置失败" }, { status: 500 });
  }
}
