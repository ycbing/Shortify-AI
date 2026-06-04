"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Loader2,
  Save,
  Trash2,
  TestTube,
  CheckCircle2,
  XCircle,
  Cpu,
  Image,
  Volume2,
  Video,
} from "lucide-react";
import { createLogger } from "@/lib/logger";

const log = createLogger("model-config-settings");

// ============ 类型定义 ============

interface ModelConfigItem {
  id: number;
  serviceType: string;
  provider: string;
  modelName: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  baseUrl: string;
  isDefault?: boolean;
  config: Record<string, unknown>;
}

const SERVICE_LABELS: Record<string, string> = {
  llm: "大语言模型 (LLM)",
  image: "图片生成",
  tts: "语音合成 (TTS)",
  video: "视频生成",
};

const SERVICE_ICONS: Record<string, React.ReactNode> = {
  llm: <Cpu className="h-4 w-4" />,
  image: <Image className="h-4 w-4" />,
  tts: <Volume2 className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
};

const PROVIDER_OPTIONS: Record<string, string[]> = {
  llm: ["glm", "deepseek", "openai"],
  image: ["glm", "openai", "liblib", "kling"],
  tts: ["xunfei", "edge"],
  video: ["glm", "liblib", "kling"],
};

const MODEL_OPTIONS: Record<string, Record<string, string[]>> = {
  glm: {
    llm: ["glm-4-flash", "glm-4-plus", "glm-4-long", "glm-4-air"],
    image: ["cogview-3-flash", "cogview-3-plus", "glm-image"],
    video: ["cogvideox-3"],
  },
  deepseek: {
    llm: ["deepseek-chat", "deepseek-reasoner"],
  },
  openai: {
    llm: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo"],
    image: ["dall-e-3"],
  },
  liblib: {
    image: ["star-3-alpha", "dreamtech-xl"],
    video: ["kling-v2-6", "kling-v2.6"],
  },
  kling: {
    image: ["kling-v1.6", "kling-v2"],
    video: ["kling-v1.6", "kling-v2"],
  },
  xunfei: {
    tts: ["x4_xiaorui", "x4_xiaoyan", "x4_lingling", "x4_yezhi", "x4_yezi"],
  },
  edge: {
    tts: ["edge-tts"],
  },
};

// ============ 管理员全局配置组件 ============

