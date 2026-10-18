export interface TyphoonNamingEntry {
  english: string;
  chinese: string;
  source: string;
}

/**
 * ESCAP/WMO Typhoon Committee Western North Pacific / South China Sea naming list.
 * Effective 2026-06-08. Operational order runs down each column of the official
 * 28-row x 5-column table, then continues at the top of the next column.
 */
const rows: Array<[string, Array<[string, string]>]> = [
  ["柬埔寨", [["Damrey","达维"],["Koki","高基"],["Nakri","娜基莉"],["Krovanh","科罗旺"],["Trases","翠丝"]]],
  ["中国", [["Tianma","天马"],["Yinxing","银杏"],["Fengshen","风神"],["Dujuan","杜鹃"],["Mulan","木兰"]]],
  ["朝鲜", [["Kirogi","鸿雁"],["Gaeguri","简古维"],["Kalmaegi","海鸥"],["Surigae","舒力基"],["Meari","米雷"]]],
  ["中国香港", [["Yun-yeung","鸳鸯"],["Dim-sum","点心"],["Fung-wong","凤凰"],["Choi-wan","彩云"],["Tsing-ma","青马"]]],
  ["日本", [["Koinu","小犬"],["Hebi","希比"],["Koto","天琴"],["Koguma","小熊"],["Tokage","蝎虎"]]],
  ["老挝", [["Bolaven","布拉万"],["Pabuk","帕布"],["Nokaen","洛鞍"],["Champi","蔷琵"],["Ong-mang","坡鹿"]]],
  ["中国澳门", [["Sanba","三巴"],["Wutip","蝴蝶"],["Penha","西望洋"],["In-Fa","烟花"],["Muifa","梅花"]]],
  ["马来西亚", [["Jelawat","杰拉华"],["Sepat","圣帕"],["Nuri","鹦鹉"],["Cempaka","查帕卡"],["Merbok","苗柏"]]],
  ["密克罗尼西亚", [["Tirou","蒂鲁"],["Mun","木恩"],["Sinlaku","森拉克"],["Nepartak","尼伯特"],["Nanmadol","南玛都"]]],
  ["菲律宾", [["Maliksi","马力斯"],["Danas","丹娜丝"],["Hagupit","黑格比"],["Lupit","卢碧"],["Talas","塔拉斯"]]],
  ["韩国", [["Gaemi","格美"],["Nari","百合"],["Jangmi","蔷薇"],["Mirinae","银河"],["Hodu","核桃"]]],
  ["泰国", [["Prapiroon","派比安"],["Wipha","韦帕"],["Mekkhala","米克拉"],["Nida","妮妲"],["Kulap","玫瑰"]]],
  ["美国", [["Maria","玛莉亚"],["Francisco","范斯高"],["Higos","海高斯"],["Omais","奥麦斯"],["Roke","洛克"]]],
  ["越南", [["Son-Tinh","山神"],["Co-May","竹节草"],["Bavi","巴威"],["Luc-Binh","浮莲"],["Sonca","桑卡"]]],
  ["柬埔寨", [["Ampil","安比"],["Krosa","罗莎"],["Maysak","美莎克"],["Chanthu","灿都"],["Nesat","纳沙"]]],
  ["中国", [["Wukong","悟空"],["Bailu","白鹿"],["Haishen","海神"],["Dianmu","电母"],["Haitang","海棠"]]],
  ["朝鲜", [["Jongdari","云雀"],["Podul","杨柳"],["Noul","红霞"],["Mindulle","蒲公英"],["Jamjari","蜻蜓"]]],
  ["中国香港", [["Shanshan","珊珊"],["Lingling","玲玲"],["Dolphin","白海豚"],["Lionrock","狮子山"],["Banyan","榕树"]]],
  ["日本", [["Tomo","船尾"],["Kajiki","剑鱼"],["Kujira","鲸鱼"],["Tokei","道玑"],["Yamaneko","山猫"]]],
  ["老挝", [["Leepi","丽琵"],["Nongfa","蓝湖"],["Chan-hom","灿鸿"],["Namtheun","南川"],["Pakhar","帕卡"]]],
  ["中国澳门", [["Bebinca","贝碧嘉"],["Peipah","琵琶"],["Peilou","琵鹭"],["Malou","玛瑙"],["Sanvu","珊瑚"]]],
  ["马来西亚", [["Pulasan","普拉桑"],["Tapah","塔巴"],["Nangka","浪卡"],["Nyatoh","妮亚图"],["Mawar","玛娃"]]],
  ["密克罗尼西亚", [["Soulik","苏力"],["Mitag","米娜"],["Saudel","沙德尔"],["Sarbul","沙布尔"],["Guchol","古超"]]],
  ["菲律宾", [["Cimaron","西马仑"],["Ragasa","桦加沙"],["Narra","紫檀"],["Amuyao","阿穆丘"],["Talim","泰利"]]],
  ["韩国", [["Narae","娜尼"],["Neoguri","浣熊"],["Gaenari","简拉维"],["Gosari","古莎莉"],["Bori","布里"]]],
  ["泰国", [["Burapha","布拉帕"],["Bualoi","博罗依"],["Atsani","艾莎尼"],["Chaba","暹芭"],["Khanun","卡努"]]],
  ["美国", [["Barijat","百里嘉"],["Matmo","麦德姆"],["Etau","艾涛"],["Aere","艾利"],["Lan","兰恩"]]],
  ["越南", [["Hoaban","花斑"],["Halong","夏浪"],["Bang-Lang","班朗"],["Songda","桑达"],["Saobien","海星"]]]
];

export const TYPHOON_NAMING_TABLE: TyphoonNamingEntry[] = Array.from({ length: 5 }, (_, column) =>
  rows.map(([source, names]) => ({ source, english: names[column][0], chinese: names[column][1] }))
).flat();

export const getTyphoonNamingEntry = (
  index: number,
  overrides?: Record<string, string>
): TyphoonNamingEntry => {
  const normalized = ((Math.floor(index) % TYPHOON_NAMING_TABLE.length) + TYPHOON_NAMING_TABLE.length) % TYPHOON_NAMING_TABLE.length;
  const base = TYPHOON_NAMING_TABLE[normalized];
  // 3.7.1 stores edits by stable international name so changing the selected start index cannot
  // attach a custom Chinese label to the wrong cyclone. Numeric keys are still accepted for any
  // development snapshot created before this storage format was finalized.
  const custom = (overrides?.[base.english] ?? overrides?.[String(normalized)])?.trim();
  return custom ? { ...base, chinese: custom } : base;
};
