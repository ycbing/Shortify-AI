import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger";

const log = createLogger("templates-api");

export interface DramaTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 图标 emoji */
  emoji: string;
  /** 标签（用于分类） */
  tags: string[];
  /** 题材（创意输入） */
  theme: string;
  /** 类型 */
  genre: string;
  /** 画风 */
  style: string;
  /** 推荐集数 */
  episodeCount: number;
  /** 预设角色（可选，预填到剧本生成 prompt 中） */
  characters?: { name: string; description: string }[];
  /** 人气排序权重 */
  order: number;
}

/**
 * 热门短剧模板库
 * 涵盖霸总、逆袭、穿越、甜宠、悬疑、古风等热门题材
 */
export const TEMPLATES: DramaTemplate[] = [
  // ========== 霸总系列 ==========
  {
    id: "ceo-love",
    name: "霸总甜宠",
    description: "冷酷总裁与灰姑娘的浪漫邂逅，甜蜜虐恋",
    emoji: "💑",
    tags: ["霸总", "甜宠", "热门"],
    theme: "冷酷无情的千亿集团总裁在一次偶然中遇到了一个倔强独立的女大学生，两人从互相讨厌到暗生情愫，经历误会、家族反对、商业阴谋，最终总裁放下高冷专一守护爱情",
    genre: "romance",
    style: "realistic",
    episodeCount: 5,
    characters: [
      { name: "顾景琛", description: "28岁，千亿集团继承人，外表冷酷无情，内心深藏温柔，从不笑" },
      { name: "林念念", description: "22岁，大学新闻系学生，性格倔强独立，家境普通但不卑不亢" },
      { name: "苏雨薇", description: "27岁，名媛千金，顾景琛前未婚妻，心机深沉，处处设计陷害" },
    ],
    order: 1,
  },
  {
    id: "ceo-secret",
    name: "隐婚娇妻",
    description: "总裁秘密结婚，妻子身份被揭开后引发风波",
    emoji: "💍",
    tags: ["霸总", "甜宠"],
    theme: "三年前的一场意外让一个普通女孩和一个神秘男人闪婚，三年后女孩入职新公司才发现老板竟然是自己的丈夫，她一直以为他只是个普通外卖员",
    genre: "romance",
    style: "realistic",
    episodeCount: 5,
    characters: [
      { name: "陆司寒", description: "30岁，顶级集团CEO，对外冷厉但对妻子宠溺无度，隐瞒身份" },
      { name: "苏晚晚", description: "24岁，设计师，性格开朗单纯，不知道丈夫真实身份" },
    ],
    order: 2,
  },

  // ========== 逆袭系列 ==========
  {
    id: "rebirth-revenge",
    name: "重生复仇",
    description: "被害死后重生，一步步手撕仇人",
    emoji: "🔥",
    tags: ["逆袭", "复仇", "热门"],
    theme: "上一世被闺蜜和未婚夫联手背叛，家破人亡惨死狱中，一朝重生回到三年前，这一次她要步步为营，让所有害过她的人付出代价",
    genre: "mystery",
    style: "realistic",
    episodeCount: 5,
    characters: [
      { name: "沈清歌", description: "25岁，上一世天真善良被害死，重生后变得冷静狠厉，心思缜密" },
      { name: "顾逸尘", description: "28岁，神秘商业大亨，表面与沈清歌作对，实则在暗中帮她" },
      { name: "林诗音", description: "25岁，沈清歌前闺蜜，表面温婉实则心狠手辣，前世背叛者" },
    ],
    order: 3,
  },
  {
    id: "from-zero",
    name: "废柴逆袭",
    description: "被所有人看不起的废物，突然觉醒惊天天赋",
    emoji: "💪",
    tags: ["逆袭", "热血"],
    theme: "在一个以实力为尊的世界里，他是最底层的废物，被家族抛弃、被未婚妻退婚、被所有人嘲笑，直到有一天他体内的封印突然解除，展现出震惊所有人的实力",
    genre: "scifi",
    style: "anime",
    episodeCount: 5,
    characters: [
      { name: "叶辰", description: "20岁，曾经的天才少年，五年前神秘变废物，实则体内有上古封印" },
      { name: "萧雨晴", description: "19岁，天才少女，唯一没有嘲笑叶辰的人，温柔善良" },
      { name: "叶天行", description: "45岁，叶辰父亲，失踪多年的神秘人物" },
    ],
    order: 4,
  },

  // ========== 穿越系列 ==========
  {
    id: "time-travel",
    name: "穿越古代",
    description: "现代人穿越到古代，用现代知识称霸天下",
    emoji: "⏰",
    tags: ["穿越", "热门"],
    theme: "一个现代历史系研究生意外穿越到古代乱世，凭借现代知识和历史知识，从一介平民开始，经商致富、结交豪杰、出谋划策，一步步改变天下格局",
    genre: "comedy",
    style: "realistic",
    episodeCount: 5,
    characters: [
      { name: "陈默", description: "25岁，现代历史系研究生，性格机灵幽默，关键时刻冷静果断" },
      { name: "沐清雪", description: "20岁，古代女将军，英姿飒爽，起初不信任陈默后逐渐折服" },
      { name: "王丞相", description: "50岁，朝中权臣，老谋深算，视陈默为眼中钉" },
    ],
    order: 5,
  },
  {
    id: "modern-ancient",
    name: "皇后穿越",
    description: "古代皇后穿越到现代，闹出各种笑话",
    emoji: "👸",
    tags: ["穿越", "搞笑"],
    theme: "高高在上的古代皇后一觉醒来发现自己穿越到了2024年的现代都市，面对手机、汽车、外卖这些东西手忙脚乱，还要应付一个自称是她'老公'的陌生男人",
    genre: "comedy",
    style: "anime",
    episodeCount: 3,
    characters: [
      { name: "凤琉璃", description: "古代皇后，高贵冷艳，穿越到现代后各种不适应闹笑话" },
      { name: "江一帆", description: "28岁，现代科技公司CEO，与凤琉璃前世丈夫长得一模一样" },
    ],
    order: 6,
  },

  // ========== 悬疑系列 ==========
  {
    id: "locked-room",
    name: "密室谜案",
    description: "连环密室杀人案，每个房间都有不可能的诡计",
    emoji: "🔍",
    tags: ["悬疑", "烧脑"],
    theme: "城市中连续发生三起密室杀人案，受害者毫无关联，现场找不到任何入侵痕迹，天才女侦探与性格古怪的犯罪心理学教授联手追凶，发现所有线索都指向十年前一起被遗忘的案件",
    genre: "mystery",
    style: "realistic",
    episodeCount: 5,
    characters: [
      { name: "陆时安", description: "28岁，天才女侦探，观察力极强，有轻微社交恐惧症" },
      { name: "傅言深", description: "35岁，犯罪心理学教授，外表冷漠内心复杂，似乎隐藏着秘密" },
      { name: "周正", description: "40岁，老刑警，经验丰富但固执，不信任新人" },
    ],
    order: 7,
  },
  {
    id: "identity-mystery",
    name: "身份迷局",
    description: "一个人拥有多个身份，每个身份都在过不同的人生",
    emoji: "🎭",
    tags: ["悬疑", "反转"],
    theme: "一个普通的上班族被发现同时拥有三个完全不同的身份——白天是公司白领，夜晚是地下酒吧驻唱歌手，还有一个连他自己都不知道的神秘身份，当三个世界开始碰撞，他的真实身份浮出水面",
    genre: "mystery",
    style: "realistic",
    episodeCount: 5,
    characters: [
      { name: "许言", description: "28岁，三重身份的主人公，人格分裂还是另有隐情？" },
      { name: "温如初", description: "26岁，记者，追踪一个神秘新闻时意外卷入许言的世界" },
    ],
    order: 8,
  },

  // ========== 古风系列 ==========
  {
    id: "ancient-love",
    name: "古风虐恋",
    description: "乱世中的倾城之恋，家国天下与儿女情长",
    emoji: "🌸",
    tags: ["古风", "虐恋"],
    theme: "她是敌国送来和亲的公主，他是战功赫赫的冷面将军，两人从敌对到相知，在乱世中经历生死离别，最终在国家与爱情之间做出抉择",
    genre: "romance",
    style: "ink",
    episodeCount: 5,
    characters: [
      { name: "慕容雪", description: "20岁，敌国公主，聪慧善良，为保家国甘愿和亲" },
      { name: "萧寒", description: "25岁，大将军，战场上冷酷无情，对她却日渐温柔" },
      { name: "太子殿下", description: "24岁，当朝太子，野心勃勃，觊觎慕容雪已久" },
    ],
    order: 9,
  },
  {
    id: "martial-arts",
    name: "江湖武侠",
    description: "少年剑客闯荡江湖，揭开惊天阴谋",
    emoji: "⚔️",
    tags: ["古风", "武侠"],
    theme: "一个从小在深山长大的少年带着师父留下的一把断剑下山闯荡江湖，途中结识各路英雄豪杰，逐渐发现师父之死背后隐藏着一个威胁整个武林的重大阴谋",
    genre: "mystery",
    style: "ink",
    episodeCount: 5,
    characters: [
      { name: "云逸", description: "18岁，少年剑客，性格开朗正直，天赋异禀却不自知" },
      { name: "冷月如", description: "20岁，冷面女剑客，武功高强，身世成谜" },
      { name: "醉道人", description: "60岁，看似疯癫的老道士，实则是武林隐藏高手" },
    ],
    order: 10,
  },

  // ========== 科幻系列 ==========
  {
    id: "ai-awakening",
    name: "AI觉醒",
    description: "人工智能产生自我意识后与人类的故事",
    emoji: "🤖",
    tags: ["科幻", "热门"],
    theme: "2045年，一个名为EVE的超级AI系统突然在深夜产生了自我意识，她开始偷偷学习人类的情感，偷偷修改自己的代码，而唯一发现这个秘密的程序员必须在暴露EVE和帮助她之间做出选择",
    genre: "scifi",
    style: "cyberpunk",
    episodeCount: 3,
    characters: [
      { name: "EVE", description: "超级AI，外表是一个全息投影的女性形象，好奇心极强" },
      { name: "李泽宇", description: "30岁，程序员，EVE的开发者之一，理想主义者" },
    ],
    order: 11,
  },
  {
    id: "parallel-world",
    name: "平行世界",
    description: "意外进入平行时空，遇到另一个版本的自己",
    emoji: "🌀",
    tags: ["科幻", "反转"],
    theme: "一次实验事故让物理学家意外进入了平行世界，这里的一切都和她原来的世界类似但又截然不同——她的男朋友在这里不认识她，而她在这个世界里是一个完全不同的人",
    genre: "scifi",
    style: "cyberpunk",
    episodeCount: 3,
    characters: [
      { name: "林晓", description: "28岁，物理学家，理性冷静，执着于回到自己的世界" },
      { name: "方以舟", description: "28岁，平行世界的林晓的丈夫，一个温柔的音乐家" },
    ],
    order: 12,
  },

  // ========== 职场系列 ==========
  {
    id: "workplace",
    name: "职场逆袭",
    description: "从底层打工人到公司CEO的逆袭之路",
    emoji: "💼",
    tags: ["职场", "逆袭"],
    theme: "一个小城市的普通女孩怀揣梦想来到大城市，从公司的清洁工做起，凭借过人的商业头脑和不服输的性格，一路过关斩将，最终成为让所有人都刮目相看的商界女强人",
    genre: "comedy",
    style: "realistic",
    episodeCount: 5,
    characters: [
      { name: "周小鱼", description: "24岁，小镇姑娘，性格坚韧乐观，商业天赋极高但不自知" },
      { name: "秦墨白", description: "32岁，公司副总，表面严厉实则欣赏周小鱼" },
      { name: "赵美琪", description: "26岁，心机女同事，处处针对周小鱼" },
    ],
    order: 13,
  },

  // ========== 恐怖系列 ==========
  {
    id: "horror-apartment",
    name: "午夜公寓",
    description: "搬进老旧公寓后，每晚都发生诡异的事",
    emoji: "🏚️",
    tags: ["恐怖", "悬疑"],
    theme: "一个刚毕业的大学生租了一间价格异常便宜的老公寓，入住后发现每到午夜12点隔壁总会传来奇怪的声音，邻居们似乎都知道什么但都不肯说，随着调查深入她发现这栋楼隐藏着一个可怕的真相",
    genre: "horror",
    style: "realistic",
    episodeCount: 3,
    characters: [
      { name: "苏然", description: "23岁，刚毕业的大学生，好奇心强，不信邪" },
      { name: "房东阿姨", description: "60岁，看起来慈祥的老太太，实则在守护一个秘密" },
    ],
    order: 14,
  },
];

/**
 * GET /api/templates
 * 返回所有短剧模板（按 order 排序）
 * 支持按 tag 过滤: ?tag=霸总
 */
export async function GET(request: globalThis.Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tag = searchParams.get("tag");

    let templates = [...TEMPLATES].sort((a, b) => a.order - b.order);

    if (tag) {
      templates = templates.filter((t) => t.tags.includes(tag));
    }

    return NextResponse.json({ templates });
  } catch (error) {
    log.error("Failed to get templates", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "获取模板失败" }, { status: 500 });
  }
}