function AdminConfigSection({ userId }: { userId: string }) {
  const [configs, setConfigs] = useState<ModelConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null); // serviceType being saved

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/model-configs");
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs || []);
      }
    } catch {
      toast.error("加载全局配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  // 按服务类型分组
  const grouped = configs.reduce<Record<string, ModelConfigItem[]>>((acc, c) => {
    if (!acc[c.serviceType]) acc[c.serviceType] = [];
    acc[c.serviceType].push(c);
    return acc;
  }, {});

  const handleSave = async (serviceType: string, formData: Record<string, string>) => {
    setSaving(serviceType);
    try {
      const res = await fetch("/api/admin/model-configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType,
          provider: formData.provider,
          modelName: formData.modelName,
          apiKey: formData.apiKey || undefined,
          baseUrl: formData.baseUrl || undefined,
          isDefault: formData.isDefault === "true",
          config: formData.config ? JSON.parse(formData.config) : {},
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "保存失败");
      }

      toast.success(`${SERVICE_LABELS[serviceType] || serviceType} 全局配置已保存`);
      fetchConfigs();
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/admin/model-configs?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("配置已删除");
        fetchConfigs();
      }
    } catch {
      toast.error("删除失败");
    }
  };

  const handleTest = async (config: Record<string, string>) => {
    try {
      const res = await fetch("/api/model-configs/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("测试失败");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  const serviceTypes = ["llm", "image", "tts", "video"] as const;

  return (
    <div className="space-y-6">
      {serviceTypes.map((serviceType) => {
        const items = grouped[serviceType] || [];
        return (
          <Card key={serviceType} className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                {SERVICE_ICONS[serviceType]}
                {SERVICE_LABELS[serviceType]}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 已有配置列表 */}
              {items.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/30"
                >
                  <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">
                    {item.provider}
                  </Badge>
                  <span className="text-sm">{item.modelName}</span>
                  {item.hasApiKey && (
                    <Badge variant="secondary" className="text-xs">
                      🔑 {item.apiKeyMasked}
                    </Badge>
                  )}
                  {item.baseUrl && (
                    <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                      {item.baseUrl}
                    </span>
                  )}
                  {item.isDefault && (
                    <Badge className="bg-emerald-600 text-white text-xs">默认</Badge>
                  )}
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTest({
                      serviceType: item.serviceType,
                      provider: item.provider,
                      modelName: item.modelName,
                      apiKey: "",
                      baseUrl: item.baseUrl,
                    })}
                    disabled
                    title="测试需要使用新增配置的表单"
                  >
                    <TestTube className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(item.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}

              {/* 新增配置表单 */}
              <AdminConfigForm
                serviceType={serviceType}
                onSave={handleSave}
                onTest={handleTest}
                saving={saving === serviceType}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============ 管理员新增配置表单 ============

function AdminConfigForm({
  serviceType,
  onSave,
  onTest,
  saving,
}: {
  serviceType: string;
  onSave: (serviceType: string, formData: Record<string, string>) => Promise<void>;
  onTest: (config: Record<string, string>) => Promise<void>;
  saving: boolean;
}) {
  const [provider, setProvider] = useState("glm");
  const [modelName, setModelName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [isDefault, setIsDefault] = useState("true");
  const [config, setConfig] = useState("");
  const [testing, setTesting] = useState(false);

  const providers = PROVIDER_OPTIONS[serviceType] || [];

  const handleProviderChange = (p: string) => {
    setProvider(p);
    const models = MODEL_OPTIONS[p]?.[serviceType] || [];
    setModelName(models[0] || "");
  };

  const handleSubmit = () => {
    if (!provider || !modelName) {
      toast.error("请选择提供商和模型");
      return;
    }
    onSave(serviceType, {
      provider,
      modelName,
      apiKey,
      baseUrl,
      isDefault,
      config,
    });
  };

  const handleTest = () => {
    if (!provider || !modelName) {
      toast.error("请先选择提供商和模型");
      return;
    }
    setTesting(true);
    onTest({ serviceType, provider, modelName, apiKey, baseUrl }).finally(() => {
      setTesting(false);
    });
  };

  return (
    <div className="space-y-3 p-3 rounded-lg border border-dashed border-border/50">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">提供商</Label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">模型</Label>
          <select
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            {(MODEL_OPTIONS[provider]?.[serviceType] || []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value="">自定义...</option>
          </select>
          {modelName === "" && (
            <input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="输入自定义模型名"
              className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm"
            />
          )}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">API Key</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-...（留空使用已有）"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Base URL</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v4"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">设为默认</Label>
          <select
            value={isDefault}
            onChange={(e) => setIsDefault(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            <option value="true">是</option>
            <option value="false">否</option>
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={saving || !modelName}
          className="bg-emerald-600 hover:bg-emerald-500 min-h-[36px]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          保存
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleTest}
          disabled={testing || !apiKey}
          className="min-h-[36px]"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <TestTube className="h-4 w-4 mr-1" />}
          测试连接
        </Button>
      </div>
    </div>
  );
}

// ============ 用户配置组件 ============

function UserConfigSection({ userId }: { userId: string }) {
  const [configs, setConfigs] = useState<ModelConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await fetch("/api/user/model-configs");
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs || []);
      }
    } catch {
      toast.error("加载用户配置失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  const handleSave = async (serviceType: string, formData: Record<string, string>) => {
    setSaving(serviceType);
    try {
      const res = await fetch("/api/user/model-configs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceType,
          provider: formData.provider,
          modelName: formData.modelName,
          apiKey: formData.apiKey || undefined,
          baseUrl: formData.baseUrl || undefined,
          config: formData.config ? JSON.parse(formData.config) : {},
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "保存失败");
      }

      toast.success(`${SERVICE_LABELS[serviceType] || serviceType} 配置已保存`);
      fetchConfigs();
    } catch (err) {
      toast.error(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/user/model-configs?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("配置已删除");
        fetchConfigs();
      }
    } catch {
      toast.error("删除失败");
    }
  };

  const handleTest = async (testConfig: Record<string, string>) => {
    try {
      const res = await fetch("/api/model-configs/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testConfig),
      });
      const result = await res.json();
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error("测试失败");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
      </div>
    );
  }

  const serviceTypes = ["llm", "image", "tts", "video"] as const;

  return (
    <div className="space-y-6">
      <div className="p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground">
        💡 配置后，系统将优先使用你的 API Key 调用模型。如果未配置，则使用全局默认配置。
      </div>
      {serviceTypes.map((serviceType) => {
        const existing = configs.find((c) => c.serviceType === serviceType);
        return (
          <Card key={serviceType} className="border-border/50 bg-card/50">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  {SERVICE_ICONS[serviceType]}
                  {SERVICE_LABELS[serviceType]}
                </CardTitle>
                {existing && (
                  <div className="flex items-center gap-1">
                    <Badge variant="secondary" className="text-xs">
                      {existing.provider} / {existing.modelName}
                    </Badge>
                    {existing.hasApiKey && (
                      <Badge variant="outline" className="text-xs">
                        🔑 {existing.apiKeyMasked}
                      </Badge>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-400 hover:text-red-300 h-7"
                      onClick={() => handleDelete(existing.id)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <UserConfigForm
                serviceType={serviceType}
                existing={existing}
                onSave={handleSave}
                onTest={handleTest}
                saving={saving === serviceType}
              />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

// ============ 用户配置表单 ============

function UserConfigForm({
  serviceType,
  existing,
  onSave,
  onTest,
  saving,
}: {
  serviceType: string;
  existing?: ModelConfigItem;
  onSave: (serviceType: string, formData: Record<string, string>) => Promise<void>;
  onTest: (config: Record<string, string>) => Promise<void>;
  saving: boolean;
}) {
  const [provider, setProvider] = useState(existing?.provider || "glm");
  const [modelName, setModelName] = useState(existing?.modelName || "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl || "");
  const [config, setConfig] = useState(
    existing?.config ? JSON.stringify(existing.config, null, 2) : ""
  );
  const [testing, setTesting] = useState(false);

  const providers = PROVIDER_OPTIONS[serviceType] || [];

  const handleProviderChange = (p: string) => {
    setProvider(p);
    if (!existing) {
      const models = MODEL_OPTIONS[p]?.[serviceType] || [];
      setModelName(models[0] || "");
    }
  };

  const handleSubmit = () => {
    if (!provider || !modelName) {
      toast.error("请选择提供商和模型");
      return;
    }
    onSave(serviceType, {
      provider,
      modelName,
      apiKey,
      baseUrl,
      config,
    });
  };

  const handleTest = () => {
    if (!provider || !modelName) {
      toast.error("请先选择提供商和模型");
      return;
    }
    setTesting(true);
    onTest({ serviceType, provider, modelName, apiKey, baseUrl, config }).finally(() => {
      setTesting(false);
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div>
          <Label className="text-xs text-muted-foreground">提供商</Label>
          <select
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            {providers.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">模型</Label>
          <select
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-md bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            {(MODEL_OPTIONS[provider]?.[serviceType] || []).map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value="__custom__">自定义...</option>
          </select>
          {modelName === "__custom__" && (
            <Input
              value={modelName === "__custom__" ? "" : modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="输入自定义模型名"
              className="mt-1"
            />
          )}
        </div>
        <div className="col-span-2 sm:col-span-1">
          <Label className="text-xs text-muted-foreground">API Key</Label>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={existing?.hasApiKey ? "留空保持不变" : "sk-..."}
            className="mt-1"
          />
        </div>
        <div className="col-span-2 sm:col-span-3">
          <Label className="text-xs text-muted-foreground">Base URL（可选）</Label>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v4"
            className="mt-1"
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={saving || !modelName}
          className="bg-emerald-600 hover:bg-emerald-500 min-h-[36px]"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
          {existing ? "更新配置" : "保存配置"}
        </Button>
        {apiKey && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleTest}
            disabled={testing}
            className="min-h-[36px]"
          >
            {testing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <TestTube className="h-4 w-4 mr-1" />}
            测试连接
          </Button>
        )}
      </div>
    </div>
  );
}

// ============ 主组件 ============

export default function ModelConfigSettings() {
  const { data: session } = useSession();
  const userId = session?.user?.id || "";
  const [activeTab, setActiveTab] = useState<"user" | "admin">("user");

  // 管理员判断（简化版，与服务端一致）
  const ADMIN_USER_IDS = (typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_ADMIN_USER_IDS || "f9d3168a-f21f-44e2-8343-d47d7690298e")
    : "f9d3168a-f21f-44e2-8343-d47d7690298e"
  ).split(",");

  const isAdmin = userId && ADMIN_USER_IDS.includes(userId);

  // 管理员默认显示管理标签
  useEffect(() => {
    if (isAdmin && activeTab === "user") {
      // 保持 user tab 默认
    }
  }, [isAdmin, activeTab]);

  return (
    <div className="space-y-4">
      {/* Tab 切换 */}
      {isAdmin && (
        <div className="flex gap-1 p-1 rounded-lg bg-muted/50">
          <button
            onClick={() => setActiveTab("user")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
              activeTab === "user"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🧑 我的配置
          </button>
          <button
            onClick={() => setActiveTab("admin")}
            className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
              activeTab === "admin"
                ? "bg-emerald-600 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ⚙️ 全局配置（管理员）
          </button>
        </div>
      )}

      {activeTab === "admin" && isAdmin ? (
        <AdminConfigSection userId={userId} />
      ) : (
        <UserConfigSection userId={userId} />
      )}
    </div>
  );
}
