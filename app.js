import { CARDS } from "./src/data/cards.js";
import { NPCS } from "./src/data/npcs.js";

const VERSION = "0.1.60";
const SAVE_KEY = "phantom_card_battle_save_v5_182_rules_npc15";

const cardById = new Map(CARDS.map((card) => [card.id, card]));

function normalizeCardLookupName(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function resolveCardRef(ref, contextLabel = "カード参照") {
  if (!ref) return null;
  if (typeof ref === "string") {
    return cardById.get(ref) ?? null;
  }

  const targetName = normalizeCardLookupName(ref.name);
  const candidates = CARDS.filter((card) => {
    if (targetName && normalizeCardLookupName(card.name) !== targetName) return false;
    if (ref.type && String(card.type ?? "") !== String(ref.type)) return false;
    if (ref.rarity && Number(card.rarity) !== Number(ref.rarity)) return false;
    if (ref.cardNo && String(card.cardNo) !== String(ref.cardNo)) return false;
    return true;
  });

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    console.warn(`${contextLabel}: 複数カードが一致しました。先頭を使用します。`, ref, candidates.map((card) => card.id));
    return candidates[0];
  }
  console.warn(`${contextLabel}: カードが見つかりません。`, ref);
  return null;
}

function resolveCardPoolSpec(spec, contextLabel = "カードプール") {
  if (!spec) return [];
  const rarities = Array.isArray(spec.rarities) ? spec.rarities.map(Number) : null;
  const ids = new Set();
  const cards = [];
  const addCard = (card) => {
    if (!card || ids.has(card.id)) return;
    ids.add(card.id);
    cards.push(card);
  };

  if (rarities || spec.type || spec.untypedOnly) {
    for (const card of CARDS) {
      if (rarities && !rarities.includes(Number(card.rarity))) continue;
      if (spec.type && String(card.type ?? "") !== String(spec.type)) continue;
      if (spec.untypedOnly && card.type) continue;
      addCard(card);
    }
  }

  for (const ref of spec.fixedCardRefs ?? []) {
    addCard(resolveCardRef(ref, `${contextLabel}の固定カード`));
  }

  return cards;
}

function hydrateNpcCardReferences(npc) {
  const label = `${npc.name ?? npc.id}`;
  const poolCards = resolveCardPoolSpec(npc.cardPoolSpec, `${label}の所持カード`);
  if (poolCards.length) npc.cardPool = poolCards.map((card) => card.id);

  if (npc.littlePoolSpecs) {
    npc.littlePools = {};
    for (const [key, spec] of Object.entries(npc.littlePoolSpecs)) {
      npc.littlePools[key] = resolveCardPoolSpec(spec, `${label}のリトル${key}カード`).map((card) => card.id);
    }
  }

  if (Array.isArray(npc.requiredCardRefs)) {
    npc.requiredCards = npc.requiredCardRefs
      .map((ref) => resolveCardRef(ref, `${label}の必須カード`))
      .filter(Boolean)
      .map((card) => card.id);
  }

  if (npc.firstWinRewardCardRef) {
    npc.firstWinRewardCardId = resolveCardRef(npc.firstWinRewardCardRef, `${label}の初回勝利報酬`)?.id ?? null;
  }

  if (Array.isArray(npc.fixedCardRefs)) {
    npc.fixedCards = npc.fixedCardRefs
      .map((ref) => resolveCardRef(ref, `${label}の固定カード`))
      .filter(Boolean)
      .map((card) => card.id);
  }
}

for (const npc of NPCS) hydrateNpcCardReferences(npc);
const npcById = new Map(NPCS.map((npc) => [npc.id, npc]));

const state = {
  save: null,
  selectedDeckIndex: 0,
  selectedHandIndex: null,
  deckSort: { field: "rarity", order: "desc" },
  ownedCardView: "vertical",
  battleCardPopup: true,
  selectedRuleIds: [],
  npcListMode: "normal",
  npcListUi: {
    difficulty: "all",
    winStatus: "all",
    attribute: "all",
    sortField: "number",
    sortOrder: "asc"
  },
  deckFilter: { rarity: "all", attribute: "all" },
  collectionFilter: { rarity: "all", attribute: "all", sortField: "number", sortOrder: "asc" },
  enhancementView: "awakening",
  selectedAwakeningCardId: null,
  pendingKaijutsuUnlocks: [],
  shopStock: [],
  shopInitialized: false,
  pendingNpcItems: {
    npcId: null,
    lockDetectorUsed: false,
    miracleCharmUsed: false
  },
  online: {
    firebase: null,
    roomId: null,
    playerKey: null,
    unsubscribe: null,
    lastRoomStatus: null,
    finishedShown: false,
    ratingApplying: false,
    cachedProfile: null
  },
  battle: null,
  currentModalSpec: null,
  lastResultModalSpec: null,
  pixi: {
    app: null,
    boardLayer: null,
    effectLayer: null,
    cellSize: 132,
    gap: 12,
    originX: 22,
    originY: 22
  }
};

const $ = (id) => document.getElementById(id);

const screens = {
  title: $("screen-title"),
  battleSelect: $("screen-battle-select"),
  battleMenu: $("screen-battle-menu"),
  onlineBattle: $("screen-online-battle"),
  battle: $("screen-battle"),
  deck: $("screen-deck"),
  cardEnhance: $("screen-card-enhance"),
  shop: $("screen-shop"),
  collection: $("screen-collection"),
  rankings: $("screen-rankings"),
  rules: $("screen-rules"),
  settings: $("screen-settings")
};

const DECK_SORT_FIELDS = new Set(["name", "rarity", "right", "up", "left", "down", "power"]);

const RULES = [
  { id: "order", name: "オーダー", short: "デッキ左から順番に出すカードが固定されます。" },
  { id: "chaos", name: "カオス", short: "自分と相手の出すカードが毎ターンランダム指定されます。" },
  { id: "all_open", name: "オールオープン", short: "お互いの手札がすべて見える状態で開始します。" },
  { id: "swap", name: "スワップ", short: "開始前に手札1枚をランダム交換します。対戦後は戻ります。" },
  { id: "reverse", name: "リバース", short: "数字の強さが逆になります。Aが最弱、1が最強です。" },
  { id: "ace_killer", name: "エースキラー", short: "1だけがAに勝てます。1は2〜9には勝てません。" },
  { id: "type_ascend", name: "タイプアセンド", short: "場に同じ属性カードが2枚以上ある時、その属性の場のカードだけが+補正されます。" },
  { id: "type_descend", name: "タイプディセンド", short: "場に同じ属性カードが2枚以上ある時、その属性の場のカードだけが-補正されます。1未満にはなりません。" },
  { id: "mirror", name: "ミラー", short: "場に出した瞬間、カードの上下・左右の数字が入れ替わります。" },
  { id: "wild_card", name: "ワイルドカード", short: "対戦開始時に、各プレイヤーの手札からランダムで1枚だけ選ばれます。そのカードは「どれか1辺が+2」または「どれか1辺がAになり、別の1辺が1になる」のどちらかの変化を受けます。" },
  { id: "little_1", name: "リトル★", short: "★1までのカードだけで対戦します。★デッキを使用し、他の追加ルールも適用されます。" },
  { id: "little_2", name: "リトル★★", short: "★2までのカードだけで対戦します。★★デッキを使用し、他の追加ルールも適用されます。" },
  { id: "little_3", name: "リトル★★★", short: "★3までのカードだけで対戦します。★★★デッキを使用し、他の追加ルールも適用されます。" },
  { id: "plus", name: "プラス", short: "接する辺の合計値が2辺以上同じなら対象カードを奪います。" },
  { id: "same", name: "セイム", short: "接する2辺以上の数字が同じなら対象カードを奪います。" },
  { id: "combo", name: "コンボ", short: "奪ったカードからさらに通常比較で連鎖します。" }
];

const RULE_NAME_BY_ID = Object.fromEntries(RULES.map((rule) => [rule.id, rule.name]));
const CARD_TYPES = ["もなタイプ", "美雨タイプ", "凛花タイプ", "百花タイプ"];
const CARD_SIDES = ["up", "right", "down", "left"];
const NORMAL_DECK_COUNT = 5;
const LITTLE_DECKS = [
  { index: 5, maxRarity: 1, label: "★デッキ", defaultName: "★デッキ" },
  { index: 6, maxRarity: 2, label: "★★デッキ", defaultName: "★★デッキ" },
  { index: 7, maxRarity: 3, label: "★★★デッキ", defaultName: "★★★デッキ" }
];
const TOTAL_DECK_COUNT = NORMAL_DECK_COUNT + LITTLE_DECKS.length;
const LITTLE_RULE_IDS = ["little_1", "little_2", "little_3"];
const SHOP_PRICES = { 1: 100, 2: 500, 3: 5000 };
const SHOP_ITEMS = [
  {
    id: "lock_detector",
    name: "鍵探知機",
    price: 50000,
    maxOwned: 5,
    description: "追加ルール決定時に使用すると、対戦開始前からロックマスの場所が表示されます。"
  },
  {
    id: "miracle_charm",
    name: "奇跡の御守り",
    price: 100000,
    maxOwned: 5,
    description: "追加ルール決定時に使用すると、その対戦だけレアチャンス率が2倍になります。"
  }
];
const SHOP_ITEM_BY_ID = new Map(SHOP_ITEMS.map((item) => [item.id, item]));
const AWAKENING_STAGE_SETTINGS = [
  { stage: 1, name: "壱ノ怪", copies: 1 },
  { stage: 2, name: "弐ノ怪", copies: 2 },
  { stage: 3, name: "参ノ怪", copies: 3 }
];
const AWAKENING_STAGE_BY_NUMBER = new Map(AWAKENING_STAGE_SETTINGS.map((item) => [item.stage, item]));
const AWAKENING_RESIDUE_COST_BY_RARITY = {
  4: { 1: 50, 2: 100, 3: 150 },
  5: { 1: 100, 2: 200, 3: 300 }
};

function getAwakeningResidueCost(card, stageSetting) {
  if (!card || !stageSetting) return 0;
  const rarityCosts = AWAKENING_RESIDUE_COST_BY_RARITY[Number(card.rarity)];
  return Number(rarityCosts?.[Number(stageSetting.stage)] ?? 0);
}
const RESIDUE_VALUE_BY_RARITY = { 1: 1, 2: 5, 3: 20 };


const KAIJUTSU_SKILLS = [
  {
    id: "none",
    name: "なし",
    unlockRate: 0,
    description: "怪異術を装備しません。"
  },
  {
    id: "curse_boost",
    name: "呪力強化",
    unlockRate: 20,
    description: "次に出すカードの選んだ1辺を、その対戦中だけ+1します。"
  },
  {
    id: "right_rebirth",
    name: "右方転生",
    unlockRate: 30,
    description: "次に出すカードを右へ90度回転させて配置します。"
  },
  {
    id: "left_rebirth",
    name: "左方転生",
    unlockRate: 30,
    description: "次に出すカードを左へ90度回転させて配置します。"
  },
  {
    id: "field_purge",
    name: "地縛祓い",
    unlockRate: 70,
    description: "空いているマスの-2・-1・+1・+2のフィールド効果を1つ無効化します。ロックマスとカード配置済みマスには使えません。"
  },
  {
    id: "blood_contract",
    name: "血の契約",
    unlockRate: 80,
    description: "次に出すカードの選んだ1辺を+2し、別のランダムな1辺を-2します。"
  },
  {
    id: "ominous_number",
    name: "忌み数",
    unlockRate: 85,
    description: "次に出すカードの最小の1辺をAにし、別の最大の1辺を1にします。同値の辺はランダムで選ばれます。"
  }
];
const KAIJUTSU_BY_ID = new Map(KAIJUTSU_SKILLS.map((skill) => [skill.id, skill]));
const NEXT_CARD_KAIJUTSU_IDS = new Set(["curse_boost", "right_rebirth", "left_rebirth", "blood_contract", "ominous_number"]);

const SHOP_GRADE_SETTINGS = [
  { grade: 1, required: 0, refreshFee: 100, stock: { 1: 7, 2: 2, 3: 1 } },
  { grade: 2, required: 1000, refreshFee: 200, stock: { 1: 4, 2: 3, 3: 3 } },
  { grade: 3, required: 5000, refreshFee: 500, stock: { 1: 1, 2: 5, 3: 4 } },
  { grade: 4, required: 20000, refreshFee: 1000, stock: { 1: 1, 2: 4, 3: 5 } },
  { grade: 5, required: 100000, refreshFee: 2000, stock: { 1: 1, 2: 3, 3: 6 } }
];

function normalizeDeckSort() {
  if (!DECK_SORT_FIELDS.has(state.deckSort.field)) state.deckSort.field = "rarity";
  if (!["asc", "desc"].includes(state.deckSort.order)) state.deckSort.order = "desc";
}

function normalizeOwnedCardView(view) {
  return view === "horizontal" ? "horizontal" : "vertical";
}

function getOwnedCardView() {
  return normalizeOwnedCardView(state.save?.settings?.ownedCardView ?? state.ownedCardView);
}

function setOwnedCardView(view) {
  state.ownedCardView = normalizeOwnedCardView(view);
  state.save.settings.ownedCardView = state.ownedCardView;
  save();
  updateOwnedCardViewButtons();
  renderOwnedCardList();
}

function updateOwnedCardViewButtons() {
  const view = getOwnedCardView();
  const vertical = $("ownedViewVertical");
  const horizontal = $("ownedViewHorizontal");
  if (!vertical || !horizontal) return;

  vertical.classList.toggle("active", view === "vertical");
  vertical.classList.toggle("ghost", view !== "vertical");
  horizontal.classList.toggle("active", view === "horizontal");
  horizontal.classList.toggle("ghost", view !== "horizontal");
}

function getLittleDeckByIndex(index) {
  return LITTLE_DECKS.find((deck) => deck.index === index) ?? null;
}

function isLittleDeckIndex(index) {
  return Boolean(getLittleDeckByIndex(index));
}

function getDeckDefaultName(index) {
  const little = getLittleDeckByIndex(index);
  return little ? little.defaultName : `デッキ${index + 1}`;
}

function getDeckDisplayName(index) {
  return String(state.save?.deckNames?.[index] || getDeckDefaultName(index));
}

function getDeckRarityLimitByIndex(index) {
  return getLittleDeckByIndex(index)?.maxRarity ?? null;
}

function isLittleRuleId(ruleId) {
  return LITTLE_RULE_IDS.includes(ruleId);
}

function getLittleRuleMaxRarity(ruleIds = []) {
  const rule = (ruleIds ?? []).find(isLittleRuleId);
  if (!rule) return null;
  return Number(rule.replace("little_", "")) || null;
}

function getLittleDeckIndexForRule(ruleIds = []) {
  const maxRarity = getLittleRuleMaxRarity(ruleIds);
  if (!maxRarity) return null;
  return LITTLE_DECKS.find((deck) => deck.maxRarity === maxRarity)?.index ?? null;
}

function getDeckIndexForRules(ruleIds = []) {
  return getLittleDeckIndexForRule(ruleIds) ?? state.save.activeDeckIndex;
}

function getDeckRuleNote(index) {
  const limit = getDeckRarityLimitByIndex(index);
  return limit ? `このデッキはリトル${rarityStars(limit)}専用です。${rarityStars(limit)}までのカードだけ登録できます。` : "通常対戦で使用するデッキです。";
}

function getDeckCardsByIndex(index) {
  return (state.save.decks[index] ?? []).map((id) => cardById.get(id)).filter(Boolean);
}

function compareOwnedCards(a, b) {
  normalizeDeckSort();
  const direction = state.deckSort.order === "asc" ? 1 : -1;
  const field = state.deckSort.field;
  let result = 0;

  if (field === "name") {
    result = String(a.name).localeCompare(String(b.name), "ja");
  } else {
    result = Number(a[field] ?? 0) - Number(b[field] ?? 0);
  }

  if (result !== 0) return result * direction;

  const fallbackPower = b.power - a.power;
  if (fallbackPower !== 0) return fallbackPower;
  return String(a.no).localeCompare(String(b.no), "ja", { numeric: true });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

let battleFitRaf = null;

function scheduleBattleAutoFit() {
  if (battleFitRaf !== null) cancelAnimationFrame(battleFitRaf);
  battleFitRaf = requestAnimationFrame(() => {
    battleFitRaf = null;
    fitBattleLayout();
  });
}

function rarityStars(rarity) {
  return "★".repeat(rarity);
}

function displayValue(value) {
  return value >= 10 ? "A" : String(value);
}

function formatMoney(amount) {
  return `${Number(amount ?? 0).toLocaleString("ja-JP")}銭`;
}

function getDiscoveredCount() {
  return CARDS.filter((card) => state.save.discoveredCards?.[card.id]).length;
}

function getCollectionRate() {
  return Math.floor((getDiscoveredCount() / Math.max(CARDS.length, 1)) * 10000) / 100;
}


function getCollectionRateForSave(saveData) {
  const discovered = CARDS.filter((card) => saveData?.discoveredCards?.[card.id]).length;
  return Math.floor((discovered / Math.max(CARDS.length, 1)) * 10000) / 100;
}

function unlockKaijutsuForSave(saveData) {
  if (!saveData || typeof saveData !== "object") return [];
  if (!saveData.unlockedKaijutsu || typeof saveData.unlockedKaijutsu !== "object") {
    saveData.unlockedKaijutsu = {};
  }
  const rate = getCollectionRateForSave(saveData);
  const newlyUnlocked = [];
  for (const skill of KAIJUTSU_SKILLS) {
    if (skill.id === "none") continue;
    if (rate >= Number(skill.unlockRate) && !saveData.unlockedKaijutsu[skill.id]) {
      saveData.unlockedKaijutsu[skill.id] = true;
      newlyUnlocked.push(skill.id);
    }
  }
  return newlyUnlocked;
}

function isKaijutsuUnlocked(skillId, saveData = state.save) {
  if (!skillId || skillId === "none") return true;
  return Boolean(saveData?.unlockedKaijutsu?.[skillId]);
}

function getDeckKaijutsuId(deckIndex) {
  const id = String(state.save?.deckKaijutsu?.[deckIndex] ?? "none");
  return KAIJUTSU_BY_ID.has(id) && isKaijutsuUnlocked(id) ? id : "none";
}

function getKaijutsuSkill(skillId) {
  return KAIJUTSU_BY_ID.get(skillId) ?? KAIJUTSU_BY_ID.get("none");
}

function safeUserNameKey(name) {
  const normalized = String(name ?? "").trim();
  return btoa(unescape(encodeURIComponent(normalized))).replace(/=+$/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function getOnlineUserName() {
  return String(state.save?.settings?.onlineUserName ?? "").trim();
}

function getOnlineUserNameKey() {
  const saved = String(state.save?.settings?.onlineUserNameKey ?? "").trim();
  return saved || (getOnlineUserName() ? safeUserNameKey(getOnlineUserName()) : "");
}

function getDefaultOnlineRating() {
  return 1500;
}

function getProfileRef(uid) {
  const fb = state.online.firebase;
  return fb.ref(fb.db, `profiles/${uid}`);
}

function getUsernameRef(nameKey) {
  const fb = state.online.firebase;
  return fb.ref(fb.db, `usernames/${nameKey}`);
}

function getLeaderboardRef(kind, uid = "") {
  const fb = state.online.firebase;
  return fb.ref(fb.db, uid ? `leaderboards/${kind}/${uid}` : `leaderboards/${kind}`);
}

function getCurrentRankingPayload(profile = null) {
  const name = getOnlineUserName();
  const username = profile?.username ?? name;
  const rating = Number(profile?.rating ?? getDefaultOnlineRating());
  const wins = Number(profile?.onlineWins ?? 0);
  const losses = Number(profile?.onlineLosses ?? 0);
  const draws = Number(profile?.onlineDraws ?? 0);
  const collectionCount = getDiscoveredCount();
  const collectionRate = getCollectionRate();
  const totalEarnedMoney = Number(state.save?.totalEarnedMoney ?? 0);
  const now = Date.now();
  return { username, rating, wins, losses, draws, collectionCount, collectionTotal: CARDS.length, collectionRate, totalEarnedMoney, updatedAt: now };
}

async function getOnlineProfile() {
  const fb = await ensureOnlineFirebase();
  const snap = await fb.get(getProfileRef(fb.uid));
  const currentName = getOnlineUserName();
  const profile = snap.exists() ? snap.val() : {};
  const merged = {
    uid: fb.uid,
    username: profile.username ?? currentName,
    usernameKey: profile.usernameKey ?? getOnlineUserNameKey(),
    rating: Number(profile.rating ?? getDefaultOnlineRating()),
    onlineWins: Number(profile.onlineWins ?? 0),
    onlineLosses: Number(profile.onlineLosses ?? 0),
    onlineDraws: Number(profile.onlineDraws ?? 0),
    createdAt: profile.createdAt ?? Date.now(),
    updatedAt: Date.now()
  };
  state.online.cachedProfile = merged;
  return merged;
}

async function syncPlayerRankings() {
  const name = getOnlineUserName();
  if (!name) return null;
  const fb = await ensureOnlineFirebase();
  const profile = await getOnlineProfile();
  const payload = getCurrentRankingPayload(profile);
  const profileUpdate = {
    uid: fb.uid,
    username: name,
    usernameKey: getOnlineUserNameKey(),
    rating: payload.rating,
    onlineWins: payload.wins,
    onlineLosses: payload.losses,
    onlineDraws: payload.draws,
    collectionCount: payload.collectionCount,
    collectionTotal: payload.collectionTotal,
    collectionRate: payload.collectionRate,
    totalEarnedMoney: payload.totalEarnedMoney,
    updatedAt: payload.updatedAt,
    createdAt: profile.createdAt ?? Date.now()
  };
  await fb.update(fb.ref(fb.db), {
    [`profiles/${fb.uid}`]: profileUpdate,
    [`leaderboards/onlineRating/${fb.uid}`]: {
      username: name,
      rating: payload.rating,
      wins: payload.wins,
      losses: payload.losses,
      draws: payload.draws,
      updatedAt: payload.updatedAt
    },
    [`leaderboards/collection/${fb.uid}`]: {
      username: name,
      rate: payload.collectionRate,
      count: payload.collectionCount,
      total: payload.collectionTotal,
      updatedAt: payload.updatedAt
    },
    [`leaderboards/totalEarnings/${fb.uid}`]: {
      username: name,
      totalEarnedMoney: payload.totalEarnedMoney,
      updatedAt: payload.updatedAt
    }
  });
  state.online.cachedProfile = profileUpdate;
  return profileUpdate;
}

function renderProfileSummary(profile = null) {
  const name = getOnlineUserName() || "未設定";
  const rating = Number(profile?.rating ?? state.online.cachedProfile?.rating ?? getDefaultOnlineRating());
  const settingName = $("settingUserName");
  if (settingName) settingName.value = getOnlineUserName();
  const rateLabels = [$("settingsRateLabel"), $("onlineRateLabel")].filter(Boolean);
  for (const label of rateLabels) label.textContent = `${rating}`;
  const usernameLabels = [$("settingsUserNameLabel"), $("onlineUserNameLabel")].filter(Boolean);
  for (const label of usernameLabels) label.textContent = name;
}

async function refreshProfileSummary() {
  try {
    if (!getOnlineUserName()) {
      renderProfileSummary(null);
      return;
    }
    const profile = await getOnlineProfile();
    renderProfileSummary(profile);
  } catch (error) {
    console.warn("profile refresh failed", error);
    renderProfileSummary(null);
  }
}

async function checkUserNameAvailability(showResult = true) {
  const input = $("settingUserName");
  const result = $("userNameCheckResult");
  const name = String(input?.value ?? "").trim();
  if (!name) {
    if (result) result.textContent = "ユーザー名を入力してください。";
    return false;
  }
  if (name.length > 16) {
    if (result) result.textContent = "ユーザー名は16文字以内にしてください。";
    return false;
  }
  try {
    const fb = await ensureOnlineFirebase();
    const key = safeUserNameKey(name);
    const snap = await fb.get(getUsernameRef(key));
    const value = snap.exists() ? snap.val() : null;
    const ok = !value || value.uid === fb.uid;
    if (showResult && result) result.textContent = ok ? "このユーザー名は使用できます。" : "このユーザー名は既に使用されています。";
    return ok;
  } catch (error) {
    if (result) result.textContent = `確認エラー：${error.message ?? error}`;
    return false;
  }
}

async function saveUserNameSetting() {
  const input = $("settingUserName");
  const result = $("userNameCheckResult");
  const name = String(input?.value ?? "").trim();
  if (!name) {
    if (result) result.textContent = "ユーザー名を入力してください。";
    return;
  }
  const ok = await checkUserNameAvailability(false);
  if (!ok) {
    if (result) result.textContent = "このユーザー名は使用できません。";
    return;
  }
  try {
    const fb = await ensureOnlineFirebase();
    const newKey = safeUserNameKey(name);
    const oldKey = getOnlineUserNameKey();
    const updates = {};
    if (oldKey && oldKey !== newKey) {
      const oldSnap = await fb.get(getUsernameRef(oldKey));
      if (oldSnap.exists() && oldSnap.val()?.uid === fb.uid) updates[`usernames/${oldKey}`] = null;
    }
    updates[`usernames/${newKey}`] = { uid: fb.uid, name, updatedAt: Date.now() };
    await fb.update(fb.ref(fb.db), updates);
    state.save.settings.onlineUserName = name;
    state.save.settings.onlineUserNameKey = newKey;
    save();
    const profile = await syncPlayerRankings();
    renderProfileSummary(profile);
    if (result) result.textContent = "ユーザー名を保存しました。";
  } catch (error) {
    if (result) result.textContent = `保存エラー：${error.message ?? error}`;
  }
}

function requireOnlineUserName() {
  if (getOnlineUserName()) return true;
  showModal("ユーザー名設定", "<p>オンライン対戦・ランキングを使うには、設定画面でランキング用ユーザー名を登録してください。</p>", [
    { label: "設定へ", onClick: () => { closeModal(); showScreen("settings"); } },
    { label: "閉じる", className: "ghost", onClick: closeModal }
  ]);
  return false;
}

function calculateElo(ratingA, ratingB, scoreA, k = 32) {
  const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
  return Math.round(ratingA + k * (scoreA - expectedA));
}

async function applyOnlineRatingIfNeeded(room) {
  if (!room || room.status !== "finished" || room.ratingApplied || state.online.playerKey !== "p1" || state.online.ratingApplying) return;
  state.online.ratingApplying = true;
  try {
    const fb = await ensureOnlineFirebase();
    const p1Uid = room.players?.p1?.uid;
    const p2Uid = room.players?.p2?.uid;
    if (!p1Uid || !p2Uid) return;
    const [p1Snap, p2Snap] = await Promise.all([
      fb.get(getProfileRef(p1Uid)),
      fb.get(getProfileRef(p2Uid))
    ]);
    const p1Profile = p1Snap.exists() ? p1Snap.val() : {};
    const p2Profile = p2Snap.exists() ? p2Snap.val() : {};
    const p1Old = Number(p1Profile.rating ?? getDefaultOnlineRating());
    const p2Old = Number(p2Profile.rating ?? getDefaultOnlineRating());
    const winner = room.result?.winner ?? room.winner ?? "draw";
    const p1Score = winner === "draw" ? 0.5 : winner === "p1" ? 1 : 0;
    const p2Score = winner === "draw" ? 0.5 : winner === "p2" ? 1 : 0;
    const p1New = calculateElo(p1Old, p2Old, p1Score);
    const p2New = calculateElo(p2Old, p1Old, p2Score);
    const now = Date.now();
    const p1Name = p1Profile.username ?? room.players?.p1?.name ?? "プレイヤー1";
    const p2Name = p2Profile.username ?? room.players?.p2?.name ?? "プレイヤー2";
    const p1Wins = Number(p1Profile.onlineWins ?? 0) + (winner === "p1" ? 1 : 0);
    const p1Losses = Number(p1Profile.onlineLosses ?? 0) + (winner === "p2" ? 1 : 0);
    const p1Draws = Number(p1Profile.onlineDraws ?? 0) + (winner === "draw" ? 1 : 0);
    const p2Wins = Number(p2Profile.onlineWins ?? 0) + (winner === "p2" ? 1 : 0);
    const p2Losses = Number(p2Profile.onlineLosses ?? 0) + (winner === "p1" ? 1 : 0);
    const p2Draws = Number(p2Profile.onlineDraws ?? 0) + (winner === "draw" ? 1 : 0);
    await fb.update(fb.ref(fb.db), {
      [`profiles/${p1Uid}/rating`]: p1New,
      [`profiles/${p1Uid}/onlineWins`]: p1Wins,
      [`profiles/${p1Uid}/onlineLosses`]: p1Losses,
      [`profiles/${p1Uid}/onlineDraws`]: p1Draws,
      [`profiles/${p1Uid}/updatedAt`]: now,
      [`profiles/${p2Uid}/rating`]: p2New,
      [`profiles/${p2Uid}/onlineWins`]: p2Wins,
      [`profiles/${p2Uid}/onlineLosses`]: p2Losses,
      [`profiles/${p2Uid}/onlineDraws`]: p2Draws,
      [`profiles/${p2Uid}/updatedAt`]: now,
      [`leaderboards/onlineRating/${p1Uid}`]: { username: p1Name, rating: p1New, wins: p1Wins, losses: p1Losses, draws: p1Draws, updatedAt: now },
      [`leaderboards/onlineRating/${p2Uid}`]: { username: p2Name, rating: p2New, wins: p2Wins, losses: p2Losses, draws: p2Draws, updatedAt: now },
      [`rooms/${room.roomId}/ratingApplied`]: true,
      [`rooms/${room.roomId}/ratingChange`]: {
        p1: { old: p1Old, new: p1New, diff: p1New - p1Old },
        p2: { old: p2Old, new: p2New, diff: p2New - p2Old }
      }
    });
  } catch (error) {
    console.error("rating apply failed", error);
    try {
      const fb = await ensureOnlineFirebase();
      if (room?.roomId) await fb.update(onlineRoomRef(room.roomId), { ratingApplied: true, ratingError: String(error.message ?? error) });
    } catch (innerError) {
      console.error("rating error flag failed", innerError);
    }
  } finally {
    state.online.ratingApplying = false;
  }
}


function updateMoneyDisplays() {
  document.querySelectorAll("[data-money-display]").forEach((element) => {
    element.textContent = formatMoney(state.save?.money ?? 0);
  });
}

function getShopGradeSetting(total = state.save?.shopPurchaseTotal ?? 0) {
  const purchaseTotal = Number(total ?? 0);
  return [...SHOP_GRADE_SETTINGS]
    .reverse()
    .find((setting) => purchaseTotal >= setting.required) ?? SHOP_GRADE_SETTINGS[0];
}

function getNextShopGradeSetting() {
  const current = getShopGradeSetting();
  return SHOP_GRADE_SETTINGS.find((setting) => setting.grade > current.grade) ?? null;
}

function getShopRefreshFee() {
  return getShopGradeSetting().refreshFee;
}

function getShopStockPlan() {
  return getShopGradeSetting().stock;
}

function getCardShopPrice(card) {
  return SHOP_PRICES[Number(card?.rarity)] ?? null;
}

function getCardSellPrice(card) {
  const price = getCardShopPrice(card);
  if (!price) return null;
  return Math.floor(price / 2);
}

function getOwnedItemCount(itemId) {
  return Math.max(0, Math.floor(Number(state.save?.items?.[itemId] ?? 0)));
}

function getRemainingItemCapacity(itemId) {
  const item = SHOP_ITEM_BY_ID.get(itemId);
  if (!item) return 0;
  return Math.max(0, item.maxOwned - getOwnedItemCount(itemId));
}

function ensurePendingNpcItems(npcId) {
  if (state.pendingNpcItems?.npcId === npcId) return state.pendingNpcItems;
  state.pendingNpcItems = {
    npcId,
    lockDetectorUsed: false,
    miracleCharmUsed: false
  };
  return state.pendingNpcItems;
}

function getPendingNpcItemStatus(itemId, npcId) {
  const pending = ensurePendingNpcItems(npcId);
  if (itemId === "lock_detector") return Boolean(pending.lockDetectorUsed);
  if (itemId === "miracle_charm") return Boolean(pending.miracleCharmUsed);
  return false;
}

function getBattlePrepItemFlag(itemId) {
  if (itemId === "lock_detector") return "lockDetectorUsed";
  if (itemId === "miracle_charm") return "miracleCharmUsed";
  return null;
}

function toggleBattlePrepItem(itemId, npcId) {
  const item = SHOP_ITEM_BY_ID.get(itemId);
  if (!item) return { ok: false, message: "アイテムが見つかりません。" };
  const pending = ensurePendingNpcItems(npcId);
  const flag = getBattlePrepItemFlag(itemId);
  if (!flag) return { ok: false, message: "このアイテムは使用できません。" };

  const nextEnabled = !Boolean(pending[flag]);
  if (nextEnabled && getOwnedItemCount(itemId) <= 0) {
    return { ok: false, message: `${item.name}を所持していません。` };
  }

  pending[flag] = nextEnabled;
  return {
    ok: true,
    enabled: nextEnabled,
    message: `${item.name}を${nextEnabled ? "ON" : "OFF"}にしました。`
  };
}

function consumeOwnedBattleItem(itemId) {
  const owned = getOwnedItemCount(itemId);
  if (owned <= 0) return false;
  state.save.items[itemId] = owned - 1;
  return true;
}

function finalizeBattlePrepItems(pendingItems, lockCells) {
  const hasLockCell = Object.keys(lockCells ?? {}).length > 0;
  const result = {
    lockDetectorRequested: Boolean(pendingItems?.lockDetectorUsed),
    miracleCharmRequested: Boolean(pendingItems?.miracleCharmUsed),
    lockDetectorConsumed: false,
    miracleCharmConsumed: false,
    lockDetectorReturned: false
  };

  if (result.lockDetectorRequested) {
    if (hasLockCell) {
      result.lockDetectorConsumed = consumeOwnedBattleItem("lock_detector");
    } else {
      // ロックマスが存在しない対戦では消費しない。
      result.lockDetectorReturned = true;
    }
  }

  if (result.miracleCharmRequested) {
    result.miracleCharmConsumed = consumeOwnedBattleItem("miracle_charm");
  }

  if (result.lockDetectorConsumed || result.miracleCharmConsumed) save();
  return result;
}

function getTotalInAllDecks(cardId) {
  return (state.save?.decks ?? []).reduce((sum, deck) => sum + countInDeck(deck, cardId), 0);
}

function getCardNumericId(card) {
  const raw = String(card.cardNo ?? card.id ?? card.no ?? "");
  return Number(raw.replace(/\D/g, "")) || 0;
}

function getCardType(card) {
  if (card?.type) return String(card.type);
  const name = String(card?.name ?? "").trim();
  const match = name.match(/\](もな|美雨|凛花|百花)\s*$/);
  return match ? `${match[1]}タイプ` : "";
}

function getCardTypeMeta(card) {
  const type = getCardType(card);
  switch (type) {
    case "もなタイプ":
      return { key: "mona", label: "もな", longLabel: "もなタイプ", color: "#ff8fc4" };
    case "美雨タイプ":
      return { key: "miu", label: "美雨", longLabel: "美雨タイプ", color: "#f7f9ff" };
    case "凛花タイプ":
      return { key: "rinka", label: "凛花", longLabel: "凛花タイプ", color: "#b78cff" };
    case "百花タイプ":
      return { key: "momoka", label: "百花", longLabel: "百花タイプ", color: "#86dcff" };
    default:
      return { key: "none", label: "無", longLabel: "無属性", color: "#a3adbd" };
  }
}

function applyCardTypeStyle(element, card) {
  if (!element || !card) return;
  const meta = getCardTypeMeta(card);
  element.dataset.type = meta.key;
  element.style.setProperty("--card-type-color", meta.color);
}

function isBattleCardPopupEnabled() {
  return Boolean(state.save?.settings?.battleCardPopup);
}

function hasRule(ruleId, battle = state.battle) {
  return Boolean(battle?.rules?.includes(ruleId));
}

function getCardRawValue(card, side) {
  return Number(card?.battleValues?.[side] ?? card?.[side] ?? 0);
}

function cloneCardForBattle(card, battleMod = null) {
  if (!card) return card;
  if (!battleMod || typeof battleMod !== "object") return card;

  // v0.1.44以降は { values, changes } 形式。旧オンライン部屋の数値だけの形式にも対応する。
  const sourceValues = battleMod.values && typeof battleMod.values === "object"
    ? battleMod.values
    : battleMod;
  const cleanValues = Object.fromEntries(
    CARD_SIDES.map((side) => [side, clamp(Number(sourceValues[side] ?? card[side] ?? 0), 1, 10)])
  );
  const sourceChanges = battleMod.changes && typeof battleMod.changes === "object"
    ? battleMod.changes
    : {};
  const wildChanges = Object.fromEntries(
    CARD_SIDES
      .filter((side) => ["plus2", "ace", "one"].includes(sourceChanges[side]))
      .map((side) => [side, sourceChanges[side]])
  );

  return {
    ...card,
    battleValues: cleanValues,
    wildChanges,
    shuraChanges: card?.shuraChanges ? { ...card.shuraChanges } : undefined
  };
}

function generateWildCardMods(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return {};
  const index = Math.floor(Math.random() * cards.length);
  const card = cards[index];
  if (!card) return {};
  const values = Object.fromEntries(CARD_SIDES.map((side) => [side, getCardRawValue(card, side)]));
  const changes = {};

  if (Math.random() < 0.5) {
    const side = sample(CARD_SIDES, 1)[0];
    values[side] = clamp(values[side] + 2, 1, 10);
    // +2の結果Aになった場合も黄色表示にする。
    changes[side] = "plus2";
  } else {
    const sides = shuffle(CARD_SIDES);
    values[sides[0]] = 10;
    values[sides[1]] = 1;
    changes[sides[0]] = "ace";
    changes[sides[1]] = "one";
  }
  return { [index]: { values, changes } };
}

function applyWildCardModsToCards(cards, mods = {}) {
  return (cards ?? []).map((card, index) => cloneCardForBattle(card, mods?.[index] ?? mods?.[String(index)] ?? null));
}

function getWildChangeClass(card, side) {
  const change = card?.wildChanges?.[side];
  if (change === "plus2") return "wild-plus2";
  if (change === "ace") return "wild-ace";
  if (change === "one") return "wild-one";
  return "";
}


function getKaijutsuChangeClass(card, side) {
  return card?.kaijutsuChanges?.[side] ? "kaijutsu-value" : "";
}

function getWildValueColor(card, side) {
  const change = card?.wildChanges?.[side];
  if (change === "plus2") return 0xffdf4d;
  if (change === "ace") return 0x55aaff;
  if (change === "one") return 0xff5b5b;
  if (card?.kaijutsuChanges?.[side]) return 0xd9a7ff;
  if (isAwakeningEnhancedSide(card, side)) return 0xffd45c;
  return 0xffffff;
}

function isShuraNpc(npc) {
  return Boolean(npc?.isShura || npc?.difficulty === "修羅");
}

function isShuraEnhancedSide(card, side) {
  return Boolean(card?.shuraChanges?.[side]);
}

function applyShuraEnhancement(card) {
  if (!card) return card;
  const values = Object.fromEntries(CARD_SIDES.map((side) => [side, getCardRawValue(card, side)]));
  const changed = {};
  const rarity = Number(card.rarity ?? 0);

  if (rarity === 1) {
    // ★1：ランダムな1辺を+1（上限A）
    for (const side of sample(CARD_SIDES, 1)) {
      const before = values[side];
      values[side] = clamp(before + 1, 1, 10);
      if (values[side] !== before) changed[side] = true;
    }
  } else if (rarity === 2) {
    // ★2：重複しないランダムな2辺をそれぞれ+1（上限A）
    for (const side of sample(CARD_SIDES, 2)) {
      const before = values[side];
      values[side] = clamp(before + 1, 1, 10);
      if (values[side] !== before) changed[side] = true;
    }
  } else if (rarity === 3) {
    // ★3：重複しないランダムな3辺をそれぞれ+1（上限A）
    for (const side of sample(CARD_SIDES, 3)) {
      const before = values[side];
      values[side] = clamp(before + 1, 1, 10);
      if (values[side] !== before) changed[side] = true;
    }
  } else if (rarity === 4) {
    const candidates = CARD_SIDES.filter((side) => values[side] < 9);
    if (candidates.length) {
      const side = sample(candidates, 1)[0];
      values[side] = 9;
      changed[side] = true;
    }
  } else if (rarity >= 5) {
    const candidates = CARD_SIDES.filter((side) => values[side] < 10);
    if (candidates.length) {
      const side = sample(candidates, 1)[0];
      values[side] = 10;
      changed[side] = true;
    }
  }

  return {
    ...card,
    battleValues: values,
    shuraChanges: changed,
    isShuraCard: true
  };
}

function applyShuraEnhancementsToNpcHand(cards, npc) {
  if (!isShuraNpc(npc)) return cards;
  return (cards ?? []).map((card) => applyShuraEnhancement(card));
}

function setupWildCardForHands(playerCards, npcCards, battle = state.battle) {
  if (!hasRule("wild_card", battle)) {
    return { playerCards, npcCards, playerMods: {}, npcMods: {} };
  }
  const playerMods = generateWildCardMods(playerCards);
  const npcMods = generateWildCardMods(npcCards);
  return {
    playerCards: applyWildCardModsToCards(playerCards, playerMods),
    npcCards: applyWildCardModsToCards(npcCards, npcMods),
    playerMods,
    npcMods
  };
}


function applyKaijutsuToCard(card, skillId, options = {}) {
  if (!card || !NEXT_CARD_KAIJUTSU_IDS.has(skillId)) return card;
  const values = Object.fromEntries(CARD_SIDES.map((side) => [side, getCardRawValue(card, side)]));
  const changes = {};
  let rotation = null;
  let summary = "";
  const sideLabels = { up: "上", right: "右", down: "下", left: "左" };

  if (skillId === "curse_boost") {
    const side = CARD_SIDES.includes(options.side) ? options.side : "up";
    const before = values[side];
    values[side] = clamp(before + 1, 1, 10);
    changes[side] = true;
    summary = `${sideLabels[side]}${displayValue(before)}→${displayValue(values[side])}`;
  } else if (skillId === "right_rebirth") {
    rotation = "right";
    summary = "右へ90度回転";
  } else if (skillId === "left_rebirth") {
    rotation = "left";
    summary = "左へ90度回転";
  } else if (skillId === "blood_contract") {
    const plusSide = CARD_SIDES.includes(options.side) ? options.side : "up";
    const minusSide = sample(CARD_SIDES.filter((side) => side !== plusSide), 1)[0];
    const plusBefore = values[plusSide];
    const minusBefore = values[minusSide];
    values[plusSide] = clamp(plusBefore + 2, 1, 10);
    values[minusSide] = clamp(minusBefore - 2, 1, 10);
    changes[plusSide] = true;
    changes[minusSide] = true;
    summary = `${sideLabels[plusSide]}${displayValue(plusBefore)}→${displayValue(values[plusSide])} / ${sideLabels[minusSide]}${displayValue(minusBefore)}→${displayValue(values[minusSide])}`;
  } else if (skillId === "ominous_number") {
    const minValue = Math.min(...CARD_SIDES.map((side) => values[side]));
    const minSide = sample(CARD_SIDES.filter((side) => values[side] === minValue), 1)[0];
    const remainingSides = CARD_SIDES.filter((side) => side !== minSide);
    const maxValue = Math.max(...remainingSides.map((side) => values[side]));
    const maxSide = sample(remainingSides.filter((side) => values[side] === maxValue), 1)[0];
    const minBefore = values[minSide];
    const maxBefore = values[maxSide];
    values[minSide] = 10;
    values[maxSide] = 1;
    changes[minSide] = true;
    changes[maxSide] = true;
    summary = `${sideLabels[minSide]}${displayValue(minBefore)}→A / ${sideLabels[maxSide]}${displayValue(maxBefore)}→1`;
  }

  return {
    ...card,
    battleValues: values,
    kaijutsuSkillId: skillId,
    kaijutsuChanges: changes,
    skillRotation: rotation,
    kaijutsuSummary: summary
  };
}

function getRotationSourceSide(side, rotation) {
  if (rotation === "right") {
    return { up: "left", right: "up", down: "right", left: "down" }[side] ?? side;
  }
  if (rotation === "left") {
    return { up: "right", right: "down", down: "left", left: "up" }[side] ?? side;
  }
  return side;
}

function getMirrorSide(side, battle = state.battle, boardIndex = null) {
  if (!Number.isInteger(boardIndex) || !hasRule("mirror", battle)) return side;
  if (side === "up") return "down";
  if (side === "down") return "up";
  if (side === "left") return "right";
  if (side === "right") return "left";
  return side;
}

function getFieldEffectAt(index, battle = state.battle) {
  if (!Number.isInteger(index)) return 0;
  const effects = battle?.fieldEffects ?? {};
  return Number(effects[index] ?? effects[String(index)] ?? 0) || 0;
}

function createFieldEffectsForBattle(npc) {
  if (!npc || !["つよい", "修羅"].includes(npc.difficulty)) return {};
  const indexes = shuffle(Array.from({ length: 9 }, (_, index) => index)).slice(0, 1 + Math.floor(Math.random() * 3));
  const values = [-2, -1, 1, 2];
  return Object.fromEntries(indexes.map((index) => [index, values[Math.floor(Math.random() * values.length)]]));
}

function createLockCellsForBattle(npc) {
  if (!npc || !["ふつう", "つよい", "修羅"].includes(npc.difficulty)) return {};
  const count = Math.random() < 0.5 ? 0 : 1;
  if (!count) return {};
  const index = Math.floor(Math.random() * 9);
  return { [index]: true };
}

function isLockCell(index, battle = state.battle) {
  if (!Number.isInteger(index)) return false;
  const cells = battle?.lockCells ?? {};
  return Boolean(cells[index] ?? cells[String(index)]);
}

function isCardLockedAt(board, index) {
  const cell = Array.isArray(board) ? board[index] : null;
  return Boolean(cell?.locked);
}

function getTypeRuleLevel(card, battle = state.battle, board = null, boardIndex = null) {
  const type = getCardType(card);
  if (!type || !battle || (!hasRule("type_ascend", battle) && !hasRule("type_descend", battle))) return 0;
  if (!Number.isInteger(boardIndex)) return 0;
  const targetBoard = Array.isArray(board) ? board : Array.isArray(battle.board) ? battle.board : [];
  const sameTypeCount = targetBoard.filter((cell) => cell?.card && getCardType(cell.card) === type).length;
  // 1枚目は変化なし。2枚目で±1、3枚目で±2のように、場の同属性枚数から補正値を決める。
  return Math.max(0, sameTypeCount - 1);
}

function getEffectiveCardValue(card, side, battle = state.battle, board = null, boardIndex = null) {
  const rotatedSide = getRotationSourceSide(side, card?.skillRotation);
  const baseSide = getMirrorSide(rotatedSide, battle, boardIndex);
  let value = getCardRawValue(card, baseSide);

  // フィールド効果は、実際に場に置かれているカードだけに適用する。
  if (Number.isInteger(boardIndex)) {
    value += getFieldEffectAt(boardIndex, battle);
  }

  const level = getTypeRuleLevel(card, battle, board, boardIndex);
  if (level > 0) {
    if (hasRule("type_ascend", battle)) value += level;
    if (hasRule("type_descend", battle)) value -= level;
  }
  return clamp(value, 1, 10);
}

function getCardValueSet(card, battle = state.battle, board = null, boardIndex = null) {
  return {
    up: getEffectiveCardValue(card, "up", battle, board, boardIndex),
    right: getEffectiveCardValue(card, "right", battle, board, boardIndex),
    down: getEffectiveCardValue(card, "down", battle, board, boardIndex),
    left: getEffectiveCardValue(card, "left", battle, board, boardIndex)
  };
}

function getAiCardPower(card, battle = state.battle, board = null, boardIndex = null) {
  const values = getCardValueSet(card, battle, board, boardIndex);
  const total = values.up + values.right + values.down + values.left;
  // リバースでは小さい数字ほど強いため、AI評価も反転させる。
  return hasRule("reverse", battle) ? 44 - total : total;
}

function sideBeats(attackerValue, defenderValue, battle = state.battle) {
  if (hasRule("reverse", battle)) {
    return attackerValue < defenderValue;
  }

  if (hasRule("ace_killer", battle)) {
    if (attackerValue === 1 && defenderValue === 10) return true;
    if (attackerValue === 10 && defenderValue === 1) return false;
  }

  return attackerValue > defenderValue;
}

function getCardImagePath(card) {
  return `assets/cards/${card.id}.webp`;
}

function cardArtHtml(card) {
  return `
    <div class="card-art-wrap">
      <img
        class="card-art"
        src="${getCardImagePath(card)}"
        alt="${escapeHtml(card.name)}"
        loading="lazy"
        onerror="this.closest('.card-art-wrap')?.classList.add('missing'); this.remove();"
      >
    </div>
  `;
}

function getNpcNumber(npc) {
  return Number(String(npc.id).replace(/\D/g, "")) || 1;
}

function hasDefeatedNpc(npcNumber) {
  const id = `npc_${String(npcNumber).padStart(3, "0")}`;
  return Number(state.save?.npcWins?.[id] ?? 0) > 0;
}

function isNpcUnlocked(npc) {
  const number = getNpcNumber(npc);
  if (number <= 15) {
    if (number <= 2) return true;
    if (number >= 3 && number <= 6) return hasDefeatedNpc(2);
    if (number >= 7 && number <= 10) return [3, 4, 5, 6].every(hasDefeatedNpc);
    if (number >= 11 && number <= 14) return [7, 8, 9, 10].every(hasDefeatedNpc);
    if (number === 15) return [11, 12, 13, 14].every(hasDefeatedNpc);
    return false;
  }

  if (number <= 17) return true;
  if (number >= 18 && number <= 21) return [16, 17].every(hasDefeatedNpc);
  if (number >= 22 && number <= 25) return [18, 19, 20, 21].every(hasDefeatedNpc);
  if (number >= 26 && number <= 29) return [22, 23, 24, 25].every(hasDefeatedNpc);
  if (number === 30) return [26, 27, 28, 29].every(hasDefeatedNpc);
  return false;
}

function getNpcUnlockMessage() {
  if (state.npcListMode === "shura") {
    if (![16, 17].every(hasDefeatedNpc)) return "修羅NPC16・17に勝利すると修羅NPC18〜21が解放されます。";
    if (![18, 19, 20, 21].every(hasDefeatedNpc)) return "修羅NPC18〜21全員に勝利すると修羅NPC22〜25が解放されます。";
    if (![22, 23, 24, 25].every(hasDefeatedNpc)) return "修羅NPC22〜25全員に勝利すると修羅NPC26〜29が解放されます。";
    if (![26, 27, 28, 29].every(hasDefeatedNpc)) return "修羅NPC26〜29全員に勝利すると修羅NPC30が解放されます。";
    return "修羅モードのすべての対戦相手が解放されています。";
  }
  if (!hasDefeatedNpc(2)) return "NPC2に勝利するとNPC3〜6が解放されます。";
  if (![3, 4, 5, 6].every(hasDefeatedNpc)) return "NPC3〜6全員に勝利するとNPC7〜10が解放されます。";
  if (![7, 8, 9, 10].every(hasDefeatedNpc)) return "NPC7〜10全員に勝利するとNPC11〜14が解放されます。";
  if (![11, 12, 13, 14].every(hasDefeatedNpc)) return "NPC11〜14全員に勝利するとNPC15が解放されます。";
  return "通常モードのすべての対戦相手が解放されています。";
}

function getRareChanceRate(npc) {
  return Number.isFinite(npc?.rareChanceRate) ? npc.rareChanceRate : getNpcNumber(npc);
}

function getRareChanceMaxRarity(npc) {
  if (Array.isArray(npc?.rareChanceRarities) && npc.rareChanceRarities.length) {
    return Math.max(...npc.rareChanceRarities.map(Number));
  }
  if (Number.isFinite(npc?.rareChanceMaxRarity)) return npc.rareChanceMaxRarity;
  if (npc.difficulty === "よわい") return 3;
  if (npc.difficulty === "ふつう") return 4;
  return 5;
}

function getRareChanceLabel(npc) {
  if (npc?.rareChanceLabel) return npc.rareChanceLabel;
  return `上限${rarityStars(getRareChanceMaxRarity(npc))}`;
}

function getNpcEntryFee(npc) {
  return Number.isFinite(npc?.entryFee) ? Number(npc.entryFee) : 0;
}

function getNpcWinMoney(npc) {
  if (Number.isFinite(npc?.winMoney)) return Number(npc.winMoney);
  const fee = getNpcEntryFee(npc);
  return fee === 0 ? 100 : fee * 2;
}

function getRewardWeights(npc, battle = state.battle) {
  const number = Number(npc?.baseNpcNumber ?? getNpcNumber(npc));
  let base;
  if (number >= 1 && number <= 6) base = { random_one: 80, choose_one: 17, rare_chance: 3 };
  else if (number >= 7 && number <= 10) base = { random_one: 80, choose_one: 15, rare_chance: 5 };
  else if (number >= 11 && number <= 14) base = { random_one: 72, choose_one: 20, rare_chance: 8 };
  else if (number === 15) base = { random_one: 70, choose_one: 20, rare_chance: 10 };
  else {
    const rare = Math.min(Math.max(getRareChanceRate(npc), 0), 20);
    base = { random_one: Math.max(0, 20 - rare), choose_one: 80, rare_chance: rare };
  }

  // 修羅は元NPCの配分を基準にしつつ、指定された2倍のレアチャンス率を反映する。
  const configuredRare = Math.min(100 - base.choose_one, Math.max(0, getRareChanceRate(npc)));
  base = {
    random_one: Math.max(0, 100 - base.choose_one - configuredRare),
    choose_one: base.choose_one,
    rare_chance: configuredRare
  };

  const multiplier = Math.max(1, Number(battle?.rareChanceMultiplier ?? 1));
  if (multiplier <= 1) return base;
  const rare = Math.min(100 - base.choose_one, base.rare_chance * multiplier);
  return {
    random_one: Math.max(0, 100 - base.choose_one - rare),
    choose_one: base.choose_one,
    rare_chance: rare
  };
}

function shuffle(array) {
  const copied = [...array];
  for (let i = copied.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copied[i], copied[j]] = [copied[j], copied[i]];
  }
  return copied;
}

function sample(array, count) {
  return shuffle(array).slice(0, count);
}

function showScreen(name) {
  Object.values(screens).forEach((screen) => screen?.classList.remove("active"));
  screens[name].classList.add("active");
  document.body.classList.toggle("is-battle-screen", name === "battle");
  document.documentElement.classList.toggle("is-battle-screen", name === "battle");
  $("backTitleBtn").style.visibility = name === "title" ? "hidden" : "visible";
  updateMoneyDisplays();
  if (name === "battle") scheduleBattleAutoFit();

  if (name === "onlineBattle") renderOnlineBattleScreen();
  if (name === "deck") renderDeckScreen();
  if (name === "cardEnhance") renderCardEnhanceScreen();
  if (name === "shop") enterShop();
  if (name === "collection") renderCollectionScreen();
  if (name === "rankings") renderRankingScreen();
  if (name === "settings") renderSettingsScreen();
  if (name === "battleMenu") renderNpcList();
}

function createInitialSave() {
  const starterNos = Array.from({ length: 18 }, (_, i) => String(i + 1));
  const starterCards = starterNos
    .map((no) => CARDS.find((card) => String(card.cardNo ?? card.no) === no))
    .filter(Boolean);

  const ownedCards = {};
  for (const card of starterCards) {
    ownedCards[card.id] = 1;
  }

  const firstDeck = starterCards.slice(0, 5).map((card) => card.id);

  return {
    version: VERSION,
    activeDeckIndex: 0,
    selectedDeckIndex: 0,
    ownedCards,
    discoveredCards: Object.fromEntries(starterCards.map((card) => [card.id, true])),
    decks: [firstDeck, [], [], [], [], [...firstDeck], [...firstDeck], [...firstDeck]],
    deckNames: Array.from({ length: TOTAL_DECK_COUNT }, (_, index) => getDeckDefaultName(index)),
    npcWins: {},
    money: 100,
    totalEarnedMoney: 0,
    shopPurchaseTotal: 0,
    kaikiResidue: 0,
    awakenings: {},
    unlockedKaijutsu: {},
    deckKaijutsu: Array.from({ length: TOTAL_DECK_COUNT }, () => "none"),
    items: {
      lock_detector: 0,
      miracle_charm: 0
    },
    settings: {
      effects: true,
      ownedCardView: "vertical",
      battleCardPopup: true,
      onlineUserName: "",
      onlineUserNameKey: ""
    }
  };
}

function createDefaultLittleDeck() {
  return ["1", "2", "3", "4", "5"]
    .map((no) => CARDS.find((card) => String(card.cardNo ?? card.no) === no)?.id)
    .filter(Boolean);
}


function normalizeSave(save) {
  const fresh = createInitialSave();
  const normalized = {
    ...fresh,
    ...save,
    settings: {
      ...fresh.settings,
      ...(save?.settings ?? {})
    }
  };

  const defaultLittleDeck = createDefaultLittleDeck();
  normalized.decks = Array.from({ length: TOTAL_DECK_COUNT }, (_, index) => {
    const deck = Array.isArray(save?.decks?.[index]) ? save.decks[index] : [];
    const normalizedDeck = deck.filter((cardId) => cardById.has(cardId)).slice(0, 5);
    if (isLittleDeckIndex(index) && normalizedDeck.length === 0) {
      return [...defaultLittleDeck];
    }
    return normalizedDeck;
  });

  normalized.ownedCards = normalized.ownedCards ?? {};
  normalized.discoveredCards = normalized.discoveredCards ?? {};
  normalized.npcWins = normalized.npcWins ?? {};
  normalized.deckNames = Array.from({ length: TOTAL_DECK_COUNT }, (_, index) => {
    const name = Array.isArray(save?.deckNames) ? String(save.deckNames[index] ?? "").trim() : "";
    return name || getDeckDefaultName(index);
  });
  normalized.shopPurchaseTotal = Number.isFinite(Number(normalized.shopPurchaseTotal)) ? Number(normalized.shopPurchaseTotal) : 0;
  normalized.totalEarnedMoney = Number.isFinite(Number(normalized.totalEarnedMoney)) ? Number(normalized.totalEarnedMoney) : 0;
  normalized.items = { ...fresh.items, ...(save?.items ?? {}) };
  for (const item of SHOP_ITEMS) {
    const count = Math.floor(Number(normalized.items[item.id] ?? 0));
    normalized.items[item.id] = Math.min(item.maxOwned, Math.max(0, Number.isFinite(count) ? count : 0));
  }
  normalized.kaikiResidue = Math.max(0, Math.floor(Number(normalized.kaikiResidue ?? 0) || 0));
  normalized.awakenings = normalizeAwakeningSave(normalized.awakenings);
  normalized.unlockedKaijutsu = { ...(save?.unlockedKaijutsu ?? {}) };
  unlockKaijutsuForSave(normalized);
  normalized.deckKaijutsu = Array.from({ length: TOTAL_DECK_COUNT }, (_, index) => {
    const skillId = String(save?.deckKaijutsu?.[index] ?? "none");
    return KAIJUTSU_BY_ID.has(skillId) && (skillId === "none" || normalized.unlockedKaijutsu[skillId]) ? skillId : "none";
  });
  normalized.activeDeckIndex = Number.isInteger(normalized.activeDeckIndex) ? Math.min(Math.max(normalized.activeDeckIndex, 0), NORMAL_DECK_COUNT - 1) : 0;
  normalized.selectedDeckIndex = Number.isInteger(normalized.selectedDeckIndex) ? Math.min(Math.max(normalized.selectedDeckIndex, 0), TOTAL_DECK_COUNT - 1) : 0;

  return normalized;
}


function normalizeAwakeningSave(source) {
  const normalized = {};
  if (!source || typeof source !== "object") return normalized;
  for (const [cardId, value] of Object.entries(source)) {
    const card = cardById.get(cardId);
    if (!card || Number(card.rarity) < 4) continue;
    const stage = clamp(Math.floor(Number(value?.stage ?? 0) || 0), 0, 3);
    const boosts = Object.fromEntries(CARD_SIDES.map((side) => [side, 0]));
    let remaining = stage;
    for (const side of CARD_SIDES) {
      if (remaining <= 0) break;
      const maxForSide = Math.max(0, 10 - Number(card[side] ?? 0));
      const requested = Math.max(0, Math.floor(Number(value?.boosts?.[side] ?? 0) || 0));
      const accepted = Math.min(requested, maxForSide, remaining);
      boosts[side] = accepted;
      remaining -= accepted;
    }
    if (stage > 0) normalized[cardId] = { stage, boosts };
  }
  return normalized;
}

function getAwakeningRecord(cardId) {
  const card = cardById.get(cardId);
  const source = state.save?.awakenings?.[cardId];
  const stage = clamp(Math.floor(Number(source?.stage ?? 0) || 0), 0, 3);
  const boosts = Object.fromEntries(CARD_SIDES.map((side) => {
    const maxForSide = Math.max(0, 10 - Number(card?.[side] ?? 0));
    return [side, Math.min(maxForSide, Math.max(0, Math.floor(Number(source?.boosts?.[side] ?? 0) || 0)))];
  }));
  return { stage, boosts };
}

function getAwakeningStageName(stage) {
  return AWAKENING_STAGE_BY_NUMBER.get(Number(stage))?.name ?? "未覚醒";
}

function getAwakeningAllocatedPoints(cardId) {
  const record = getAwakeningRecord(cardId);
  return CARD_SIDES.reduce((sum, side) => sum + Number(record.boosts[side] ?? 0), 0);
}

function getAwakeningUnspentPoints(cardId) {
  const record = getAwakeningRecord(cardId);
  return Math.max(0, Number(record.stage) - getAwakeningAllocatedPoints(cardId));
}

function isAwakeningEnhancedSide(card, side) {
  return Number(card?.awakeningChanges?.[side] ?? 0) > 0;
}

function getAwakeningChangeClass(card, side) {
  return isAwakeningEnhancedSide(card, side) ? "awakening-value" : "";
}

function applyAwakeningToCard(card) {
  if (!card || Number(card.rarity) < 4) return card;
  const record = getAwakeningRecord(card.id);
  if (record.stage <= 0) return card;
  const originalValues = Object.fromEntries(CARD_SIDES.map((side) => [side, Number(card[side] ?? 0)]));
  const values = Object.fromEntries(CARD_SIDES.map((side) => [side, clamp(originalValues[side] + Number(record.boosts[side] ?? 0), 1, 10)]));
  const changes = Object.fromEntries(CARD_SIDES.filter((side) => Number(record.boosts[side] ?? 0) > 0).map((side) => [side, Number(record.boosts[side])]));
  return {
    ...card,
    battleValues: values,
    awakeningChanges: changes,
    awakeningStage: record.stage,
    awakeningOriginalValues: originalValues,
    isAwakenedCard: true
  };
}

function getMaxDeckCopies(cardId) {
  return Math.max(0, ...(state.save?.decks ?? []).map((deck) => Array.isArray(deck) ? countInDeck(deck, cardId) : 0));
}

function getProtectedOwnedCount(cardId) {
  return Math.max(1, getMaxDeckCopies(cardId));
}

function getConvertibleDuplicateCount(cardId) {
  const card = cardById.get(cardId);
  if (!card || Number(card.rarity) > 3) return 0;
  return Math.max(0, getOwnedCount(cardId) - getProtectedOwnedCount(cardId));
}

function getAwakeningMaterialCopies(cardId) {
  const card = cardById.get(cardId);
  if (!card || Number(card.rarity) < 4) return 0;
  return Math.max(0, getOwnedCount(cardId) - getProtectedOwnedCount(cardId));
}

function setEnhancementView(view) {
  state.enhancementView = view === "residue" ? "residue" : "awakening";
  renderCardEnhanceScreen();
}

function enhancementCardValuesHtml(card, original = false) {
  const values = original
    ? Object.fromEntries(CARD_SIDES.map((side) => [side, Number(card?.awakeningOriginalValues?.[side] ?? cardById.get(card.id)?.[side] ?? card[side] ?? 0)]))
    : Object.fromEntries(CARD_SIDES.map((side) => [side, getCardRawValue(card, side)]));
  return `上${displayValue(values.up)} / 右${displayValue(values.right)} / 下${displayValue(values.down)} / 左${displayValue(values.left)}`;
}

function renderCardEnhanceScreen() {
  const residue = Math.max(0, Number(state.save?.kaikiResidue ?? 0));
  if ($("kaikiResidueCount")) $("kaikiResidueCount").textContent = residue.toLocaleString("ja-JP");
  const awakeningActive = state.enhancementView !== "residue";
  $("awakeningSection")?.classList.toggle("hidden", !awakeningActive);
  $("residueSection")?.classList.toggle("hidden", awakeningActive);
  $("showAwakeningMenu")?.classList.toggle("active", awakeningActive);
  $("showAwakeningMenu")?.classList.toggle("ghost", !awakeningActive);
  $("showResidueMenu")?.classList.toggle("active", !awakeningActive);
  $("showResidueMenu")?.classList.toggle("ghost", awakeningActive);
  if (awakeningActive) renderAwakeningMenu();
  else renderResidueMenu();
}

function renderAwakeningMenu() {
  const list = $("awakeningCardList");
  const detail = $("awakeningDetail");
  if (!list || !detail) return;
  const cards = CARDS.filter((card) => Number(card.rarity) >= 4 && getOwnedCount(card.id) > 0)
    .sort((a, b) => Number(b.rarity) - Number(a.rarity) || Number(a.no) - Number(b.no));
  if (!cards.length) {
    list.innerHTML = `<p class="muted">覚醒できる★4・★5カードを所持していません。</p>`;
    detail.innerHTML = `<p class="muted">カードを入手するとここに表示されます。</p>`;
    state.selectedAwakeningCardId = null;
    return;
  }
  if (!cards.some((card) => card.id === state.selectedAwakeningCardId)) state.selectedAwakeningCardId = cards[0].id;
  list.innerHTML = "";
  for (const baseCard of cards) {
    const card = applyAwakeningToCard(baseCard);
    const record = getAwakeningRecord(baseCard.id);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `enhancement-card-entry ${baseCard.id === state.selectedAwakeningCardId ? "selected" : ""}`;
    row.innerHTML = `
      <div class="enhancement-card-thumb">${cardMiniHtml(card, "", { squareArt: true, showName: false })}</div>
      <div><strong>${escapeHtml(baseCard.name)}</strong><br><small>No.${escapeHtml(baseCard.no)} / ${rarityStars(baseCard.rarity)} / 所持 ${getOwnedCount(baseCard.id)}</small><br><span class="awakening-stage-label">${getAwakeningStageName(record.stage)}</span></div>
    `;
    row.addEventListener("click", () => {
      state.selectedAwakeningCardId = baseCard.id;
      renderAwakeningMenu();
    });
    list.appendChild(row);
  }
  renderAwakeningDetail(state.selectedAwakeningCardId);
}

function renderAwakeningDetail(cardId) {
  const detail = $("awakeningDetail");
  const baseCard = cardById.get(cardId);
  if (!detail || !baseCard) return;
  const card = applyAwakeningToCard(baseCard);
  const record = getAwakeningRecord(cardId);
  const unspent = getAwakeningUnspentPoints(cardId);
  const next = AWAKENING_STAGE_BY_NUMBER.get(record.stage + 1);
  const nextResidue = getAwakeningResidueCost(baseCard, next);
  const duplicateCopies = getAwakeningMaterialCopies(cardId);
  const residue = Number(state.save.kaikiResidue ?? 0);
  const canAwaken = next && duplicateCopies >= next.copies && residue >= nextResidue;
  const allocated = getAwakeningAllocatedPoints(cardId);
  detail.className = "awakening-detail";
  detail.innerHTML = `
    <div class="awakening-detail-card mini-card">${cardMiniHtml(card, "", { squareArt: true, detail: true })}</div>
    <h3>${escapeHtml(baseCard.name)}</h3>
    <p><strong>覚醒段階：</strong>${getAwakeningStageName(record.stage)}</p>
    <p><strong>元の数値：</strong>${enhancementCardValuesHtml(card, true)}</p>
    <p><strong>覚醒後：</strong><span class="gold-text">${enhancementCardValuesHtml(card, false)}</span></p>
    <p><strong>割り振り済み：</strong>${allocated} / ${record.stage}　<strong>割り振り可能：</strong>${unspent}</p>
    <div class="awakening-side-buttons">
      ${CARD_SIDES.map((side) => {
        const labels = { up: "上", right: "右", down: "下", left: "左" };
        const current = getCardRawValue(card, side);
        return `<button type="button" data-awakening-side="${side}" ${unspent <= 0 || current >= 10 ? "disabled" : ""}>${labels[side]} +1</button>`;
      }).join("")}
    </div>
    <p class="muted">同じ辺を複数回強化できます。割り振り可能な数値は残したままでも構いません。上限はAです。</p>
    <div class="awakening-actions">
      ${next ? `<button id="performAwakening" type="button" ${canAwaken ? "" : "disabled"}>${next.name}へ覚醒</button>` : `<button type="button" disabled>参ノ怪まで覚醒済み</button>`}
      <button id="rerollAwakening" type="button" class="ghost" ${record.stage > 0 && allocated > 0 && residue >= 100 ? "" : "disabled"}>数値を振り直す（残滓100）</button>
    </div>
    ${next ? `<div class="awakening-requirements"><strong>${next.name}の必要条件</strong><br>同一カード ${next.copies}枚（使用可能 ${duplicateCopies}枚）<br>怪異の残滓 ${nextResidue}（所持 ${residue.toLocaleString("ja-JP")}）</div>` : ""}
  `;
  detail.querySelectorAll("[data-awakening-side]").forEach((button) => {
    button.addEventListener("click", () => allocateAwakeningPoint(cardId, button.dataset.awakeningSide));
  });
  detail.querySelector("#performAwakening")?.addEventListener("click", () => confirmAwakening(cardId));
  detail.querySelector("#rerollAwakening")?.addEventListener("click", () => confirmAwakeningReroll(cardId));
}

function allocateAwakeningPoint(cardId, side) {
  if (!CARD_SIDES.includes(side)) return;
  const card = cardById.get(cardId);
  const record = getAwakeningRecord(cardId);
  if (!card || getAwakeningUnspentPoints(cardId) <= 0) return;
  const current = Number(card[side] ?? 0) + Number(record.boosts[side] ?? 0);
  if (current >= 10) return;
  record.boosts[side] = Number(record.boosts[side] ?? 0) + 1;
  state.save.awakenings[cardId] = record;
  save();
  renderCardEnhanceScreen();
}

function confirmAwakening(cardId) {
  const card = cardById.get(cardId);
  const record = getAwakeningRecord(cardId);
  const next = AWAKENING_STAGE_BY_NUMBER.get(record.stage + 1);
  if (!card || !next) return;
  const nextResidue = getAwakeningResidueCost(card, next);
  const available = getAwakeningMaterialCopies(cardId);
  const residue = Number(state.save.kaikiResidue ?? 0);
  if (available < next.copies || residue < nextResidue) {
    showModal("怪忌蝶覚醒", `<p>覚醒素材が足りません。</p><p>同一カード：${available}/${next.copies}枚<br>怪異の残滓：${residue}/${nextResidue}</p>`, [{ label: "閉じる", onClick: closeModal }]);
    return;
  }
  showModal("怪忌蝶覚醒", `<p>「${escapeHtml(card.name)}」を<strong>${next.name}</strong>へ覚醒します。</p><p>同一カード${next.copies}枚と怪異の残滓${nextResidue}を消費します。</p>`, [
    {
      label: "覚醒する",
      onClick: () => {
        state.save.ownedCards[cardId] = getOwnedCount(cardId) - next.copies;
        state.save.kaikiResidue = residue - nextResidue;
        state.save.awakenings[cardId] = { stage: next.stage, boosts: { ...record.boosts } };
        save();
        closeModal();
        renderCardEnhanceScreen();
      }
    },
    { label: "キャンセル", className: "ghost", onClick: closeModal }
  ]);
}

function confirmAwakeningReroll(cardId) {
  const card = cardById.get(cardId);
  const record = getAwakeningRecord(cardId);
  if (!card || record.stage <= 0) return;
  if (Number(state.save.kaikiResidue ?? 0) < 100) {
    showModal("数値の振り直し", "<p>怪異の残滓が足りません。</p>", [{ label: "閉じる", onClick: closeModal }]);
    return;
  }
  showModal("数値の振り直し", `<p>怪異の残滓を100消費し、「${escapeHtml(card.name)}」の数値割り振りをすべて解除します。</p><p>解除された${record.stage}ポイントは、再び好きな辺へ割り振れます。</p>`, [
    {
      label: "振り直す",
      onClick: () => {
        state.save.kaikiResidue = Number(state.save.kaikiResidue ?? 0) - 100;
        state.save.awakenings[cardId] = { stage: record.stage, boosts: Object.fromEntries(CARD_SIDES.map((side) => [side, 0])) };
        save();
        closeModal();
        renderCardEnhanceScreen();
      }
    },
    { label: "キャンセル", className: "ghost", onClick: closeModal }
  ]);
}

function buildResidueConversion(maxRarity, singleCardId = null) {
  const entries = [];
  for (const card of CARDS) {
    if (Number(card.rarity) > Number(maxRarity) || Number(card.rarity) > 3) continue;
    if (singleCardId && card.id !== singleCardId) continue;
    const count = singleCardId ? Math.min(1, getConvertibleDuplicateCount(card.id)) : getConvertibleDuplicateCount(card.id);
    if (count <= 0) continue;
    const unit = Number(RESIDUE_VALUE_BY_RARITY[card.rarity] ?? 0);
    entries.push({ card, count, points: count * unit });
  }
  return entries;
}

function confirmResidueConversion(entries) {
  const valid = (entries ?? []).filter((entry) => entry.count > 0 && getConvertibleDuplicateCount(entry.card.id) >= entry.count);
  const totalCards = valid.reduce((sum, entry) => sum + entry.count, 0);
  const totalPoints = valid.reduce((sum, entry) => sum + entry.points, 0);
  if (!totalCards) {
    showModal("怪異の残滓", "<p>素材化できる重複カードがありません。</p>", [{ label: "閉じる", onClick: closeModal }]);
    return;
  }
  showModal("怪異の残滓化", `<p><strong>${totalCards}枚のカードを怪異の残滓にします。獲得できる怪異の残滓は${totalPoints}です。</strong></p>`, [
    {
      label: "決定",
      onClick: () => {
        for (const entry of valid) state.save.ownedCards[entry.card.id] = getOwnedCount(entry.card.id) - entry.count;
        state.save.kaikiResidue = Number(state.save.kaikiResidue ?? 0) + totalPoints;
        save();
        closeModal();
        renderCardEnhanceScreen();
        const message = $("residueMessage");
        if (message) message.textContent = `${totalCards}枚を素材化し、怪異の残滓${totalPoints}を獲得しました。`;
      }
    },
    { label: "キャンセル", className: "ghost", onClick: closeModal }
  ]);
}

function renderResidueMenu() {
  const list = $("residueCardList");
  if (!list) return;
  const cards = CARDS.filter((card) => Number(card.rarity) <= 3 && getConvertibleDuplicateCount(card.id) > 0)
    .sort((a, b) => Number(a.rarity) - Number(b.rarity) || Number(a.no) - Number(b.no));
  list.innerHTML = "";
  if (!cards.length) {
    list.innerHTML = `<p class="muted">怪異の残滓にできる重複カードはありません。</p>`;
    return;
  }
  for (const card of cards) {
    const available = getConvertibleDuplicateCount(card.id);
    const unit = RESIDUE_VALUE_BY_RARITY[card.rarity];
    const row = document.createElement("div");
    row.className = "residue-card-row";
    row.innerHTML = `
      <div class="residue-card-thumb">${cardMiniHtml(card, "", { squareArt: true, showName: false })}</div>
      <div class="residue-card-info"><strong>${escapeHtml(card.name)}</strong><br><small>${rarityStars(card.rarity)} / 所持 ${getOwnedCount(card.id)} / 素材化可能 ${available}</small><br><span>1枚につき怪異の残滓 ${unit}</span></div>
      <button type="button">1枚を残滓化</button>
    `;
    row.querySelector("button").addEventListener("click", () => confirmResidueConversion(buildResidueConversion(card.rarity, card.id)));
    list.appendChild(row);
  }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    state.save = raw ? normalizeSave(JSON.parse(raw)) : createInitialSave();
  } catch (error) {
    console.error(error);
    state.save = createInitialSave();
  }
  state.selectedDeckIndex = state.save.selectedDeckIndex ?? 0;
  state.ownedCardView = normalizeOwnedCardView(state.save.settings.ownedCardView);
  state.save.settings.ownedCardView = state.ownedCardView;
  if (!Number.isFinite(Number(state.save.money))) state.save.money = 100;
  save();
  updateMoneyDisplays();
}

function save() {
  state.save.version = VERSION;
  state.save.selectedDeckIndex = state.selectedDeckIndex;
  localStorage.setItem(SAVE_KEY, JSON.stringify(state.save));
}

function addMoney(amount) {
  state.save.money = Math.max(0, Number(state.save.money ?? 0) + Number(amount ?? 0));
  save();
  updateMoneyDisplays();
}

function addTotalEarnedMoney(amount) {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value) || value <= 0) return;
  state.save.totalEarnedMoney = Number(state.save.totalEarnedMoney ?? 0) + value;
  save();
}

function spendMoney(amount) {
  const cost = Number(amount ?? 0);
  if (Number(state.save.money ?? 0) < cost) return false;
  state.save.money = Number(state.save.money ?? 0) - cost;
  save();
  updateMoneyDisplays();
  return true;
}

function addOwnedCard(cardId, count = 1) {
  state.save.ownedCards[cardId] = (state.save.ownedCards[cardId] ?? 0) + count;
  state.save.discoveredCards[cardId] = true;
  const newlyUnlocked = unlockKaijutsuForSave(state.save);
  if (newlyUnlocked.length) state.pendingKaijutsuUnlocks.push(...newlyUnlocked);
  save();
}

function getOwnedCount(cardId) {
  return state.save.ownedCards[cardId] ?? 0;
}

function countInDeck(deck, cardId) {
  return deck.filter((id) => id === cardId).length;
}

function validateDeck(deck, options = {}) {
  const maxRarity = options.maxRarity ?? null;
  const deckLabel = options.deckLabel ?? "デッキ";
  const cards = deck.map((id) => cardById.get(id)).filter(Boolean);
  const star5 = cards.filter((card) => card.rarity === 5).length;
  const star4 = cards.filter((card) => card.rarity === 4).length;

  for (const card of cards) {
    if (countInDeck(deck, card.id) > getOwnedCount(card.id)) {
      return `「${card.name}」の所持数が足りません。`;
    }
    if (maxRarity && card.rarity > maxRarity) {
      return `${deckLabel}には${rarityStars(maxRarity)}までのカードだけ登録できます。`;
    }
  }

  if (deck.length !== 5) return "デッキは5枚必要です。";
  if (!maxRarity) {
    if (star5 > 1) return "★5は1枚までです。";
    if (star4 > 2) return "★4は2枚までです。";
  }
  return "";
}

function canAddToDeck(deck, cardId, options = {}) {
  const card = cardById.get(cardId);
  const maxRarity = options.maxRarity ?? null;
  const deckLabel = options.deckLabel ?? "デッキ";
  if (!card) return "カードが見つかりません。";
  if (deck.length >= 5) return "デッキは5枚までです。";
  if (countInDeck(deck, cardId) >= getOwnedCount(cardId)) return "所持数を超えて追加できません。";
  if (maxRarity && card.rarity > maxRarity) return `${deckLabel}には${rarityStars(maxRarity)}までのカードだけ登録できます。`;

  const after = [...deck, cardId].map((id) => cardById.get(id));
  if (!maxRarity) {
    if (after.filter((c) => c.rarity === 5).length > 1) return "★5は1枚までです。";
    if (after.filter((c) => c.rarity === 4).length > 2) return "★4は2枚までです。";
  }
  return "";
}

function cardValuesHtml(card, center = "", values = null) {
  const displayValues = values ?? Object.fromEntries(CARD_SIDES.map((side) => [side, getCardRawValue(card, side)]));
  return `
    <div class="card-values">
      <span class="v-up ${getAwakeningChangeClass(card, "up")} ${getKaijutsuChangeClass(card, "up")}">${displayValue(displayValues.up)}</span>
      <span class="v-right ${getAwakeningChangeClass(card, "right")} ${getKaijutsuChangeClass(card, "right")}">${displayValue(displayValues.right)}</span>
      <span class="v-down ${getAwakeningChangeClass(card, "down")} ${getKaijutsuChangeClass(card, "down")}">${displayValue(displayValues.down)}</span>
      <span class="v-left ${getAwakeningChangeClass(card, "left")} ${getKaijutsuChangeClass(card, "left")}">${displayValue(displayValues.left)}</span>
      <span class="v-center">${center}</span>
    </div>
  `;
}

function cardMiniHtml(card, extra = "", options = {}) {
  const values = options.values ?? (options.effective
    ? getCardValueSet(
        card,
        options.battle ?? state.battle,
        options.board ?? null,
        Number.isInteger(options.boardIndex) ? options.boardIndex : null
      )
    : Object.fromEntries(CARD_SIDES.map((side) => [side, getCardRawValue(card, side)])));
  const typeMeta = getCardTypeMeta(card);
  const centerLabel = extra ? escapeHtml(extra) : "";
  const showName = options.showName !== false;
  const showTop = options.showTop !== false;
  const showValues = options.showValues !== false;
  const visualClasses = ["card-visual"];
  if (card?.isShuraCard) visualClasses.push("shura-card");
  if (options.owner === "player" || options.owner === "npc") visualClasses.push(`owner-${options.owner}`);
  if (options.squareArt) visualClasses.push("square-art");
  if (options.detail) visualClasses.push("card-detail-visual");
  const ownerColor = options.owner === "player" ? "#2b7fe9" : "#e6425c";

  return `
    <div class="${visualClasses.join(" ")}" data-type="${typeMeta.key}" style="--card-type-color:${typeMeta.color};--card-owner-color:${ownerColor};">
      ${cardArtHtml(card)}
      ${showTop ? `<div class="card-visual-top only-stars">
        <span class="card-stars">${rarityStars(card.rarity)}</span>
      </div>` : ""}
      ${showValues ? `<div class="card-visual-values">
        <span class="cv cv-up ${getWildChangeClass(card, "up")} ${getAwakeningChangeClass(card, "up")} ${getKaijutsuChangeClass(card, "up")} ${isShuraEnhancedSide(card, "up") ? "shura-value" : ""}">${displayValue(values.up)}</span>
        <span class="cv cv-right ${getWildChangeClass(card, "right")} ${getAwakeningChangeClass(card, "right")} ${getKaijutsuChangeClass(card, "right")} ${isShuraEnhancedSide(card, "right") ? "shura-value" : ""}">${displayValue(values.right)}</span>
        <span class="cv cv-down ${getWildChangeClass(card, "down")} ${getAwakeningChangeClass(card, "down")} ${getKaijutsuChangeClass(card, "down")} ${isShuraEnhancedSide(card, "down") ? "shura-value" : ""}">${displayValue(values.down)}</span>
        <span class="cv cv-left ${getWildChangeClass(card, "left")} ${getAwakeningChangeClass(card, "left")} ${getKaijutsuChangeClass(card, "left")} ${isShuraEnhancedSide(card, "left") ? "shura-value" : ""}">${displayValue(values.left)}</span>
        ${centerLabel ? `<span class="cv cv-center">${centerLabel}</span>` : ""}
      </div>` : ""}
      ${showName ? `<div class="card-visual-name">${escapeHtml(card.name)}</div>` : ""}
    </div>
  `;
}

function cardStatLine(card) {
  return `上${displayValue(card.up)} / 右${displayValue(card.right)} / 下${displayValue(card.down)} / 左${displayValue(card.left)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function sanitizeRuleIds(ruleIds, preferredId = null) {
  let sanitized = [...new Set((ruleIds ?? []).filter((id) => RULE_NAME_BY_ID[id]))];

  // リトル系は1種類だけ選択可能。ただし、他の追加ルールは併用する。
  const preferredLittle = preferredId && isLittleRuleId(preferredId) ? preferredId : null;
  const littleRules = sanitized.filter(isLittleRuleId);
  if (littleRules.length > 1) {
    const keep = preferredLittle && littleRules.includes(preferredLittle) ? preferredLittle : littleRules[0];
    sanitized = sanitized.filter((id) => !isLittleRuleId(id) || id === keep);
  }

  const removeConflict = (a, b) => {
    if (sanitized.includes(a) && sanitized.includes(b)) {
      const removeId = preferredId === a ? b : a;
      const index = sanitized.indexOf(removeId);
      if (index >= 0) sanitized.splice(index, 1);
    }
  };
  removeConflict("order", "chaos");
  removeConflict("reverse", "ace_killer");
  return sanitized;
}

function getSelectedRuleIds(scope = document) {
  const checked = [...scope.querySelectorAll("[data-rule-id]:checked")].map((input) => input.value);
  return sanitizeRuleIds(checked);
}

function setSelectedRuleIds(ruleIds, scope = document) {
  const sanitized = sanitizeRuleIds(ruleIds);
  state.selectedRuleIds = sanitized;
  scope.querySelectorAll("[data-rule-id]").forEach((input) => {
    input.checked = sanitized.includes(input.value);
  });
  return sanitized;
}

function renderRuleSelector(targetId = "battleRuleList", allowedRuleIds = RULES.map((rule) => rule.id), initialRuleIds = state.selectedRuleIds) {
  const box = $(targetId);
  if (!box) return;
  const allowedSet = new Set(allowedRuleIds.filter((id) => RULE_NAME_BY_ID[id]));
  state.selectedRuleIds = sanitizeRuleIds(initialRuleIds.filter((id) => allowedSet.has(id)));
  box.innerHTML = RULES
    .filter((rule) => allowedSet.has(rule.id))
    .map((rule) => `
      <label class="rule-toggle ${state.selectedRuleIds.includes(rule.id) ? "selected" : ""}">
        <input type="checkbox" value="${rule.id}" data-rule-id="${rule.id}" ${state.selectedRuleIds.includes(rule.id) ? "checked" : ""}>
        <span><strong>${rule.name}</strong><small>${rule.short}</small></span>
      </label>
    `).join("");

  box.querySelectorAll("[data-rule-id]").forEach((input) => {
    input.addEventListener("change", () => {
      const selected = sanitizeRuleIds(getSelectedRuleIds(box), input.value);
      setSelectedRuleIds(selected, box);
      renderRuleSelector(targetId, allowedRuleIds, selected);
    });
  });
}

function getRuleSummary(ruleIds = state.selectedRuleIds) {
  const rules = sanitizeRuleIds(ruleIds);
  if (!rules.length) return "追加ルールなし";
  return rules.map((id) => RULE_NAME_BY_ID[id] ?? id).join(" / ");
}

function getRuleDescriptionHtml(ruleIds) {
  const rules = sanitizeRuleIds(ruleIds);
  if (!rules.length) return `<p class="muted">追加ルールはありません。</p>`;
  return `
    <div class="selected-rule-descriptions">
      ${rules.map((id) => {
        const rule = RULES.find((item) => item.id === id);
        if (!rule) return "";
        return `<div><strong>${escapeHtml(rule.name)}</strong><p>${escapeHtml(rule.short)}</p></div>`;
      }).join("")}
    </div>
  `;
}

function getNpcAttributeCategory(npc) {
  const name = String(npc?.name ?? "");
  if (name.includes("もな")) return "mona";
  if (name.includes("美雨")) return "miu";
  if (name.includes("凛花")) return "rinka";
  if (name.includes("百花")) return "momoka";
  return "other";
}

function getNpcDifficultyRank(difficulty) {
  return { "よわい": 1, "ふつう": 2, "つよい": 3, "修羅": 4 }[difficulty] ?? 99;
}

function getFilteredSortedNpcs() {
  const ui = state.npcListUi;
  const modeNpcs = NPCS.filter((npc) => state.npcListMode === "shura" ? getNpcNumber(npc) >= 16 : getNpcNumber(npc) <= 15);
  const filtered = modeNpcs.filter((npc) => isNpcUnlocked(npc)).filter((npc) => {
    if (ui.difficulty !== "all" && npc.difficulty !== ui.difficulty) return false;
    const wins = Number(state.save?.npcWins?.[npc.id] ?? 0);
    if (ui.winStatus === "unwon" && wins > 0) return false;
    if (ui.winStatus === "won" && wins <= 0) return false;
    if (ui.attribute !== "all" && getNpcAttributeCategory(npc) !== ui.attribute) return false;
    return true;
  });
  const direction = ui.sortOrder === "desc" ? -1 : 1;
  filtered.sort((a, b) => {
    let result = 0;
    if (ui.sortField === "name") {
      result = String(a.name).localeCompare(String(b.name), "ja");
    } else if (ui.sortField === "difficulty") {
      result = getNpcDifficultyRank(a.difficulty) - getNpcDifficultyRank(b.difficulty);
      if (result === 0) result = getNpcNumber(a) - getNpcNumber(b);
    } else {
      result = getNpcNumber(a) - getNpcNumber(b);
    }
    return result * direction;
  });
  return filtered;
}

function renderNpcListControls() {
  const controls = {
    npcFilterDifficulty: state.npcListUi.difficulty,
    npcFilterWinStatus: state.npcListUi.winStatus,
    npcFilterAttribute: state.npcListUi.attribute,
    npcSortField: state.npcListUi.sortField,
    npcSortOrder: state.npcListUi.sortOrder
  };
  Object.entries(controls).forEach(([id, value]) => {
    const el = $(id);
    if (el) el.value = value;
  });
}

function renderNpcList() {
  const shuraModeUnlocked = hasDefeatedNpc(15);
  if (!shuraModeUnlocked && state.npcListMode === "shura") {
    state.npcListMode = "normal";
  }

  const shuraMode = state.npcListMode === "shura";
  const modeLabel = $("npcModeLabel");
  const modeToggle = $("npcModeToggle");
  const modeSwitch = modeToggle?.closest(".npc-mode-switch");
  if (modeSwitch) modeSwitch.hidden = !shuraModeUnlocked;
  if (modeLabel) modeLabel.textContent = shuraMode ? "修羅モード" : "通常モード";
  if (modeToggle) modeToggle.textContent = shuraMode ? "通常モードに切り替え" : "修羅モードに切り替え";

  const panel = document.querySelector(".rule-panel");
  if (panel) {
    panel.innerHTML = shuraMode ? `
      <h3>修羅モード</h3>
      <p class="muted">修羅NPCは2手以上先を読む専用AIで行動し、NPCが使用するカードだけがレアリティに応じて強化されます。</p>
      <p class="muted">追加ルールは元になったNPCの候補・抽選数を引き継ぎます。</p>
    ` : `
      <h3>追加ルール</h3>
      <p class="muted">よわい：自由に設定可能</p>
      <p class="muted">ふつう：ランダムで追加ルールが1つ適用される</p>
      <p class="muted">つよい：ランダムで追加ルールが2つ適用される</p>
    `;
  }

  const list = $("npcList");
  const modeNpcs = NPCS.filter((npc) => shuraMode ? getNpcNumber(npc) >= 16 : getNpcNumber(npc) <= 15);
  const hiddenCount = modeNpcs.filter((npc) => !isNpcUnlocked(npc)).length;
  list.innerHTML = hiddenCount > 0
    ? `<div class="summary">${escapeHtml(getNpcUnlockMessage())}<br>未解放の対戦相手：${hiddenCount}人</div>`
    : "";

  renderNpcListControls();
  const filteredNpcs = getFilteredSortedNpcs();
  if (!filteredNpcs.length) {
    list.insertAdjacentHTML("beforeend", '<div class="summary">条件に一致する対戦相手はいません。</div>');
  }

  for (const npc of filteredNpcs) {
    const poolCards = getNpcCardPool(npc);
    const avgPower = poolCards.reduce((sum, card) => sum + card.power, 0) / Math.max(poolCards.length, 1);
    const maxRarity = poolCards.length ? Math.max(...poolCards.map((card) => card.rarity)) : 0;
    const difficultyClass = npc.difficulty === "よわい" ? "weak" : npc.difficulty === "ふつう" ? "normal" : npc.difficulty === "修羅" ? "shura" : "strong";
    const firstReward = npc.firstWinRewardCardId ? cardById.get(npc.firstWinRewardCardId) : null;
    const wins = Number(state.save.npcWins?.[npc.id] ?? 0);
    const firstRewardStatus = firstReward ? (wins > 0 ? "獲得済み" : "未獲得") : "なし";
    const firstRewardText = firstReward
      ? (wins > 0
        ? `No.${escapeHtml(firstReward.no)} ${escapeHtml(firstReward.name)}（獲得済み）`
        : `No.${escapeHtml(firstReward.no)}（未獲得）`)
      : firstRewardStatus;
    const firstRewardClass = firstReward ? (wins > 0 ? "obtained" : "not-obtained") : "none";
    const entryFee = getNpcEntryFee(npc);
    const winMoney = getNpcWinMoney(npc);
    const canChallenge = Number(state.save.money ?? 0) >= entryFee;

    const item = document.createElement("div");
    item.className = "npc-card";
    item.innerHTML = `
      <h3>${escapeHtml(npc.name)} <span class="badge ${difficultyClass}">${npc.difficulty}</span></h3>
      <p class="muted">勝利回数：<strong>${wins}回</strong> / 初回勝利報酬：<span class="first-reward-status ${firstRewardClass}">${firstRewardText}</span></p>
      <p class="muted">所持カード：${poolCards.length}枚 / 最大${rarityStars(maxRarity)} / 平均力 ${avgPower.toFixed(1)}</p>
      <p class="muted">挑戦料：${formatMoney(entryFee)} / 勝利報酬：${formatMoney(winMoney)}</p>
      <p class="muted">レアチャンス率：${getRareChanceRate(npc)}%</p>
      <button data-npc-id="${npc.id}" ${canChallenge ? "" : "disabled"}>${canChallenge ? "対戦する" : "所持金不足"}</button>
    `;
    item.querySelector("button").addEventListener("click", () => startBattle(npc.id));
    list.appendChild(item);
  }
}

function refreshShopStock() {
  const pick = (rarity, count) => sample(CARDS.filter((card) => card.rarity === rarity), count);
  const plan = getShopStockPlan();
  state.shopStock = [
    ...pick(1, plan[1] ?? 0),
    ...pick(2, plan[2] ?? 0),
    ...pick(3, plan[3] ?? 0)
  ];
}

function enterShop() {
  if (!state.shopInitialized) {
    refreshShopStock();
    state.shopInitialized = true;
  }
  renderShopScreen();
}

function renderShopScreen() {
  updateMoneyDisplays();
  const stockList = $("shopStockList");
  const sellList = $("shopSellList");
  const itemList = $("shopItemList");
  const message = $("shopMessage");
  const refreshButton = $("refreshShop");
  const money = Number(state.save.money ?? 0);
  if (!stockList || !sellList) return;
  const gradeSetting = getShopGradeSetting();
  const nextGrade = getNextShopGradeSetting();
  const refreshFee = getShopRefreshFee();
  const gradeInfo = $("shopGradeInfo");
  if (gradeInfo) {
    const plan = gradeSetting.stock;
    const nextText = nextGrade
      ? `次のグレードまであと${formatMoney(Math.max(0, nextGrade.required - Number(state.save.shopPurchaseTotal ?? 0)))}`
      : "最高グレードです";
    gradeInfo.innerHTML = `グレード${gradeSetting.grade} / 累計購入 ${formatMoney(state.save.shopPurchaseTotal ?? 0)} / 品揃え：★1 ${plan[1]}枚・★2 ${plan[2]}枚・★3 ${plan[3]}枚<br>${nextText}`;
  }
  if (refreshButton) {
    refreshButton.textContent = `品揃えを更新（${formatMoney(refreshFee)}）`;
    refreshButton.disabled = money < refreshFee;
  }
  if (!message.dataset.keep) message.textContent = `品揃えの更新には${formatMoney(refreshFee)}かかります。`;
  message.dataset.keep = "";

  stockList.innerHTML = state.shopStock.map((card, index) => {
    const price = getCardShopPrice(card);
    const canBuy = Number(state.save.money ?? 0) >= price;
    return `
      <div class="shop-card" data-shop-index="${index}">
        <div class="shop-card-preview mini-card">${cardMiniHtml(card, "", { squareArt: true, showName: false, showTop: false, showValues: false })}</div>
        <div class="shop-card-info">
          <strong>${escapeHtml(card.name)}</strong><br>
          <small>${rarityStars(card.rarity)}</small>
          <div class="shop-values-block">${cardValuesHtml(card)}</div>
          <strong>${formatMoney(price)}</strong><br>
          <span class="owned-badge ${getOwnedCount(card.id) > 0 ? "owned" : "not-owned"}">${getOwnedCount(card.id) > 0 ? "取得済み" : "未取得"}</span>
        </div>
        <button data-buy-index="${index}" ${canBuy ? "" : "disabled"}>${canBuy ? "購入" : "所持金不足"}</button>
      </div>
    `;
  }).join("") || `<p class="muted">現在購入できるカードはありません。品揃え更新ボタンで補充できます。</p>`;

  stockList.querySelectorAll("[data-shop-index]").forEach((element) => {
    const index = Number(element.getAttribute("data-shop-index"));
    applyCardTypeStyle(element, state.shopStock[index]);
  });
  stockList.querySelectorAll("[data-buy-index]").forEach((button) => {
    button.addEventListener("click", () => buyShopCard(Number(button.getAttribute("data-buy-index"))));
  });

  if (itemList) {
    itemList.innerHTML = SHOP_ITEMS.map((item) => {
      const owned = getOwnedItemCount(item.id);
      const remaining = getRemainingItemCapacity(item.id);
      const maxAffordable = item.price > 0 ? Math.floor(Number(state.save.money ?? 0) / item.price) : remaining;
      const maxQuantity = Math.max(0, Math.min(remaining, maxAffordable));
      const options = Array.from({ length: remaining }, (_, index) => index + 1)
        .map((quantity) => `<option value="${quantity}">${quantity}個</option>`)
        .join("");
      const canBuy = remaining > 0 && Number(state.save.money ?? 0) >= item.price;
      const buttonText = remaining <= 0 ? "所持上限" : canBuy ? "購入" : "所持金不足";
      return `
        <div class="shop-item-card" data-shop-item-id="${item.id}">
          <div class="shop-item-icon" aria-hidden="true">${item.id === "lock_detector" ? "🔑" : "✨"}</div>
          <div class="shop-item-info">
            <strong>${escapeHtml(item.name)}</strong>
            <p>${escapeHtml(item.description)}</p>
            <small>価格：${formatMoney(item.price)} / 所持 ${owned}個 / 最大 ${item.maxOwned}個</small>
          </div>
          <div class="shop-item-purchase">
            <select data-item-quantity="${item.id}" ${remaining > 0 ? "" : "disabled"}>${options || '<option value="0">0個</option>'}</select>
            <button data-buy-item-id="${item.id}" ${canBuy ? "" : "disabled"}>${buttonText}</button>
          </div>
        </div>
      `;
    }).join("");

    itemList.querySelectorAll("[data-buy-item-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const itemId = button.getAttribute("data-buy-item-id");
        const select = itemList.querySelector(`[data-item-quantity="${itemId}"]`);
        buyShopItem(itemId, Number(select?.value ?? 1));
      });
    });
  }

  const ownedCards = CARDS
    .filter((card) => getOwnedCount(card.id) > 0)
    .sort((a, b) => a.rarity - b.rarity || Number(a.no) - Number(b.no));

  sellList.innerHTML = ownedCards.map((card) => {
    const owned = getOwnedCount(card.id);
    const inDeck = getTotalInAllDecks(card.id);
    const available = Math.max(0, owned - inDeck);
    const price = getCardSellPrice(card);
    const canSell = price !== null && available > 0;
    const reason = price === null ? "売却不可" : available <= 0 ? "デッキ使用中" : `${formatMoney(price)}で売却`;
    return `
      <div class="shop-card sell-card" data-sell-card-id="${card.id}">
        <div class="shop-card-preview mini-card">${cardMiniHtml(card, "", { squareArt: true, showName: false, showTop: false, showValues: false })}</div>
        <div class="shop-card-info">
          <strong>${escapeHtml(card.name)}</strong><br>
          <small>${rarityStars(card.rarity)} / 所持 ${owned} / 売却可能 ${available}</small>
          <div class="shop-values-block">${cardValuesHtml(card)}</div>
          <span class="muted">${reason}</span>
        </div>
        <button data-sell-id="${card.id}" ${canSell ? "" : "disabled"}>売却</button>
      </div>
    `;
  }).join("") || `<p class="muted">売却できるカードがありません。</p>`;

  sellList.querySelectorAll("[data-sell-card-id]").forEach((element) => {
    applyCardTypeStyle(element, cardById.get(element.getAttribute("data-sell-card-id")));
  });
  sellList.querySelectorAll("[data-sell-id]").forEach((button) => {
    button.addEventListener("click", () => sellOwnedCard(button.getAttribute("data-sell-id")));
  });
}

function buyShopCard(index) {
  const card = state.shopStock[index];
  if (!card) return;
  const price = getCardShopPrice(card);
  if (!price || !spendMoney(price)) {
    showShopMessage("所持金が足りません。", true);
    renderShopScreen();
    return;
  }
  addOwnedCard(card.id);
  state.save.shopPurchaseTotal = Number(state.save.shopPurchaseTotal ?? 0) + price;
  save();
  state.shopStock.splice(index, 1);
  showShopMessage(`「${card.name}」を${formatMoney(price)}で購入しました。`);
  renderShopScreen();
}

function buyShopItem(itemId, quantity) {
  const item = SHOP_ITEM_BY_ID.get(itemId);
  if (!item) return;
  const amount = Math.max(1, Math.floor(Number(quantity) || 1));
  const remaining = getRemainingItemCapacity(itemId);
  if (remaining <= 0) {
    showShopMessage(`${item.name}は最大${item.maxOwned}個までです。`, true);
    renderShopScreen();
    return;
  }
  if (amount > remaining) {
    showShopMessage(`購入できるのはあと${remaining}個までです。`, true);
    renderShopScreen();
    return;
  }
  const totalPrice = item.price * amount;
  if (!spendMoney(totalPrice)) {
    showShopMessage("所持金が足りません。", true);
    renderShopScreen();
    return;
  }
  state.save.items[itemId] = getOwnedItemCount(itemId) + amount;
  state.save.shopPurchaseTotal = Number(state.save.shopPurchaseTotal ?? 0) + totalPrice;
  save();
  showShopMessage(`${item.name}を${amount}個、${formatMoney(totalPrice)}で購入しました。`);
  renderShopScreen();
}

function sellOwnedCard(cardId) {
  const card = cardById.get(cardId);
  if (!card) return;
  const price = getCardSellPrice(card);
  const available = getOwnedCount(card.id) - getTotalInAllDecks(card.id);
  if (price === null) {
    showShopMessage("★4以上のカードは現在売却できません。", true);
    return;
  }
  if (available <= 0) {
    showShopMessage("デッキで使用中のカードは売却できません。", true);
    return;
  }
  state.save.ownedCards[card.id] = Math.max(0, getOwnedCount(card.id) - 1);
  addMoney(price);
  addTotalEarnedMoney(price);
  showShopMessage(`「${card.name}」を${formatMoney(price)}で売却しました。`);
  renderShopScreen();
}

function showShopMessage(message, isError = false) {
  const box = $("shopMessage");
  if (!box) return;
  box.textContent = message;
  box.style.color = isError ? "var(--danger)" : "var(--good)";
  box.dataset.keep = "1";
}

function renderDeckTabsOnly() {
  const tabs = $("deckTabs");
  if (!tabs) return;
  tabs.innerHTML = "";

  for (let i = 0; i < TOTAL_DECK_COUNT; i += 1) {
    const button = document.createElement("button");
    const deckName = getDeckDisplayName(i);
    const activeText = !isLittleDeckIndex(i) && state.save.activeDeckIndex === i ? " 使用中" : "";
    button.textContent = `${deckName}${activeText}`;
    button.className = state.selectedDeckIndex === i ? "active" : "";
    button.addEventListener("click", () => {
      state.selectedDeckIndex = i;
      save();
      renderDeckScreen();
    });
    tabs.appendChild(button);
  }
}


function renderDeckKaijutsuSetting() {
  const select = $("deckKaijutsuSelect");
  const info = $("deckKaijutsuInfo");
  if (!select || !info) return;

  const newlyUnlocked = unlockKaijutsuForSave(state.save);
  if (newlyUnlocked.length) save();
  const equippedId = getDeckKaijutsuId(state.selectedDeckIndex);
  const rate = getCollectionRate();

  select.innerHTML = KAIJUTSU_SKILLS.map((skill) => {
    const unlocked = isKaijutsuUnlocked(skill.id);
    const suffix = unlocked || skill.id === "none" ? "" : `（図鑑${skill.unlockRate}%で取得）`;
    return `<option value="${skill.id}" ${unlocked ? "" : "disabled"}>${escapeHtml(skill.name)}${suffix}</option>`;
  }).join("");
  select.value = equippedId;

  const equipped = getKaijutsuSkill(equippedId);
  const unlockedCount = KAIJUTSU_SKILLS.filter((skill) => skill.id !== "none" && isKaijutsuUnlocked(skill.id)).length;
  info.innerHTML = `<strong>${escapeHtml(equipped.name)}</strong>：${escapeHtml(equipped.description)}<br><small>図鑑コンプリート率 ${rate.toFixed(2)}% / 取得済み ${unlockedCount}/${KAIJUTSU_SKILLS.length - 1}。一度取得した怪異術は、カード追加でコンプ率が下がっても失われません。</small>`;
}

function renderDeckScreen() {
  renderDeckTabsOnly();

  const deckNameInput = $("deckNameInput");
  if (deckNameInput) deckNameInput.value = getDeckDisplayName(state.selectedDeckIndex);
  renderDeckKaijutsuSetting();

  normalizeDeckSort();
  $("deckSortField").value = state.deckSort.field;
  $("deckSortOrder").value = state.deckSort.order;
  updateOwnedCardViewButtons();

  renderCurrentDeck();
  renderOwnedCardList();
}

function renderCurrentDeck() {
  const deck = state.save.decks[state.selectedDeckIndex];
  const box = $("currentDeck");
  box.innerHTML = "";

  for (let i = 0; i < 5; i += 1) {
    const cardId = deck[i];
    const row = document.createElement("div");
    row.className = `deck-card ${cardId ? "" : "empty"}`;

    if (!cardId) {
      row.innerHTML = `<div>空きスロット ${i + 1}</div>`;
    } else {
      const baseCard = cardById.get(cardId);
      const card = applyAwakeningToCard(baseCard);
      row.innerHTML = `
        <div class="deck-card-info">
          <div class="deck-card-art">${cardArtHtml(card)}</div>
          <div class="deck-card-text">
            <strong>${escapeHtml(card.name)}</strong><br>
            <small>${rarityStars(card.rarity)} / 所持 ${getOwnedCount(card.id)} / デッキ中 ${countInDeck(deck, card.id)}</small>
          </div>
          ${cardValuesHtml(card)}
        </div>
        <button class="small-button ghost">外す</button>
      `;
      applyCardTypeStyle(row, card);
      row.querySelector("button").addEventListener("click", () => {
        deck.splice(i, 1);
        save();
        renderDeckScreen();
      });
    }
    box.appendChild(row);
  }

  const deckLimit = getDeckRarityLimitByIndex(state.selectedDeckIndex);
  const error = validateDeck(deck, { maxRarity: deckLimit, deckLabel: getDeckDisplayName(state.selectedDeckIndex) });
  const note = getDeckRuleNote(state.selectedDeckIndex);
  $("deckMessage").textContent = error ? error : `このデッキは使用できます。${note ? " " + note : ""}`;
  $("deckMessage").style.color = error ? "var(--danger)" : "var(--good)";
}

function matchesCardRarityFilter(card, value) {
  return value === "all" || Number(card?.rarity) === Number(value);
}

function matchesCardAttributeFilter(card, value) {
  if (value === "all") return true;
  const type = getCardType(card);
  if (value === "mona") return type === "もなタイプ";
  if (value === "miu") return type === "美雨タイプ";
  if (value === "rinka") return type === "凛花タイプ";
  if (value === "momoka") return type === "百花タイプ";
  if (value === "other") return !type;
  return true;
}

function compareCollectionCards(a, b) {
  const field = state.collectionFilter.sortField;
  let result = 0;
  if (field === "name") {
    result = String(a.name).localeCompare(String(b.name), "ja");
  } else if (field === "rarity") {
    result = Number(a.rarity) - Number(b.rarity);
  } else {
    result = Number(String(a.no).replace(/\D/g, "")) - Number(String(b.no).replace(/\D/g, ""));
  }
  if (result === 0) result = String(a.id).localeCompare(String(b.id));
  return state.collectionFilter.sortOrder === "desc" ? -result : result;
}

function renderOwnedCardList() {
  const query = $("cardSearch").value.trim().toLowerCase();
  const list = $("ownedCardList");
  const view = getOwnedCardView();
  list.className = `card-list owned-card-list view-${view}`;
  list.innerHTML = "";

  const owned = CARDS
    .filter((card) => getOwnedCount(card.id) > 0)
    .filter((card) => !query || card.name.toLowerCase().includes(query))
    .filter((card) => matchesCardRarityFilter(card, state.deckFilter.rarity))
    .filter((card) => matchesCardAttributeFilter(card, state.deckFilter.attribute))
    .sort(compareOwnedCards);

  for (const baseCard of owned) {
    const card = applyAwakeningToCard(baseCard);
    const row = document.createElement("div");
    row.className = "owned-row";
    applyCardTypeStyle(row, card);
    row.innerHTML = `
      <div class="owned-row-layout">
        <div class="owned-row-art">${cardArtHtml(card)}</div>
        <div class="owned-row-info">
          <strong>${escapeHtml(card.name)}</strong><br>
          <small>${rarityStars(card.rarity)} / 所持 ${getOwnedCount(card.id)} / デッキ中 ${countInDeck(state.save.decks[state.selectedDeckIndex], card.id)}</small>
        </div>
        <div class="owned-row-values">
          ${cardValuesHtml(card, "+")}
        </div>
      </div>
    `;
    row.addEventListener("click", () => {
      const deck = state.save.decks[state.selectedDeckIndex];
      const error = canAddToDeck(deck, card.id, { maxRarity: getDeckRarityLimitByIndex(state.selectedDeckIndex), deckLabel: getDeckDisplayName(state.selectedDeckIndex) });
      if (error) {
        $("deckMessage").textContent = error;
        $("deckMessage").style.color = "var(--danger)";
        return;
      }
      deck.push(card.id);
      save();
      renderDeckScreen();
    });
    list.appendChild(row);
  }
}

function renderCollectionScreen() {
  const query = $("collectionSearch").value.trim().toLowerCase();
  if ($("collectionRarityFilter")) $("collectionRarityFilter").value = state.collectionFilter.rarity;
  if ($("collectionAttributeFilter")) $("collectionAttributeFilter").value = state.collectionFilter.attribute;
  if ($("collectionSortField")) $("collectionSortField").value = state.collectionFilter.sortField;
  if ($("collectionSortOrder")) $("collectionSortOrder").value = state.collectionFilter.sortOrder;
  const obtained = CARDS.filter((card) => state.save.discoveredCards[card.id]).length;
  const progressRows = [
    { label: "全体", rarity: null },
    ...[1, 2, 3, 4, 5].map((rarity) => ({ label: `★${rarity}`, rarity }))
  ].map(({ label, rarity }) => {
    const targetCards = rarity == null
      ? CARDS
      : CARDS.filter((card) => Number(card.rarity) === rarity);
    const discovered = rarity == null
      ? obtained
      : targetCards.filter((card) => state.save.discoveredCards[card.id]).length;
    const total = targetCards.length;
    const rate = total > 0 ? (discovered / total) * 100 : 0;
    return { label, discovered, total, rate };
  });

  $("collectionSummary").classList.add("collection-progress-summary");
  $("collectionSummary").innerHTML = `
    <div class="collection-progress-title">図鑑コンプリート率</div>
    <div class="collection-progress-grid">
      ${progressRows.map((row, index) => `
        <div class="collection-progress-item ${index === 0 ? "is-total" : ""}">
          <span>${row.label}</span>
          <strong>${row.discovered}/${row.total}（${row.rate.toFixed(2)}%）</strong>
        </div>
      `).join("")}
    </div>
  `;

  const grid = $("collectionGrid");
  grid.innerHTML = "";

  const cards = CARDS
    .filter((card) => !query || card.name.toLowerCase().includes(query))
    .filter((card) => matchesCardRarityFilter(card, state.collectionFilter.rarity))
    .filter((card) => matchesCardAttributeFilter(card, state.collectionFilter.attribute))
    .sort(compareCollectionCards);

  for (const baseCard of cards) {
    const card = state.save.discoveredCards[baseCard.id] ? applyAwakeningToCard(baseCard) : baseCard;
    const owned = getOwnedCount(card.id);
    const unlocked = state.save.discoveredCards[card.id];
    const div = document.createElement("div");
    div.className = `collection-card ${unlocked ? "" : "locked"}`;
    div.innerHTML = unlocked
      ? `
        <div class="collection-card-header">
          <strong>${escapeHtml(card.name)}</strong>
          <small>No.${escapeHtml(card.no)} / 所持 ${owned}</small>
        </div>
        <div class="collection-card-image mini-card">
          ${cardMiniHtml(card, "", { squareArt: true, showName: false, showTop: true, showValues: true })}
        </div>
      `
      : `
        <div class="collection-card-header">
          <strong>???</strong>
          <small>No.${escapeHtml(card.no)} / 未取得</small>
        </div>
        <div class="collection-card-image mini-card locked-card-image">
          <div class="card-stars">${rarityStars(card.rarity)}</div>
          <div class="card-values">
            <span class="v-up">?</span><span class="v-right">?</span><span class="v-down">?</span><span class="v-left">?</span><span class="v-center">?</span>
          </div>
        </div>
      `;
    if (unlocked) applyCardTypeStyle(div, card);
    grid.appendChild(div);
  }
}


function getOnlineRowTotalGames(row) {
  return Number(row.wins ?? 0) + Number(row.losses ?? 0) + Number(row.draws ?? 0);
}

function rankingRowsHtml(rows, kind) {
  if (!rows.length) return `<p class="muted">まだランキングデータがありません。</p>`;

  let displayRows = rows.map((row, index) => ({ ...row, rank: index + 1 }));
  if (kind === "onlineRating") {
    const played = rows.filter((row) => getOnlineRowTotalGames(row) > 0)
      .sort((a, b) => Number(b.rating ?? 1500) - Number(a.rating ?? 1500) || String(a.username ?? "").localeCompare(String(b.username ?? ""), "ja"));
    const noGames = rows.filter((row) => getOnlineRowTotalGames(row) === 0)
      .sort((a, b) => String(a.username ?? "").localeCompare(String(b.username ?? ""), "ja"));
    let previousRating = null;
    let currentRank = 0;
    displayRows = played.map((row, index) => {
      const rating = Number(row.rating ?? 1500);
      if (previousRating === null || rating !== previousRating) currentRank = index + 1;
      previousRating = rating;
      return { ...row, rank: currentRank };
    });
    const noGameRank = played.length + 1;
    displayRows.push(...noGames.map((row) => ({ ...row, rank: noGameRank || 1, noGames: true })));
  }

  return `
    <table class="ranking-table">
      <thead>
        <tr>
          <th>順位</th>
          <th>ユーザー名</th>
          <th>記録</th>
        </tr>
      </thead>
      <tbody>
        ${displayRows.map((row) => {
          let value = "";
          if (kind === "onlineRating") {
            const games = getOnlineRowTotalGames(row);
            value = games > 0
              ? `${Number(row.rating ?? 1500)} / ${Number(row.wins ?? 0)}勝 ${Number(row.losses ?? 0)}敗 ${Number(row.draws ?? 0)}分`
              : `${Number(row.rating ?? 1500)} / 対戦成績なし`;
          }
          if (kind === "collection") value = `${Number(row.rate ?? 0).toFixed(2)}%（${Number(row.count ?? 0)}/${Number(row.total ?? CARDS.length)}）`;
          if (kind === "totalEarnings") value = formatMoney(Number(row.totalEarnedMoney ?? 0));
          const rankText = kind === "onlineRating" ? `同率${row.rank}位` : `${row.rank}位`;
          return `<tr><td>${rankText}</td><td>${escapeHtml(row.username ?? "名無し")}</td><td>${escapeHtml(value)}</td></tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function renderRankingScreen() {
  const box = $("rankingContent");
  if (!box) return;
  box.innerHTML = `<p class="muted">ランキングを読み込み中です。</p>`;
  try {
    if (getOnlineUserName()) await syncPlayerRankings();
    const fb = await ensureOnlineFirebase();
    const [ratingSnap, collectionSnap, totalEarningsSnap] = await Promise.all([
      fb.get(getLeaderboardRef("onlineRating")),
      fb.get(getLeaderboardRef("collection")),
      fb.get(getLeaderboardRef("totalEarnings"))
    ]);
    const toRows = (snap) => {
      if (!snap.exists()) return [];
      const data = snap.val() ?? {};
      if (Array.isArray(data)) {
        return data.map((value, index) => value ? ({ uid: String(index), ...value }) : null).filter(Boolean);
      }
      return Object.entries(data).map(([uid, value]) => ({ uid, ...(value ?? {}) }));
    };
    const ratings = toRows(ratingSnap).sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0)).slice(0, 20);
    const collections = toRows(collectionSnap).sort((a, b) => Number(b.rate ?? 0) - Number(a.rate ?? 0) || Number(b.count ?? 0) - Number(a.count ?? 0)).slice(0, 20);
    const totalEarnings = toRows(totalEarningsSnap).sort((a, b) => Number(b.totalEarnedMoney ?? 0) - Number(a.totalEarnedMoney ?? 0)).slice(0, 20);
    box.innerHTML = `
      ${!getOnlineUserName() ? `<p class="muted">自分の記録をランキングへ登録するには、設定画面でランキング用ユーザー名を保存してください。</p>` : ""}
      <div class="ranking-grid">
        <section class="ranking-panel"><h3>オンライン対戦レート</h3>${rankingRowsHtml(ratings, "onlineRating")}</section>
        <section class="ranking-panel"><h3>図鑑コンプリート率</h3>${rankingRowsHtml(collections, "collection")}</section>
        <section class="ranking-panel"><h3>累計獲得金額</h3>${rankingRowsHtml(totalEarnings, "totalEarnings")}</section>
      </div>
    `;
  } catch (error) {
    console.error("ranking load failed", error);
    box.innerHTML = `<p class="danger-text">ランキング読み込みエラー：${escapeHtml(error.code ? `${error.code}: ${error.message ?? error}` : error.message ?? error)}</p><p class="muted">Firebase設定、Anonymous Auth、Realtime Database Rulesを確認してください。</p>`;
  }
}

function renderSettingsScreen() {
  $("effectToggle").checked = Boolean(state.save.settings.effects);
  $("battleCardPopupToggle").checked = Boolean(state.save.settings.battleCardPopup);
  renderProfileSummary(state.online.cachedProfile);
  refreshProfileSummary();
}

function showModal(title, bodyHtml, actions = []) {
  const modal = $("modal");
  modal.classList.remove("final-board-modal");
  state.currentModalSpec = { title, bodyHtml, actions };
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  const actionBox = $("modalActions");
  actionBox.innerHTML = "";
  for (const action of actions) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.className = action.className ?? "";
    button.disabled = Boolean(action.disabled);
    button.addEventListener("click", action.onClick);
    actionBox.appendChild(button);
  }
  modal.classList.remove("hidden");
}

function closeModal() {
  const modal = $("modal");
  modal.classList.add("hidden");
  modal.classList.remove("final-board-modal");
  delete modal.dataset.onlineWaiting;
  delete modal.dataset.onlineRematchWaiting;
}

function cloneReviewCard(card) {
  if (!card) return null;
  return {
    ...card,
    battleValues: card.battleValues ? { ...card.battleValues } : undefined,
    wildChanges: card.wildChanges ? { ...card.wildChanges } : undefined,
    shuraChanges: card.shuraChanges ? { ...card.shuraChanges } : undefined,
    awakeningChanges: card.awakeningChanges ? { ...card.awakeningChanges } : undefined,
    awakeningOriginalValues: card.awakeningOriginalValues ? { ...card.awakeningOriginalValues } : undefined,
    kaijutsuChanges: card.kaijutsuChanges ? { ...card.kaijutsuChanges } : undefined,
    kaijutsuSkillId: card.kaijutsuSkillId,
    skillRotation: card.skillRotation,
    kaijutsuSummary: card.kaijutsuSummary
  };
}

function captureFinalBattleSnapshot(battle = state.battle) {
  if (!battle || !Array.isArray(battle.board)) return null;
  const board = battle.board.map((cell) => cell ? {
    card: cloneReviewCard(cell.card),
    owner: cell.owner,
    locked: Boolean(cell.locked)
  } : null);
  const playerHand = (battle.playerHand ?? []).map((entry) => ({
    card: cloneReviewCard(entry.card),
    used: Boolean(entry.used)
  }));
  const npcHand = (battle.npcHand ?? []).map((entry) => ({
    card: cloneReviewCard(entry.card),
    used: Boolean(entry.used)
  }));
  const playerRemaining = playerHand.filter((entry) => !entry.used).length;
  const npcRemaining = npcHand.filter((entry) => !entry.used).length;
  const playerBoardCount = board.filter((cell) => cell?.owner === "player").length;
  const npcBoardCount = board.filter((cell) => cell?.owner === "npc").length;

  return {
    mode: battle.mode,
    npc: battle.npc ? { ...battle.npc } : null,
    rules: [...(battle.rules ?? [])],
    fieldEffects: { ...(battle.fieldEffects ?? {}) },
    lockCells: { ...(battle.lockCells ?? {}) },
    typeBoosts: { ...(battle.typeBoosts ?? {}) },
    board,
    playerHand,
    npcHand,
    score: {
      player: playerBoardCount + playerRemaining,
      npc: npcBoardCount + npcRemaining
    }
  };
}

function finalReviewCardHtml(cell, index, snapshot) {
  if (!cell?.card) return "";
  const typeMeta = getCardTypeMeta(cell.card);
  const values = getCardValueSet(cell.card, snapshot, snapshot.board, index);
  return `
    <div class="final-review-card owner-${cell.owner}" data-type="${typeMeta.key}" style="--card-type-color:${typeMeta.color};">
      ${cardMiniHtml(cell.card, "", {
        values,
        squareArt: true,
        detail: true,
        showName: false,
        battle: snapshot,
        board: snapshot.board,
        boardIndex: index,
        owner: cell.owner
      })}
    </div>
  `;
}

function finalReviewHandHtml(entries, snapshot, owner) {
  const remaining = (entries ?? []).filter((entry) => !entry.used && entry.card);
  if (!remaining.length) return '<p class="muted final-review-empty">残り手札なし</p>';
  return `
    <div class="final-review-hand-grid">
      ${remaining.map((entry) => {
        const typeMeta = getCardTypeMeta(entry.card);
        return `
          <div class="final-review-hand-card" data-type="${typeMeta.key}" style="--card-type-color:${typeMeta.color};">
            ${cardMiniHtml(entry.card, "", { squareArt: true, detail: true, showName: false, battle: snapshot, owner })}
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function finalBoardReviewHtml(snapshot) {
  const ruleText = snapshot.rules?.length ? getRuleSummary(snapshot.rules) : "なし";
  const opponentName = snapshot.npc?.name ?? "相手";
  const boardHtml = snapshot.board.map((cell, index) => {
    const fieldValue = getFieldEffectAt(index, snapshot);
    const fieldBadge = fieldValue
      ? `<span class="final-field-badge ${fieldValue > 0 ? "positive" : "negative"}">${fieldValue > 0 ? "+" : ""}${fieldValue}</span>`
      : "";
    const lockBadge = cell?.locked ? '<span class="final-lock-badge" aria-label="ロック">🔒</span>' : "";
    return `
      <div class="final-board-cell ${cell ? `has-card owner-${cell.owner}` : "empty"}">
        ${fieldBadge}
        ${cell ? finalReviewCardHtml(cell, index, snapshot) : '<span class="final-empty-cell">空き</span>'}
        ${lockBadge}
      </div>
    `;
  }).join("");

  return `
    <div class="final-board-review">
      <div class="final-review-summary">
        <strong>自分 ${snapshot.score.player} - ${snapshot.score.npc} ${escapeHtml(opponentName)}</strong>
        <span>追加ルール：${escapeHtml(ruleText)}</span>
      </div>
      <section class="final-review-hand-section">
        <h3>相手の残り手札</h3>
        ${finalReviewHandHtml(snapshot.npcHand, snapshot, "npc")}
      </section>
      <div class="final-board-grid" aria-label="最終盤面">
        ${boardHtml}
      </div>
      <section class="final-review-hand-section">
        <h3>自分の残り手札</h3>
        ${finalReviewHandHtml(snapshot.playerHand, snapshot, "player")}
      </section>
      <div class="final-review-legend">
        <span class="legend-player">青枠：自分</span>
        <span class="legend-npc">赤枠：相手</span>
      </div>
    </div>
  `;
}

function reopenLastResultModal() {
  const spec = state.lastResultModalSpec;
  if (!spec) {
    closeModal();
    return;
  }
  showModal(spec.title, spec.bodyHtml, spec.actions);
}

function showFinalBoardReview() {
  const snapshot = captureFinalBattleSnapshot();
  if (!snapshot) {
    showModal("盤面確認", "<p>確認できる最終盤面がありません。</p>", [
      { label: "閉じる", onClick: closeModal }
    ]);
    return;
  }
  state.lastResultModalSpec = state.currentModalSpec;
  showModal("最終盤面", finalBoardReviewHtml(snapshot), [
    { label: "リザルト画面に戻る", onClick: reopenLastResultModal }
  ]);
  $("modal").classList.add("final-board-modal");
}

function finalBoardAction() {
  return { label: "盤面確認", className: "ghost", onClick: showFinalBoardReview };
}

function getCardDetailHtml(card, options = {}) {
  const effective = Boolean(options.effective);
  return `
    <div class="card-detail-popup">
      <div class="card-detail-preview mini-card detail-card-card">
        ${cardMiniHtml(card, "", { effective, squareArt: true, detail: true, owner: options.owner })}
      </div>
      <div class="card-detail-meta">
        <div><strong>No.${escapeHtml(card.no)}</strong></div>
        <div>${rarityStars(card.rarity)} / 所持 ${getOwnedCount(card.id)}</div>
        <div>総合力 ${CARD_SIDES.reduce((sum, side) => sum + getCardRawValue(card, side), 0)}</div>
        ${card?.isAwakenedCard ? `<div class="awakening-detail-lines"><strong>${getAwakeningStageName(card.awakeningStage)}</strong><br>元の数値：${enhancementCardValuesHtml(card, true)}<br><span class="gold-text">覚醒後：${enhancementCardValuesHtml(card, false)}</span></div>` : ""}
        ${card?.kaijutsuSkillId ? `<div class="kaijutsu-detail-lines"><strong>怪異術：${escapeHtml(getKaijutsuSkill(card.kaijutsuSkillId).name)}</strong><br>${escapeHtml(card.kaijutsuSummary ?? "数値・向き変更適用中")}</div>` : ""}
      </div>
    </div>
  `;
}

function showCardDetailPopup(card, options = {}) {
  const actions = [];
  if (typeof options.onSelect === "function") {
    actions.push({
      label: options.selectLabel ?? "このカードを選択",
      onClick: () => {
        closeModal();
        options.onSelect();
      }
    });
  }
  actions.push({ label: "閉じる", className: "ghost", onClick: closeModal });
  showModal(options.title ?? "カード詳細", getCardDetailHtml(card, options), actions);
}

function fitBattleLayout() {
  const battleScreen = screens.battle;
  const battleMain = battleScreen?.querySelector(".battle-main");
  const pixiContainer = $("pixiContainer");
  if (!battleScreen?.classList.contains("active") || !battleMain || !pixiContainer) return;

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 360;
  const documentWidth = document.documentElement.clientWidth || viewportWidth;
  const compact = viewportWidth <= 720;

  const mainStyle = getComputedStyle(battleMain);
  const mainPaddingX = parseFloat(mainStyle.paddingLeft || "0") + parseFloat(mainStyle.paddingRight || "0");
  const battleRect = battleMain.getBoundingClientRect();
  const viewportSafeWidth = Math.max(220, Math.min(viewportWidth, documentWidth) - (compact ? 10 : 24));
  const measuredWidth = Math.min(battleMain.clientWidth || viewportSafeWidth, battleRect.width || viewportSafeWidth, viewportSafeWidth);
  const availableWidth = Math.max(compact ? 220 : 280, measuredWidth - mainPaddingX);
  const handGap = compact ? 3 : 8;
  const cardWidthLimit = compact ? 76 : 92;
  let cardWidth = Math.floor((availableWidth - handGap * 4) / 5);
  cardWidth = clamp(cardWidth, compact ? 44 : 76, cardWidthLimit);

  const cardPadding = clamp(Math.round(cardWidth / 13), 4, 8);
  const artHeight = clamp(Math.round(cardWidth * 0.38), compact ? 18 : 30, compact ? 32 : 42);
  const nameFont = clamp(Math.round(cardWidth / 8.5), 8, 11);
  const valueFont = clamp(Math.round(cardWidth / 6.5), 10, 12);
  const valueBox = clamp(Math.round(cardWidth / 4.4), 13, 16);
  const nameHeight = clamp(Math.round(nameFont * 2.35), 18, 26);
  const valuesHeight = valueBox * 3 + 4;
  const contentHeight = cardPadding * 2 + artHeight + nameHeight + valuesHeight + 16;
  const cardHeight = Math.max(Math.round(cardWidth * 1.62), contentHeight);

  // スクロール時にブラウザのアドレスバー表示/非表示で高さが変わっても盤面サイズが揺れないよう、
  // 3×3のバトル場は横幅だけを基準に固定する。
  const boardSize = Math.floor(Math.min(460, availableWidth));

  battleScreen.style.setProperty("--battle-board-size", `${boardSize}px`);
  battleScreen.style.setProperty("--battle-card-width", `${Math.floor(cardWidth)}px`);
  battleScreen.style.setProperty("--battle-card-min-height", `${Math.floor(cardHeight)}px`);
  battleScreen.style.setProperty("--battle-card-art-height", `${Math.floor(artHeight)}px`);
  battleScreen.style.setProperty("--battle-card-padding", `${Math.floor(cardPadding)}px`);
  battleScreen.style.setProperty("--battle-card-name-font", `${Math.floor(nameFont)}px`);
  battleScreen.style.setProperty("--battle-card-value-font", `${Math.floor(valueFont)}px`);
  battleScreen.style.setProperty("--battle-card-value-size", `${Math.floor(valueBox)}px`);
  battleScreen.style.setProperty("--battle-card-name-height", `${Math.floor(nameHeight)}px`);
  battleScreen.style.setProperty("--battle-hand-gap", `${Math.floor(handGap)}px`);
  battleScreen.style.setProperty("--battle-hand-min-height", `${Math.floor(cardHeight + (compact ? 8 : 10))}px`);

  battleMain.style.minHeight = "";
}
function initPixi() {
  if (state.pixi.app) {
    state.pixi.app.destroy(true, { children: true });
  }

  const app = new PIXI.Application({
    width: 460,
    height: 460,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true
  });

  state.pixi.app = app;
  state.pixi.boardLayer = new PIXI.Container();
  state.pixi.effectLayer = new PIXI.Container();
  app.stage.addChild(state.pixi.boardLayer);
  app.stage.addChild(state.pixi.effectLayer);

  $("pixiContainer").innerHTML = "";
  $("pixiContainer").appendChild(app.view);
  fitBattleLayout();
}

function boardPosition(index) {
  const row = Math.floor(index / 3);
  const col = index % 3;
  const { originX, originY, cellSize, gap } = state.pixi;
  return {
    x: originX + col * (cellSize + gap),
    y: originY + row * (cellSize + gap)
  };
}

function renderBoard() {
  const { boardLayer, cellSize } = state.pixi;
  if (!boardLayer) return;

  boardLayer.removeChildren();

  for (let index = 0; index < 9; index += 1) {
    const pos = boardPosition(index);
    const cell = new PIXI.Graphics();
    cell.beginFill(0x171b31, 0.92);
    cell.lineStyle(2, 0xffffff, 0.16);
    cell.drawRoundedRect(pos.x, pos.y, cellSize, cellSize, 18);
    cell.endFill();
    cell.eventMode = "static";
    cell.cursor = "pointer";
    cell.on("pointertap", () => handleBoardClick(index));
    boardLayer.addChild(cell);

    const selectingFieldPurge = state.battle?.kaijutsu?.targetMode === "field_purge";
    const purgeEligible = selectingFieldPurge && getFieldEffectAt(index, state.battle) !== 0 && !state.battle?.board[index] && !isLockCell(index, state.battle);
    if (purgeEligible) {
      const targetFrame = new PIXI.Graphics();
      targetFrame.lineStyle(5, 0xd9a7ff, 0.95);
      targetFrame.drawRoundedRect(pos.x + 4, pos.y + 4, cellSize - 8, cellSize - 8, 16);
      boardLayer.addChild(targetFrame);
    }

    const fieldValue = getFieldEffectAt(index, state.battle);
    if (fieldValue) {
      const fieldBadge = new PIXI.Graphics();
      const positive = fieldValue > 0;
      fieldBadge.beginFill(positive ? 0x1e8f57 : 0x9f2d45, 0.92);
      fieldBadge.lineStyle(2, 0xffffff, 0.18);
      fieldBadge.drawRoundedRect(pos.x + cellSize - 48, pos.y + 8, 40, 24, 8);
      fieldBadge.endFill();
      boardLayer.addChild(fieldBadge);

      const fieldLabel = new PIXI.Text(`${fieldValue > 0 ? "+" : ""}${fieldValue}`, {
        fontFamily: "Arial",
        fontSize: 15,
        fontWeight: "bold",
        fill: 0xffffff
      });
      fieldLabel.anchor.set(0.5);
      fieldLabel.x = pos.x + cellSize - 28;
      fieldLabel.y = pos.y + 20;
      boardLayer.addChild(fieldLabel);
    }

    const placed = state.battle?.board[index];
    if (!placed && state.battle?.revealLockCells && isLockCell(index, state.battle)) {
      const detectorBg = new PIXI.Graphics();
      detectorBg.beginFill(0x101626, 0.82);
      detectorBg.lineStyle(3, 0xffd66b, 0.95);
      detectorBg.drawRoundedRect(pos.x + 8, pos.y + 8, cellSize - 16, cellSize - 16, 14);
      detectorBg.endFill();
      boardLayer.addChild(detectorBg);

      const detectorText = new PIXI.Text("🔒", {
        fontFamily: "Arial",
        fontSize: Math.max(26, Math.round(cellSize * 0.25)),
        fill: 0xffd66b
      });
      detectorText.anchor.set(0.5);
      detectorText.x = pos.x + cellSize / 2;
      detectorText.y = pos.y + cellSize / 2;
      boardLayer.addChild(detectorText);
    }
    if (placed) {
      boardLayer.addChild(createPixiCard(placed.card, placed.owner, pos.x + 8, pos.y + 8, index));
      if (placed.locked) {
        const lockBg = new PIXI.Graphics();
        lockBg.beginFill(0x101626, 0.86);
        lockBg.lineStyle(2, 0xffd66b, 0.9);
        lockBg.drawCircle(pos.x + cellSize - 24, pos.y + cellSize - 24, 15);
        lockBg.endFill();
        boardLayer.addChild(lockBg);
        const lockText = new PIXI.Text("🔒", {
          fontFamily: "Arial",
          fontSize: 17,
          fill: 0xffd66b
        });
        lockText.anchor.set(0.5);
        lockText.x = pos.x + cellSize - 24;
        lockText.y = pos.y + cellSize - 24;
        boardLayer.addChild(lockText);
      }
    }
  }
}

function createPixiCard(card, owner, x, y, boardIndex = null) {
  const container = new PIXI.Container();
  container.x = x;
  container.y = y;

  const playerColor = 0x2b7fe9;
  const npcColor = 0xe6425c;
  const borderColor = owner === "player" ? playerColor : npcColor;
  const fillColor = owner === "player" ? 0x163b69 : 0x652033;

  const frame = new PIXI.Graphics();
  frame.beginFill(fillColor, 0.96);
  frame.lineStyle(4, borderColor, 1);
  frame.drawRoundedRect(0, 0, 116, 116, 16);
  frame.endFill();
  container.addChild(frame);

  if (card?.isShuraCard) {
    // 修羅カードは、内側から「属性色 → オレンジ → 所有者色」の3層で表示する。
    // 外側の所有者色（青/赤）は base frame が担当。
    const flameFrame = new PIXI.Graphics();
    flameFrame.lineStyle(3, 0xff6a1f, 1);
    flameFrame.drawRoundedRect(3, 3, 110, 110, 14);
    const typeColor = Number.parseInt(getCardTypeMeta(card).color.replace("#", ""), 16);
    flameFrame.lineStyle(3, Number.isFinite(typeColor) ? typeColor : 0xa3adbd, 1);
    flameFrame.drawRoundedRect(7, 7, 102, 102, 12);
    container.addChild(flameFrame);
  }

  const artMask = new PIXI.Graphics();
  artMask.beginFill(0xffffff, 1);
  artMask.drawRoundedRect(8, 8, 100, 100, 12);
  artMask.endFill();
  container.addChild(artMask);

  const art = PIXI.Sprite.from(getCardImagePath(card));
  art.x = 8;
  art.y = 8;
  art.width = 100;
  art.height = 100;
  art.alpha = 0.96;
  art.mask = artMask;
  container.addChild(art);

  const vignette = new PIXI.Graphics();
  vignette.beginFill(0x000000, 0.18);
  vignette.drawRoundedRect(8, 8, 100, 100, 12);
  vignette.endFill();
  container.addChild(vignette);

  const typeMeta = getCardTypeMeta(card);
  const typeFrame = new PIXI.Graphics();
  typeFrame.lineStyle(3, PIXI.utils.string2hex(typeMeta.color), 0.95);
  typeFrame.drawRoundedRect(8, 8, 100, 100, 12);
  container.addChild(typeFrame);

  const starBand = new PIXI.Graphics();
  starBand.beginFill(0x0b1020, 0.64);
  starBand.drawRoundedRect(10, 10, 44, 16, 8);
  starBand.endFill();
  container.addChild(starBand);

  const star = new PIXI.Text(rarityStars(card.rarity), {
    fontFamily: "Arial",
    fontSize: 11,
    fill: 0xffd66b,
    fontWeight: "bold"
  });
  star.anchor.set(0.5, 0.5);
  star.x = 32;
  star.y = 18;
  container.addChild(star);


  const values = getCardValueSet(card, state.battle, state.battle?.board, boardIndex);
  addValueText(container, displayValue(values.up), 58, 18, getWildValueColor(card, "up"), { shura: isShuraEnhancedSide(card, "up") });
  addValueText(container, displayValue(values.right), 98, 58, getWildValueColor(card, "right"), { shura: isShuraEnhancedSide(card, "right") });
  addValueText(container, displayValue(values.down), 58, 98, getWildValueColor(card, "down"), { shura: isShuraEnhancedSide(card, "down") });
  addValueText(container, displayValue(values.left), 18, 58, getWildValueColor(card, "left"), { shura: isShuraEnhancedSide(card, "left") });

  if (isBattleCardPopupEnabled()) {
    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointertap", (event) => {
      event.stopPropagation();
      showCardDetailPopup(card, { title: owner === "player" ? "場の自分カード" : "場の相手カード", effective: true, owner });
    });
  }

  return container;
}

function addValueText(container, text, x, y, textColor = 0xffffff, options = {}) {
  if (options.shura) {
    const outer = new PIXI.Graphics();
    outer.beginFill(0xe52f16, 0.97);
    outer.drawPolygon([x, y - 16, x + 8, y - 5, x + 12, y - 10, x + 14, y + 5, x + 8, y + 13, x, y + 17, x - 8, y + 13, x - 14, y + 5, x - 11, y - 8, x - 5, y - 3]);
    outer.endFill();
    container.addChild(outer);
    const inner = new PIXI.Graphics();
    inner.beginFill(0xffad1f, 0.98);
    inner.drawPolygon([x, y - 9, x + 6, y, x + 8, y + 7, x, y + 12, x - 8, y + 7, x - 5, y - 2]);
    inner.endFill();
    container.addChild(inner);
  } else {
    const bg = new PIXI.Graphics();
    bg.beginFill(0x0b1020, 0.82);
    bg.lineStyle(1, 0xffffff, 0.16);
    bg.drawRoundedRect(x - 12, y - 10, 24, 20, 7);
    bg.endFill();
    container.addChild(bg);
  }

  // 修羅強化だけが付いた数値は、炎の明るい背景でも見やすい黒で描画する。
  // ワイルドカードの色が同じ辺に付いている場合は、従来どおりワイルド色を優先する。
  const resolvedTextColor = options.shura && textColor === 0xffffff ? 0x111111 : textColor;
  const label = new PIXI.Text(text, {
    fontFamily: "Arial",
    fontSize: 14,
    fontWeight: "bold",
    fill: resolvedTextColor
  });
  label.anchor.set(0.5);
  label.x = x;
  label.y = y;
  container.addChild(label);
}

function addBattleLog(message) {
  const log = $("battleLog");
  const row = document.createElement("div");
  row.className = "log-row";
  row.textContent = message;
  log.prepend(row);
}


function isKaijutsuAvailableInBattle(battle = state.battle) {
  return Boolean(battle && !["online", "onlineNpc"].includes(battle.mode));
}

function getBattleKaijutsuState(battle = state.battle) {
  return battle?.kaijutsu ?? null;
}

function getKaijutsuTargetHandIndex(battle = state.battle) {
  const target = battle?.kaijutsu?.targetHandIndex;
  return Number.isInteger(target) && target >= 0 ? target : null;
}

function getSelectedHandIndexForKaijutsu() {
  const battle = state.battle;
  if (!battle) return null;
  const forced = getForcedHandIndex("player");
  if (forced !== null) return forced;
  return Number.isInteger(state.selectedHandIndex) ? state.selectedHandIndex : null;
}

function renderKaijutsuControl() {
  const button = $("useKaijutsuButton");
  const status = $("kaijutsuStatus");
  if (!button || !status) return;
  const battle = state.battle;
  const skillState = getBattleKaijutsuState(battle);

  if (!battle || !isKaijutsuAvailableInBattle(battle)) {
    button.textContent = "怪異術：使用不可";
    button.disabled = true;
    status.textContent = battle ? "オンライン対戦では怪異術を使用できません。" : "";
    return;
  }

  const skill = getKaijutsuSkill(skillState?.id ?? "none");
  if (!skillState || skill.id === "none") {
    button.textContent = "怪異術：未設定";
    button.disabled = true;
    status.textContent = "デッキ画面で怪異術を設定できます。";
    return;
  }

  if (skillState.targetMode === "field_purge") {
    button.textContent = `${skill.name}：対象選択をキャンセル`;
    button.disabled = false;
    status.textContent = "無効化する空きマスのフィールド効果を選んでください。";
    return;
  }

  if (skillState.used) {
    button.textContent = `怪異術：${skill.name}（使用済み）`;
    button.disabled = true;
    status.textContent = skillState.pending ? "次に出すカードへ適用済みです。" : "この対戦では使用済みです。";
    return;
  }

  const usableTurn = battle.currentTurn === "player" && !battle.locked && !battle.finished;
  button.textContent = `怪異術：${skill.name}`;
  button.disabled = !usableTurn;
  status.textContent = usableTurn ? skill.description : "自分のターンで、カードを置く前に使用できます。";
}

function armNextCardKaijutsu(skillId, options = {}) {
  const battle = state.battle;
  const skillState = getBattleKaijutsuState(battle);
  const handIndex = getSelectedHandIndexForKaijutsu();
  if (!battle || !skillState || handIndex === null) {
    showModal("怪異術", "<p>先に、次に場へ出す手札を1枚選択してください。</p>", [{ label: "閉じる", onClick: closeModal }]);
    return;
  }
  const entry = battle.playerHand?.[handIndex];
  if (!entry || entry.used) return;
  entry.card = applyKaijutsuToCard(entry.card, skillId, options);
  skillState.used = true;
  skillState.pending = true;
  skillState.targetHandIndex = handIndex;
  state.selectedHandIndex = handIndex;
  const skill = getKaijutsuSkill(skillId);
  addBattleLog(`怪異術「${skill.name}」を発動：${entry.card.kaijutsuSummary || skill.description}`);
  closeModal();
  renderBattleAll();
}

function beginFieldPurgeKaijutsu() {
  const battle = state.battle;
  const skillState = getBattleKaijutsuState(battle);
  if (!battle || !skillState) return;
  const candidates = Array.from({ length: 9 }, (_, index) => index).filter((index) => {
    return getFieldEffectAt(index, battle) !== 0 && !battle.board[index] && !isLockCell(index, battle);
  });
  if (!candidates.length) {
    showModal("地縛祓い", "<p>無効化できるフィールド効果がありません。</p><p>ロックマス、または既にカードが置かれたマスは対象にできません。</p>", [{ label: "閉じる", onClick: closeModal }]);
    return;
  }
  skillState.targetMode = "field_purge";
  addBattleLog("怪異術「地縛祓い」：無効化するフィールド効果のマスを選択してください。");
  renderBattleAll();
}

function resolveFieldPurgeKaijutsu(index) {
  const battle = state.battle;
  const skillState = getBattleKaijutsuState(battle);
  if (!battle || skillState?.targetMode !== "field_purge") return false;
  const value = getFieldEffectAt(index, battle);
  if (!value || battle.board[index] || isLockCell(index, battle)) {
    addBattleLog("地縛祓い：そのマスは無効化できません。");
    return true;
  }
  delete battle.fieldEffects[index];
  delete battle.fieldEffects[String(index)];
  skillState.targetMode = null;
  skillState.used = true;
  addBattleLog(`怪異術「地縛祓い」：マス${index + 1}の${value > 0 ? "+" : ""}${value}効果を無効化しました。`);
  renderBattleAll();
  return true;
}

function activateKaijutsu() {
  const battle = state.battle;
  const skillState = getBattleKaijutsuState(battle);
  if (!battle || !skillState || !isKaijutsuAvailableInBattle(battle)) return;
  if (skillState.targetMode === "field_purge") {
    skillState.targetMode = null;
    addBattleLog("地縛祓いの対象選択をキャンセルしました。");
    renderBattleAll();
    return;
  }
  if (skillState.used || battle.currentTurn !== "player" || battle.locked || battle.finished) return;
  const skill = getKaijutsuSkill(skillState.id);
  if (skill.id === "none") return;

  if (skill.id === "field_purge") {
    beginFieldPurgeKaijutsu();
    return;
  }

  const handIndex = getSelectedHandIndexForKaijutsu();
  if (handIndex === null) {
    showModal("怪異術", "<p>先に、次に場へ出す手札を1枚選択してください。</p>", [{ label: "閉じる", onClick: closeModal }]);
    return;
  }

  const sideLabels = { up: "上", right: "右", down: "下", left: "左" };
  if (skill.id === "curse_boost" || skill.id === "blood_contract") {
    const suffix = skill.id === "curse_boost" ? "+1する辺" : "+2する辺";
    const actions = CARD_SIDES.map((side) => ({
      label: `${sideLabels[side]}を選択`,
      onClick: () => armNextCardKaijutsu(skill.id, { side })
    }));
    actions.push({ label: "キャンセル", className: "ghost", onClick: closeModal });
    showModal(skill.name, `<p>${escapeHtml(skill.description)}</p><p><strong>${suffix}を選んでください。</strong></p>`, actions);
    return;
  }

  showModal(skill.name, `<p>${escapeHtml(skill.description)}</p><p>選択中のカードに適用します。</p>`, [
    { label: "使用する", onClick: () => armNextCardKaijutsu(skill.id) },
    { label: "キャンセル", className: "ghost", onClick: closeModal }
  ]);
}

function renderBattleHands() {
  const battle = state.battle;
  if (!battle) return;

  const forcedPlayerIndex = getForcedHandIndex("player");
  const skillTargetIndex = getKaijutsuTargetHandIndex(battle);
  const playerHand = $("playerHand");
  playerHand.innerHTML = "";
  battle.playerHand.forEach((entry, index) => {
    const div = document.createElement("div");
    const isForced = forcedPlayerIndex === index && battle.currentTurn === "player" && !entry.used;
    const isSkillTarget = skillTargetIndex === index && !entry.used;
    div.className = `mini-card ${entry.used ? "used" : ""} ${state.selectedHandIndex === index || isForced || isSkillTarget ? "selected" : ""} ${isForced ? "forced" : ""} ${isSkillTarget ? "kaijutsu-target" : ""}`;
    div.innerHTML = cardMiniHtml(entry.card, isForced ? "指定" : "", { showName: false, effective: true, owner: "player" });
    applyCardTypeStyle(div, entry.card);

    const canSelect = !entry.used && battle.currentTurn === "player" && !battle.locked && forcedPlayerIndex === null && (skillTargetIndex === null || skillTargetIndex === index);
    if (isBattleCardPopupEnabled()) {
      div.addEventListener("click", () => {
        showCardDetailPopup(entry.card, canSelect ? {
          title: "手札カード",
          owner: "player",
          onSelect: () => {
            state.selectedHandIndex = state.selectedHandIndex === index ? null : index;
            renderBattleHands();
          },
          selectLabel: state.selectedHandIndex === index ? "選択を解除" : "このカードを選ぶ"
        } : { title: "手札カード", owner: "player" });
      });
    } else if (canSelect) {
      div.addEventListener("click", () => {
        state.selectedHandIndex = state.selectedHandIndex === index ? null : index;
        renderBattleHands();
      });
    }
    playerHand.appendChild(div);
  });

  const npcHand = $("npcHand");
  npcHand.innerHTML = "";
  const revealNpcHand = battle.npc.difficulty === "よわい" || hasRule("all_open", battle);
  battle.npcHand.forEach((entry, index) => {
    const div = document.createElement("div");
    const isForced = getForcedHandIndex("npc") === index && battle.currentTurn === "npc" && !entry.used;
    if (revealNpcHand) {
      div.className = `mini-card opponent-open ${entry.used ? "used" : ""} ${isForced ? "forced" : ""}`;
      div.innerHTML = cardMiniHtml(entry.card, "", { showName: false, effective: true, owner: "npc" });
      applyCardTypeStyle(div, entry.card);
      if (isBattleCardPopupEnabled()) {
        div.addEventListener("click", () => showCardDetailPopup(entry.card, { title: "相手の手札", owner: "npc" }));
      }
    } else {
      div.className = `card-back ${isForced ? "forced" : ""}`;
      div.textContent = entry.used ? "済" : "PCB";
      if (entry.used) div.style.opacity = "0.28";
    }
    npcHand.appendChild(div);
  });

  const score = calcScore();
  $("scoreLabel").textContent = `自分 ${score.player} - ${score.npc} 相手`;
  $("turnLabel").textContent = battle.finished
    ? "対戦終了"
    : battle.currentTurn === "coin"
      ? "現在のターン：コイントス中"
      : `現在のターン：${battle.currentTurn === "player" ? "プレイヤー" : "相手"}`;
  renderKaijutsuControl();
}

function renderBattleAll() {
  renderBoard();
  renderBattleHands();
  scheduleBattleAutoFit();
}

function calcScore(customBoard = null, playerRemaining = null, npcRemaining = null) {
  const battle = state.battle;
  const board = customBoard ?? battle.board;
  const boardPlayer = board.filter((cell) => cell?.owner === "player").length;
  const boardNpc = board.filter((cell) => cell?.owner === "npc").length;
  const pRemain = playerRemaining ?? battle.playerHand.filter((entry) => !entry.used).length;
  const nRemain = npcRemaining ?? battle.npcHand.filter((entry) => !entry.used).length;

  return {
    player: boardPlayer + pRemain,
    npc: boardNpc + nRemain
  };
}

function getNpcCardPool(npc) {
  return (npc?.cardPool ?? []).map((id) => cardById.get(id)).filter(Boolean);
}

function getNpcCardPoolForRules(npc, ruleIds = []) {
  const maxRarity = getLittleRuleMaxRarity(ruleIds);
  if (!maxRarity) return getNpcCardPool(npc);
  const explicit = npc?.littlePools?.[String(maxRarity)] ?? npc?.littlePools?.[maxRarity];
  const sourceIds = Array.isArray(explicit) ? explicit : (npc?.cardPool ?? []);
  let pool = sourceIds.map((id) => cardById.get(id)).filter((card) => card && card.rarity <= maxRarity);
  if (pool.length < 5) pool = CARDS.filter((card) => card.rarity <= maxRarity);
  return pool;
}

function buildNpcHand(npc, ruleIds = []) {
  const pool = getNpcCardPoolForRules(npc, ruleIds);
  const selected = [];
  const selectedIds = new Set();
  const addCard = (card) => {
    if (!card || selectedIds.has(card.id) || selected.length >= 5) return false;
    selected.push(card);
    selectedIds.add(card.id);
    return true;
  };

  for (const cardId of npc.requiredCards ?? []) {
    const requiredCard = cardById.get(cardId);
    // 難易度調整のため、リトル選択時でもNPCの必須カードは必ず手札に入れる。
    // 例：NPC15のcard_180はリトル★★★でも手札に入る。
    addCard(requiredCard);
  }

  for (const pattern of npc.handPattern ?? []) {
    const candidates = shuffle(pool.filter((card) => !selectedIds.has(card.id) && (!pattern.rarity || card.rarity === pattern.rarity)));
    for (const card of candidates.slice(0, Math.max(0, Number(pattern.count ?? 0)))) {
      addCard(card);
    }
  }

  for (const card of shuffle(pool.filter((card) => !selectedIds.has(card.id)))) {
    if (selected.length >= 5) break;
    addCard(card);
  }

  return selected.slice(0, 5);
}

function getNpcRuleGroup(npc, groupName) {
  return (npc?.[groupName] ?? []).filter((id) => RULE_NAME_BY_ID[id]);
}

function rollNpcAdditionalRules(npc) {
  const group1 = getNpcRuleGroup(npc, "ruleGroup1");
  const group2 = getNpcRuleGroup(npc, "ruleGroup2");
  const rolled = [];
  const ruleDifficulty = npc.baseDifficulty ?? npc.difficulty;
  if (ruleDifficulty === "ふつう" && group1.length) {
    rolled.push(sample(group1, 1)[0]);
  } else if (ruleDifficulty === "つよい") {
    if (group1.length) rolled.push(sample(group1, 1)[0]);
    if (group2.length) rolled.push(sample(group2, 1)[0]);
  }
  return sanitizeRuleIds(rolled);
}

function rollOnlineAdditionalRules() {
  const candidateIds = RULES.map((rule) => rule.id);
  const picked = sample(candidateIds, 1)[0];
  return picked ? [picked] : [];
}

function ensureNpcFeeAvailable(npc, amount, title = "所持金不足") {
  if (Number(state.save.money ?? 0) >= amount) return true;
  showModal(title, `<p>必要金額は${formatMoney(amount)}です。</p><p>現在の所持金：${formatMoney(state.save.money)}</p>`, [
    { label: "ショップへ", onClick: () => { closeModal(); showScreen("shop"); } },
    { label: "閉じる", className: "ghost", onClick: closeModal }
  ]);
  return false;
}

function chargeNpcChallengeFee(npc) {
  const entryFee = getNpcEntryFee(npc);
  if (!ensureNpcFeeAvailable(npc, entryFee)) return false;
  if (entryFee > 0) spendMoney(entryFee);
  return true;
}

function showWeakRuleSelection(npc) {
  if (!chargeNpcChallengeFee(npc)) return;
  state.selectedRuleIds = [];
  showModal(
    "追加ルール設定",
    `
      <p><strong>${escapeHtml(npc.name)}</strong>は難易度「よわい」のため、追加ルールを自由に設定できます。</p>
      <p class="muted">オーダーとカオス、リバースとエースキラーは同時に付けられません。</p>
      <div id="weakRuleList" class="rule-list"></div>
      <p class="muted">挑戦料${formatMoney(getNpcEntryFee(npc))}は支払い済みです。キャンセル・棄権時も返金されません。</p>
      <p class="muted">勝利報酬：${formatMoney(getNpcWinMoney(npc))}</p>
    `,
    [
      { label: "このルールで対戦開始", onClick: () => { const scope = $("weakRuleList"); const rules = getSelectedRuleIds(scope); closeModal(); startBattle(npc.id, rules, { entryFeePaid: true }); } },
      { label: "キャンセル", className: "ghost", onClick: closeModal }
    ]
  );
  renderRuleSelector("weakRuleList", RULES.map((rule) => rule.id), []);
}

function showRuleLottery(npc, options = {}) {
  const initial = options.initial !== false;
  if (initial && !chargeNpcChallengeFee(npc)) return;

  const rules = Array.isArray(options.rules) ? sanitizeRuleIds(options.rules) : rollNpcAdditionalRules(npc);
  const rerollFee = Math.ceil(getNpcEntryFee(npc) / 2);
  const pending = ensurePendingNpcItems(npc.id);
  const lockOwned = getOwnedItemCount("lock_detector");
  const charmOwned = getOwnedItemCount("miracle_charm");

  const reopenWithSameRules = () => {
    closeModal();
    showRuleLottery(npc, { initial: false, rules });
  };

  const actions = [
    { label: "対戦開始", onClick: () => { closeModal(); startBattle(npc.id, rules, { entryFeePaid: true }); } },
    {
      label: `再抽選（${formatMoney(rerollFee)}）`,
      className: "ghost",
      onClick: () => {
        if (!ensureNpcFeeAvailable(npc, rerollFee, "再抽選できません")) return;
        if (rerollFee > 0) spendMoney(rerollFee);
        closeModal();
        showRuleLottery(npc, { initial: false });
      }
    },
    {
      label: `鍵探知機：${pending.lockDetectorUsed ? "ON" : "OFF"}（所持${lockOwned}）`,
      className: `ghost item-use-button ${pending.lockDetectorUsed ? "active" : ""}`,
      disabled: !pending.lockDetectorUsed && lockOwned <= 0,
      onClick: () => {
        const result = toggleBattlePrepItem("lock_detector", npc.id);
        if (!result.ok) {
          showModal("アイテム設定", `<p>${escapeHtml(result.message)}</p>`, [{ label: "閉じる", onClick: reopenWithSameRules }]);
          return;
        }
        reopenWithSameRules();
      }
    },
    {
      label: `奇跡の御守り：${pending.miracleCharmUsed ? "ON" : "OFF"}（所持${charmOwned}）`,
      className: `ghost item-use-button ${pending.miracleCharmUsed ? "active" : ""}`,
      disabled: !pending.miracleCharmUsed && charmOwned <= 0,
      onClick: () => {
        const result = toggleBattlePrepItem("miracle_charm", npc.id);
        if (!result.ok) {
          showModal("アイテム設定", `<p>${escapeHtml(result.message)}</p>`, [{ label: "閉じる", onClick: reopenWithSameRules }]);
          return;
        }
        reopenWithSameRules();
      }
    }
  ];

  const effectiveRareRate = Math.min(100, getRareChanceRate(npc) * (pending.miracleCharmUsed ? 2 : 1));
  showModal(
    "追加ルール抽選",
    `
      <p><strong>${escapeHtml(npc.name)}</strong>との対戦では、追加ルールが自動で決まります。</p>
      <p class="rule-result-text">追加ルールは <strong>${escapeHtml(getRuleSummary(rules))}</strong> です。</p>
      ${getRuleDescriptionHtml(rules)}
      <div class="battle-item-status">
        <strong>使用アイテム</strong><br>
        鍵探知機：${pending.lockDetectorUsed ? "ON（対戦開始時に使用。ロックマスがなければ消費しません）" : "OFF"}<br>
        奇跡の御守り：${pending.miracleCharmUsed ? `ON（対戦開始時に使用。レアチャンス ${getRareChanceRate(npc)}% → ${effectiveRareRate}%）` : "OFF"}
      </div>
      <p class="muted">挑戦料${formatMoney(getNpcEntryFee(npc))}は支払い済みです。</p>
      <p class="muted">再抽選には挑戦料の半額 ${formatMoney(rerollFee)} が必要です。再抽選料は返金されません。</p>
      <p class="muted">勝利報酬：${formatMoney(getNpcWinMoney(npc))}</p>
    `,
    actions
  );
}

function prepareBattleStart(npcId) {
  const npc = npcById.get(npcId);
  if (!npc) return;
  state.pendingNpcItems = {
    npcId: npc.id,
    lockDetectorUsed: false,
    miracleCharmUsed: false
  };
  if (npc.difficulty === "よわい") {
    showWeakRuleSelection(npc);
  } else {
    showRuleLottery(npc);
  }
}



function getDeckCardsForOnlineRules(ruleIds = []) {
  const deckIndex = getDeckIndexForRules(ruleIds);
  const deck = state.save.decks[deckIndex] ?? [];
  const error = validateDeck(deck, { maxRarity: getDeckRarityLimitByIndex(deckIndex), deckLabel: getDeckDisplayName(deckIndex) });
  if (error) return { error, cards: [], deckIndex };
  return { error: "", cards: deck.map((id) => cardById.get(id)).filter(Boolean), deckIndex };
}

function getActiveDeckCardsForOnline() {
  return getDeckCardsForOnlineRules([]);
}

function getRandomRoomId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i += 1) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

async function ensureOnlineFirebase() {
  if (state.online.firebase) return state.online.firebase;

  const configModule = await import("./firebase-config.js");
  const firebaseConfig = configModule.firebaseConfig ?? {};
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey.includes("ここに")) {
    throw new Error("Firebase設定が未入力です。firebase-config.js にFirebase Webアプリの設定値を入力してください。");
  }

  const appModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js");
  const authModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js");
  const dbModule = await import("https://www.gstatic.com/firebasejs/10.12.5/firebase-database.js");

  const firebaseApp = appModule.initializeApp(firebaseConfig);
  const auth = authModule.getAuth(firebaseApp);
  await authModule.signInAnonymously(auth);
  const db = dbModule.getDatabase(firebaseApp);

  state.online.firebase = {
    app: firebaseApp,
    auth,
    db,
    uid: auth.currentUser.uid,
    ref: dbModule.ref,
    get: dbModule.get,
    set: dbModule.set,
    update: dbModule.update,
    onValue: dbModule.onValue,
    off: dbModule.off,
    remove: dbModule.remove
  };
  return state.online.firebase;
}

function renderOnlineBattleScreen(message = "") {
  const activeDeck = state.save.deckNames?.[state.save.activeDeckIndex] ?? `デッキ${state.save.activeDeckIndex + 1}`;
  const activeDeckLabel = $("onlineActiveDeckLabel");
  if (activeDeckLabel) activeDeckLabel.textContent = activeDeck;
  renderProfileSummary(state.online.cachedProfile);
  refreshProfileSummary();
  const msg = $("onlineBattleMessage");
  if (msg && message) msg.textContent = message;
  updateMoneyDisplays();
}

function detachOnlineRoom() {
  if (typeof state.online.unsubscribe === "function") {
    state.online.unsubscribe();
  }
  state.online.unsubscribe = null;
  state.online.roomId = null;
  state.online.playerKey = null;
  state.online.lastRoomStatus = null;
  state.online.finishedShown = false;
  state.online.ratingApplying = false;
}

function onlineRoomRef(roomId) {
  const fb = state.online.firebase;
  return fb.ref(fb.db, `rooms/${roomId}`);
}

function getIndexedOnlineValue(value, index) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value[index];
  return value[String(index)] ?? value[index];
}

function createEmptyOnlineBoardData() {
  return Object.fromEntries(Array.from({ length: 9 }, (_, index) => [index, { empty: true }]));
}

function serializeOnlineBoardForFirebase() {
  const board = state.battle?.board ?? [];
  return Object.fromEntries(Array.from({ length: 9 }, (_, index) => {
    const cell = board[index];
    return [index, cell ? {
      cardId: cell.card.id,
      owner: localToCanonicalOwner(cell.owner),
      battleValues: cell.card?.battleValues ?? null,
      locked: Boolean(cell.locked)
    } : { empty: true }];
  }));
}

function normalizeOnlineBoardData(boardData) {
  return Array.from({ length: 9 }, (_, index) => {
    const cell = getIndexedOnlineValue(boardData, index);
    if (!cell || cell.empty || !cell.cardId) return null;
    const card = cloneCardForBattle(cardById.get(cell.cardId), cell.battleValues ?? null);
    if (!card) return null;
    return {
      card,
      owner: canonicalToLocalOwner(cell.owner),
      locked: Boolean(cell.locked)
    };
  });
}

function serializeOnlineHandUsedForFirebase(handOrCards) {
  return Object.fromEntries((handOrCards ?? []).map((entry, index) => [
    index,
    Boolean(entry?.used ?? false)
  ]));
}

function createOnlineHandUsedData(cards) {
  return Object.fromEntries((cards ?? []).map((_, index) => [index, false]));
}

function normalizeOnlineHandUsedData(handUsed, length) {
  return Array.from({ length }, (_, index) => Boolean(getIndexedOnlineValue(handUsed, index)));
}

function getOnlinePlayerName(playerKey, room = null) {
  return room?.players?.[playerKey]?.name ?? (playerKey === "p1" ? "プレイヤー1" : "プレイヤー2");
}

function buildOnlineRoom(roomId, deckCards, rules = rollOnlineAdditionalRules()) {
  return {
    version: VERSION,
    roomId,
    status: "waiting",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    rules,
    board: createEmptyOnlineBoardData(),
    turn: null,
    firstTurn: null,
    winner: null,
    result: null,
    typeBoosts: Object.fromEntries(CARD_TYPES.map((type) => [type, 0])),
    players: {
      p1: {
        uid: state.online.firebase.uid,
        name: getOnlineUserName() || "プレイヤー1",
        rating: Number(state.online.cachedProfile?.rating ?? getDefaultOnlineRating()),
        deck: deckCards.map((card) => card.id),
        handUsed: createOnlineHandUsedData(deckCards),
        wildMods: hasRule("wild_card", { rules }) ? generateWildCardMods(deckCards) : {}
      }
    }
  };
}

async function createOnlineRoom() {
  if (!requireOnlineUserName()) return;
  const rules = rollOnlineAdditionalRules();
  const { error, cards, deckIndex } = getDeckCardsForOnlineRules(rules);
  if (error) {
    showModal("デッキ確認", `<p>${escapeHtml(error)}</p><p>オンライン対戦に使う${escapeHtml(getDeckDisplayName(deckIndex))}を5枚で作成してください。</p>`, [
      { label: "デッキへ", onClick: () => { closeModal(); state.selectedDeckIndex = deckIndex; showScreen("deck"); } },
      { label: "閉じる", className: "ghost", onClick: closeModal }
    ]);
    return;
  }

  try {
    const fb = await ensureOnlineFirebase();
    state.online.cachedProfile = await syncPlayerRankings();
    detachOnlineRoom();
    let roomId = getRandomRoomId();
    let roomSnap = await fb.get(onlineRoomRef(roomId));
    for (let i = 0; roomSnap.exists() && i < 8; i += 1) {
      roomId = getRandomRoomId();
      roomSnap = await fb.get(onlineRoomRef(roomId));
    }
    await fb.set(onlineRoomRef(roomId), buildOnlineRoom(roomId, cards, rules));
    attachOnlineRoom(roomId, "p1");
    $("onlineRoomCode").value = roomId;
    renderOnlineBattleScreen(`部屋を作成しました。部屋番号 ${roomId} を相手に伝えてください。`);
    showModal("部屋作成", `<p>部屋番号：<strong class="room-code-big">${roomId}</strong></p><p>相手が入室すると対戦が始まります。</p>`, [
      { label: "閉じる", className: "ghost", onClick: closeModal }
    ]);
    $("modal").dataset.onlineWaiting = "1";
  } catch (error) {
    console.error(error);
    showModal("オンライン接続エラー", `<p>${escapeHtml(error.message ?? error)}</p>`, [{ label: "閉じる", onClick: closeModal }]);
  }
}

async function joinOnlineRoom() {
  if (!requireOnlineUserName()) return;
  const roomId = String($("onlineRoomCode").value ?? "").trim().toUpperCase();
  if (!roomId) {
    renderOnlineBattleScreen("部屋番号を入力してください。");
    return;
  }

  try {
    const fb = await ensureOnlineFirebase();
    state.online.cachedProfile = await syncPlayerRankings();
    detachOnlineRoom();
    const roomRef = onlineRoomRef(roomId);
    const snap = await fb.get(roomRef);
    if (!snap.exists()) throw new Error("指定された部屋が見つかりません。");
    const room = snap.val();
    if (room.status !== "waiting" || room.players?.p2) throw new Error("この部屋には入室できません。すでに対戦が始まっている可能性があります。");
    const { error, cards, deckIndex } = getDeckCardsForOnlineRules(room.rules ?? []);
    if (error) {
      showModal("デッキ確認", `<p>${escapeHtml(error)}</p><p>この部屋の追加ルールでは${escapeHtml(getDeckDisplayName(deckIndex))}が必要です。</p>`, [
        { label: "デッキへ", onClick: () => { closeModal(); state.selectedDeckIndex = deckIndex; showScreen("deck"); } },
        { label: "閉じる", className: "ghost", onClick: closeModal }
      ]);
      return;
    }

    const firstTurn = Math.random() < 0.5 ? "p1" : "p2";
    await fb.update(roomRef, {
      status: "playing",
      updatedAt: Date.now(),
      turn: firstTurn,
      firstTurn,
      "players/p2": {
        uid: fb.uid,
        name: getOnlineUserName() || "プレイヤー2",
        rating: Number(state.online.cachedProfile?.rating ?? getDefaultOnlineRating()),
        deck: cards.map((card) => card.id),
        handUsed: createOnlineHandUsedData(cards),
        wildMods: hasRule("wild_card", { rules: room.rules ?? [] }) ? generateWildCardMods(cards) : {}
      }
    });
    attachOnlineRoom(roomId, "p2");
    renderOnlineBattleScreen(`部屋 ${roomId} に入室しました。`);
  } catch (error) {
    console.error(error);
    showModal("オンライン接続エラー", `<p>${escapeHtml(error.message ?? error)}</p>`, [{ label: "閉じる", onClick: closeModal }]);
  }
}


function onlineMatchmakingRef(uid = null) {
  const fb = state.online.firebase;
  return fb.ref(fb.db, uid ? `matchmaking/waiting/${uid}` : "matchmaking/waiting");
}

function getRandomOnlineNpcSpecs() {
  return [
    { id: "online_npc_1", name: "ランダムNPC1", difficulty: "よわい", rating: 1000, pattern: [{ rarity: 1, count: 2 }, { rarity: 2, count: 2 }, { rarity: 3, count: 1 }] },
    { id: "online_npc_2", name: "ランダムNPC2", difficulty: "ふつう", rating: 1500, pattern: [{ rarity: 2, count: 2 }, { rarity: 3, count: 2 }, { rarity: 4, count: 1 }] },
    { id: "online_npc_3", name: "ランダムNPC3", difficulty: "つよい", rating: 2000, pattern: [{ rarity: 3, count: 2 }, { rarity: 4, count: 2 }, { rarity: 5, count: 1 }] }
  ];
}

function buildRandomOnlineNpcHand(spec, ruleIds = []) {
  const maxRarity = getLittleRuleMaxRarity(ruleIds);
  if (maxRarity) return sample(CARDS.filter((card) => card.rarity <= maxRarity), 5);
  const result = [];
  const used = new Set();
  for (const part of spec.pattern) {
    const candidates = shuffle(CARDS.filter((card) => card.rarity === part.rarity && !used.has(card.id)));
    for (const card of candidates.slice(0, part.count)) {
      result.push(card);
      used.add(card.id);
    }
  }
  while (result.length < 5) {
    const card = sample(CARDS.filter((item) => !used.has(item.id)), 1)[0];
    if (!card) break;
    result.push(card);
    used.add(card.id);
  }
  return result.slice(0, 5);
}

async function startRandomOnlineMatch() {
  if (!requireOnlineUserName()) return;
  try {
    const fb = await ensureOnlineFirebase();
    state.online.cachedProfile = await syncPlayerRankings();
    const myUid = fb.uid;
    const now = Date.now();
    detachOnlineRoom();
    renderOnlineBattleScreen("ランダムマッチを検索しています。最大30秒待機します。");
    const waitingSnap = await fb.get(onlineMatchmakingRef());
    const waitingData = waitingSnap.exists() ? waitingSnap.val() : {};
    const opponentEntry = Object.entries(waitingData).find(([uid, ticket]) => uid !== myUid && ticket && now - Number(ticket.createdAt ?? 0) < 30000);
    if (opponentEntry) {
      const [opponentUid, ticket] = opponentEntry;
      const rules = sanitizeRuleIds(ticket.rules ?? rollOnlineAdditionalRules());
      const myDeck = getDeckCardsForOnlineRules(rules);
      if (myDeck.error) {
        showModal("デッキ確認", `<p>${escapeHtml(myDeck.error)}</p><p>ランダムマッチの追加ルールでは${escapeHtml(getDeckDisplayName(myDeck.deckIndex))}が必要です。</p>`, [
          { label: "デッキへ", onClick: () => { closeModal(); state.selectedDeckIndex = myDeck.deckIndex; showScreen("deck"); } },
          { label: "閉じる", className: "ghost", onClick: closeModal }
        ]);
        return;
      }
      const opponentDeckIds = ticket.deck ?? [];
      const roomId = getRandomRoomId();
      const firstTurn = Math.random() < 0.5 ? "p1" : "p2";
      const room = {
        version: VERSION,
        roomId,
        status: "playing",
        createdAt: now,
        updatedAt: now,
        rules,
        board: createEmptyOnlineBoardData(),
        turn: firstTurn,
        firstTurn,
        winner: null,
        result: null,
        players: {
          p1: { uid: opponentUid, name: ticket.name || "プレイヤー1", rating: Number(ticket.rating ?? 1500), deck: opponentDeckIds, handUsed: createOnlineHandUsedData(opponentDeckIds), wildMods: ticket.wildMods ?? {} },
          p2: { uid: myUid, name: getOnlineUserName() || "プレイヤー2", rating: Number(state.online.cachedProfile?.rating ?? 1500), deck: myDeck.cards.map((card) => card.id), handUsed: createOnlineHandUsedData(myDeck.cards), wildMods: hasRule("wild_card", { rules }) ? generateWildCardMods(myDeck.cards) : {} }
        }
      };
      await fb.set(onlineRoomRef(roomId), room);
      await fb.update(fb.ref(fb.db), {
        [`matchmaking/waiting/${opponentUid}/matchedRoomId`]: roomId,
        [`matchmaking/waiting/${opponentUid}/matchedAt`]: now,
        [`matchmaking/waiting/${myUid}`]: null
      });
      attachOnlineRoom(roomId, "p2");
      return;
    }

    const rules = rollOnlineAdditionalRules();
    const deckData = getDeckCardsForOnlineRules(rules);
    if (deckData.error) {
      showModal("デッキ確認", `<p>${escapeHtml(deckData.error)}</p><p>ランダムマッチの追加ルールでは${escapeHtml(getDeckDisplayName(deckData.deckIndex))}が必要です。</p>`, [
        { label: "デッキへ", onClick: () => { closeModal(); state.selectedDeckIndex = deckData.deckIndex; showScreen("deck"); } },
        { label: "閉じる", className: "ghost", onClick: closeModal }
      ]);
      return;
    }
    await fb.set(onlineMatchmakingRef(myUid), {
      uid: myUid,
      name: getOnlineUserName() || "プレイヤー1",
      rating: Number(state.online.cachedProfile?.rating ?? 1500),
      deck: deckData.cards.map((card) => card.id),
      wildMods: hasRule("wild_card", { rules }) ? generateWildCardMods(deckData.cards) : {},
      rules,
      createdAt: now,
      matchedRoomId: null
    });
    const deadline = Date.now() + 30000;
    showModal("ランダムマッチ待機", "<p>対戦相手を探しています。</p><p>30秒以内に見つからない場合はランダムNPCと対戦します。</p>", [
      { label: "キャンセル", className: "ghost", onClick: async () => { try { await fb.remove(onlineMatchmakingRef(myUid)); } catch {} closeModal(); renderOnlineBattleScreen("ランダムマッチをキャンセルしました。"); } }
    ]);
    const timer = setInterval(async () => {
      try {
        const snap = await fb.get(onlineMatchmakingRef(myUid));
        const ticket = snap.exists() ? snap.val() : null;
        if (ticket?.matchedRoomId) {
          clearInterval(timer);
          closeModal();
          attachOnlineRoom(ticket.matchedRoomId, "p1");
          setTimeout(() => fb.remove(onlineMatchmakingRef(myUid)).catch(() => {}), 3000);
          return;
        }
        if (Date.now() >= deadline) {
          clearInterval(timer);
          await fb.remove(onlineMatchmakingRef(myUid));
          closeModal();
          startOnlineRandomNpcBattle();
        }
      } catch (error) {
        clearInterval(timer);
        closeModal();
        showModal("ランダムマッチエラー", `<p>${escapeHtml(error.message ?? error)}</p>`, [{ label: "閉じる", onClick: closeModal }]);
      }
    }, 1200);
  } catch (error) {
    showModal("ランダムマッチエラー", `<p>${escapeHtml(error.message ?? error)}</p>`, [{ label: "閉じる", onClick: closeModal }]);
  }
}

async function startOnlineRandomNpcBattle() {
  const specs = getRandomOnlineNpcSpecs();
  const spec = sample(specs, 1)[0];
  const rules = rollOnlineAdditionalRules();
  const deckData = getDeckCardsForOnlineRules(rules);
  if (deckData.error) {
    showModal("デッキ確認", `<p>${escapeHtml(deckData.error)}</p><p>ランダムNPC戦の追加ルールでは${escapeHtml(getDeckDisplayName(deckData.deckIndex))}が必要です。</p>`, [
      { label: "デッキへ", onClick: () => { closeModal(); state.selectedDeckIndex = deckData.deckIndex; showScreen("deck"); } },
      { label: "閉じる", className: "ghost", onClick: closeModal }
    ]);
    return;
  }
  let npcHandCards = buildRandomOnlineNpcHand(spec, rules);
  let playerCards = deckData.cards;
  if (rules.includes("wild_card")) {
    const wild = setupWildCardForHands(playerCards, npcHandCards, { rules });
    playerCards = wild.playerCards;
    npcHandCards = wild.npcCards;
  }
  const firstTurn = Math.random() < 0.5 ? "player" : "npc";
  state.battle = {
    mode: "onlineNpc",
    npc: { id: spec.id, name: spec.name, difficulty: spec.difficulty, onlineNpcRating: spec.rating },
    rules,
    playerHand: playerCards.map((card) => ({ card, used: false })),
    npcHand: npcHandCards.map((card) => ({ card, used: false })),
    npcBattleCards: npcHandCards,
    board: Array(9).fill(null),
    currentTurn: firstTurn,
    locked: false,
    finished: false,
    forcedPlayerHandIndex: null,
    forcedNpcHandIndex: null,
    entryFee: 0,
    winMoney: 0,
    fieldEffects: createFieldEffectsForBattle({ difficulty: spec.difficulty }),
    lockCells: createLockCellsForBattle({ difficulty: spec.difficulty })
  };
  state.selectedHandIndex = null;
  showScreen("battle");
  $("battleNpcName").textContent = `ランダムマッチ / ${spec.name}`;
  $("battleLog").innerHTML = "";
  initPixi();
  addBattleLog(`ランダムNPC戦を開始しました。相手レート相当：${spec.rating}`);
  addBattleLog(`追加ルール：${getRuleSummary(rules)}`);
  prepareTurn(firstTurn);
  renderBattleAll();
  if (firstTurn === "npc") setTimeout(() => npcTurn(), 550);
}

function attachOnlineRoom(roomId, playerKey) {
  const fb = state.online.firebase;
  state.online.roomId = roomId;
  state.online.playerKey = playerKey;
  state.online.finishedShown = false;
  const roomRef = onlineRoomRef(roomId);
  state.online.unsubscribe = fb.onValue(roomRef, (snapshot) => {
    if (!snapshot.exists()) {
      if (state.battle?.mode === "online") {
        showModal("部屋終了", "<p>オンライン対戦の部屋が終了しました。</p>", [
          { label: "オンライン対戦へ", onClick: () => { closeModal(); showScreen("onlineBattle"); } }
        ]);
      }
      detachOnlineRoom();
      return;
    }
    try {
      applyOnlineRoom(snapshot.val());
    } catch (error) {
      console.error("online room apply error", error);
      renderOnlineBattleScreen(`オンライン同期エラー：${error.message ?? error}`);
    }
  });
}

function canonicalToLocalOwner(owner) {
  return owner === state.online.playerKey ? "player" : "npc";
}

function localToCanonicalOwner(owner) {
  if (owner === "player") return state.online.playerKey;
  return state.online.playerKey === "p1" ? "p2" : "p1";
}

function getOpponentKey() {
  return state.online.playerKey === "p1" ? "p2" : "p1";
}


function calcOnlineResult(room) {
  const playerKey = state.online.playerKey;
  const opponentKey = getOpponentKey();
  const score = calcScore();
  let winner = "draw";
  if (score.player > score.npc) winner = playerKey;
  if (score.player < score.npc) winner = opponentKey;
  return {
    winner,
    score: {
      [playerKey]: score.player,
      [opponentKey]: score.npc
    }
  };
}

function applyOnlineRoom(room) {
  const playerKey = state.online.playerKey;
  const opponentKey = getOpponentKey();
  const player = room.players?.[playerKey];
  const opponent = room.players?.[opponentKey];

  if (!player) return;
  if (room.status === "waiting" || !opponent) {
    renderOnlineBattleScreen(`部屋番号 ${room.roomId}：相手の入室待ちです。`);
    return;
  }

  if ($("modal")?.dataset.onlineWaiting === "1" || $("modal")?.dataset.onlineRematchWaiting === "1") {
    closeModal();
  }
  if (room.status === "playing") state.online.finishedShown = false;

  const playerDeck = player.deck ?? [];
  const opponentDeck = opponent.deck ?? [];
  const playerUsed = normalizeOnlineHandUsedData(player.handUsed, playerDeck.length);
  const opponentUsed = normalizeOnlineHandUsedData(opponent.handUsed, opponentDeck.length);

  const playerCards = applyWildCardModsToCards(playerDeck.map((cardId) => cardById.get(cardId)).filter(Boolean), player.wildMods ?? {});
  const opponentCards = applyWildCardModsToCards(opponentDeck.map((cardId) => cardById.get(cardId)).filter(Boolean), opponent.wildMods ?? {});

  const playerHand = playerCards.map((card, index) => ({
    card,
    used: playerUsed[index]
  })).filter((entry) => entry.card);

  const opponentHand = opponentCards.map((card, index) => ({
    card,
    used: opponentUsed[index]
  })).filter((entry) => entry.card);

  const board = normalizeOnlineBoardData(room.board);

  const wasNotPlaying = !state.battle || state.battle.mode !== "online" || state.battle.onlineRoomId !== room.roomId || (state.battle.finished && room.status === "playing");
  if (wasNotPlaying && room.status === "playing") state.selectedHandIndex = null;

  state.battle = {
    mode: "online",
    onlineRoomId: room.roomId,
    playerKey,
    npc: { id: "online", name: getOnlinePlayerName(opponentKey, room), difficulty: "オンライン" },
    rules: room.rules ?? [],
    playerHand,
    npcHand: opponentHand,
    npcBattleCards: [],
    board,
    currentTurn: room.status === "finished" ? "finished" : room.turn === playerKey ? "player" : "npc",
    locked: room.status !== "playing" || room.turn !== playerKey,
    finished: room.status === "finished",
    forcedPlayerHandIndex: null,
    forcedNpcHandIndex: null,
    typeBoosts: room.typeBoosts ?? Object.fromEntries(CARD_TYPES.map((type) => [type, 0])),
    entryFee: 0,
    winMoney: 0
  };

  if (wasNotPlaying) {
    showScreen("battle");
    $("battleLog").innerHTML = "";
    initPixi();
    addBattleLog(`オンライン対戦：部屋 ${room.roomId}`);
    addBattleLog(`あなたは${getOnlinePlayerName(playerKey, room)}です。`);
    addBattleLog(`追加ルール：${getRuleSummary(room.rules ?? [])}`);
    addBattleLog(`先攻：${getOnlinePlayerName(room.firstTurn, room)}`);
  }

  $("battleNpcName").textContent = `オンライン対戦 / ${getOnlinePlayerName(playerKey, room)}`;
  renderBattleAll();

  if (room.status === "playing") {
    const turnText = room.turn === playerKey ? "あなたのターンです。" : "相手のターンです。";
    $("turnLabel").textContent = turnText;
  }

  if (room.status === "finished" && !room.ratingApplied && state.online.playerKey === "p1") {
    applyOnlineRatingIfNeeded(room);
  }

  if (room.status === "finished" && !state.online.finishedShown) {
    if (!room.ratingApplied && !room.ratingError) {
      $("turnLabel").textContent = "レート集計中です。";
      return;
    }
    state.online.finishedShown = true;
    showOnlineResult(room);
  }
}

function showOnlineResult(room) {
  const playerKey = state.online.playerKey;
  const result = room.result ?? {};
  const myScore = result.score?.[playerKey] ?? calcScore().player;
  const opponentScore = result.score?.[getOpponentKey()] ?? calcScore().npc;
  const title = result.winner === "draw" ? "引き分け" : result.winner === playerKey ? "勝利" : "敗北";
  const rating = room.ratingChange?.[playerKey];
  const ratingHtml = rating
    ? `<p>レート：${rating.old} → <strong>${rating.new}</strong>（${rating.diff >= 0 ? "+" : ""}${rating.diff}）</p>`
    : `<p>レート：集計中、または反映できませんでした。</p>`;
  showModal(
    `オンライン対戦：${title}`,
    `<p>オンライン対戦は報酬なしです。</p><p>スコア：自分 ${myScore} - ${opponentScore} 相手</p>${ratingHtml}`,
    [
      finalBoardAction(),
      { label: "もう一度対戦する", onClick: () => { closeModal(); requestOnlineRematch(); } },
      { label: "オンライン対戦へ", onClick: () => { closeModal(); detachOnlineRoom(); state.battle = null; showScreen("onlineBattle"); } },
      { label: "ランキングを見る", className: "ghost", onClick: () => { closeModal(); detachOnlineRoom(); state.battle = null; showScreen("rankings"); } },
      { label: "タイトルへ戻る", className: "ghost", onClick: () => { closeModal(); detachOnlineRoom(); state.battle = null; showScreen("title"); } }
    ]
  );
}

async function startOnlineRematch(room) {
  const fb = await ensureOnlineFirebase();
  const roomId = room.roomId;
  const p1Deck = room.players?.p1?.deck ?? [];
  const p2Deck = room.players?.p2?.deck ?? [];
  const firstTurn = Math.random() < 0.5 ? "p1" : "p2";
  await fb.update(onlineRoomRef(roomId), {
    status: "playing",
    updatedAt: Date.now(),
    board: createEmptyOnlineBoardData(),
    turn: firstTurn,
    firstTurn,
    winner: null,
    result: null,
    ratingApplied: null,
    ratingError: null,
    ratingChange: null,
    rules: room.rules ?? [],
    typeBoosts: Object.fromEntries(CARD_TYPES.map((type) => [type, 0])),
    "players/p1/handUsed": createOnlineHandUsedData(p1Deck),
    "players/p2/handUsed": createOnlineHandUsedData(p2Deck),
    "players/p1/wildMods": hasRule("wild_card", { rules: room.rules ?? [] }) ? generateWildCardMods((p1Deck ?? []).map((id) => cardById.get(id)).filter(Boolean)) : {},
    "players/p2/wildMods": hasRule("wild_card", { rules: room.rules ?? [] }) ? generateWildCardMods((p2Deck ?? []).map((id) => cardById.get(id)).filter(Boolean)) : {},
    "players/p1/rematchReady": false,
    "players/p2/rematchReady": false
  });
}

async function requestOnlineRematch() {
  const roomId = state.online.roomId;
  const playerKey = state.online.playerKey;
  if (!roomId || !playerKey) {
    showScreen("onlineBattle");
    return;
  }
  try {
    const fb = await ensureOnlineFirebase();
    const currentSnap = await fb.get(onlineRoomRef(roomId));
    const currentRoom = currentSnap.exists() ? currentSnap.val() : null;
    const { error, cards, deckIndex } = getDeckCardsForOnlineRules(currentRoom?.rules ?? []);
    if (error) {
      showModal("デッキ確認", `<p>${escapeHtml(error)}</p><p>再戦には${escapeHtml(getDeckDisplayName(deckIndex))}が必要です。</p>`, [
        { label: "デッキへ", onClick: () => { closeModal(); state.selectedDeckIndex = deckIndex; showScreen("deck"); } },
        { label: "閉じる", className: "ghost", onClick: closeModal }
      ]);
      return;
    }
    await fb.update(onlineRoomRef(roomId), {
      [`players/${playerKey}/deck`]: cards.map((card) => card.id),
      [`players/${playerKey}/handUsed`]: createOnlineHandUsedData(cards),
      [`players/${playerKey}/rematchReady`]: true,
      updatedAt: Date.now()
    });
    const snap = await fb.get(onlineRoomRef(roomId));
    const room = snap.exists() ? snap.val() : null;
    if (room?.players?.p1?.rematchReady && room?.players?.p2?.rematchReady) {
      await startOnlineRematch(room);
      return;
    }
    showModal("再戦待機", "<p>再戦希望を送信しました。</p><p>相手も「もう一度対戦する」を押すと再戦が始まります。</p>", [
      { label: "閉じる", className: "ghost", onClick: closeModal }
    ]);
    $("modal").dataset.onlineRematchWaiting = "1";
  } catch (error) {
    showModal("再戦エラー", `<p>${escapeHtml(error.message ?? error)}</p>`, [{ label: "閉じる", onClick: closeModal }]);
  }
}

async function handleOnlineBoardClick(index) {
  const battle = state.battle;
  if (!battle || battle.mode !== "online" || battle.locked || battle.finished || battle.currentTurn !== "player") return;
  if (battle.board[index]) return;

  const handIndex = state.selectedHandIndex;
  if (handIndex === null) {
    addBattleLog("手札を1枚選択してください。");
    return;
  }
  const hand = battle.playerHand[handIndex];
  if (!hand || hand.used) return;

  battle.locked = true;
  await playCard("player", handIndex, index);
  state.selectedHandIndex = null;

  const boardFull = battle.board.every(Boolean);
  const noPlayableCards = battle.playerHand.every((entry) => entry.used) && battle.npcHand.every((entry) => entry.used);
  const finished = boardFull || noPlayableCards;
  const opponentKey = getOpponentKey();
  const updates = {
    board: serializeOnlineBoardForFirebase(),
    updatedAt: Date.now(),
    [`players/${state.online.playerKey}/handUsed`]: serializeOnlineHandUsedForFirebase(battle.playerHand),
    turn: finished ? null : opponentKey,
    status: finished ? "finished" : "playing",
    typeBoosts: battle.typeBoosts ?? {}
  };
  if (finished) {
    updates.result = calcOnlineResult();
    updates.winner = updates.result.winner;
  }

  try {
    const fb = await ensureOnlineFirebase();
    await fb.update(onlineRoomRef(state.online.roomId), updates);
  } catch (error) {
    console.error(error);
    addBattleLog(`オンライン同期エラー：${error.message ?? error}`);
    battle.locked = false;
  }
}

function confirmOnlineExit(destination = "onlineBattle") {
  const battle = state.battle;
  if (!battle || battle.mode !== "online" || battle.finished) {
    detachOnlineRoom();
    state.battle = null;
    showScreen(destination === "title" ? "title" : "onlineBattle");
    return;
  }

  showModal(
    "オンライン対戦を終了",
    "<p>対戦中に終了すると、この端末は部屋から退出します。</p><p>オンライン対戦は報酬なしです。</p>",
    [
      {
        label: "退出する",
        className: "danger",
        onClick: async () => {
          try {
            const fb = await ensureOnlineFirebase();
            if (state.online.roomId) await fb.remove(onlineRoomRef(state.online.roomId));
          } catch (error) {
            console.warn(error);
          }
          closeModal();
          detachOnlineRoom();
          state.battle = null;
          showScreen(destination === "title" ? "title" : "onlineBattle");
        }
      },
      { label: "キャンセル", className: "ghost", onClick: closeModal }
    ]
  );
}
async function startBattle(npcId, selectedRules = null, options = {}) {
  const npc = npcById.get(npcId);
  if (!npc) return;
  if (!isNpcUnlocked(npc)) {
    showModal("未解放", `<p>${escapeHtml(npc.name)}はまだ解放されていません。</p><p>${escapeHtml(getNpcUnlockMessage())}</p>`, [
      { label: "閉じる", onClick: closeModal }
    ]);
    return;
  }
  if (selectedRules === null) {
    prepareBattleStart(npcId);
    return;
  }
  selectedRules = sanitizeRuleIds(selectedRules);
  const deckIndex = getDeckIndexForRules(selectedRules);
  const deck = state.save.decks[deckIndex] ?? [];
  const deckLimit = getDeckRarityLimitByIndex(deckIndex);
  const error = validateDeck(deck, { maxRarity: deckLimit, deckLabel: getDeckDisplayName(deckIndex) });
  if (error) {
    showModal("デッキ確認", `<p>${escapeHtml(error)}</p><p>${escapeHtml(getDeckDisplayName(deckIndex))}を5枚で作成してください。</p>`, [
      { label: "デッキへ", onClick: () => { closeModal(); state.selectedDeckIndex = deckIndex; showScreen("deck"); } },
      { label: "閉じる", className: "ghost", onClick: closeModal }
    ]);
    return;
  }

  if (selectedRules.includes("reverse") && selectedRules.includes("ace_killer")) {
    showModal("ルール確認", "<p>リバースとエースキラーは同時に選択できません。</p>", [{ label: "閉じる", onClick: closeModal }]);
    return;
  }
  if (selectedRules.includes("order") && selectedRules.includes("chaos")) {
    showModal("ルール確認", "<p>オーダーとカオスは同時に選択できません。</p>", [{ label: "閉じる", onClick: closeModal }]);
    return;
  }

  const entryFee = getNpcEntryFee(npc);
  if (!options.entryFeePaid) {
    // 直接開始経路が残っていた場合の安全策。通常は追加ルール表示時に支払い済み。
    if (!chargeNpcChallengeFee(npc)) return;
  }

  const pendingItems = state.pendingNpcItems?.npcId === npc.id
    ? { ...state.pendingNpcItems }
    : { npcId: npc.id, lockDetectorUsed: false, miracleCharmUsed: false };

  // 怪忌蝶覚醒はNPC対戦だけで有効。オンライン対戦は常に元の数値を使用する。
  const playerBattleDeck = deck.map((id) => cardById.get(id)).filter(Boolean).map((card) => applyAwakeningToCard(card));
  const npcDeck = buildNpcHand(npc, selectedRules);
  let playerHandCards = [...playerBattleDeck];
  let npcHandCards = [...npcDeck];
  let swapInfo = null;

  if (selectedRules.includes("swap") && playerHandCards.length && npcHandCards.length) {
    const playerIndex = Math.floor(Math.random() * playerHandCards.length);
    const npcIndex = Math.floor(Math.random() * npcHandCards.length);
    swapInfo = {
      playerIndex,
      npcIndex,
      playerCard: playerHandCards[playerIndex],
      npcCard: npcHandCards[npcIndex]
    };
    [playerHandCards[playerIndex], npcHandCards[npcIndex]] = [npcHandCards[npcIndex], playerHandCards[playerIndex]];
  }

  // スワップ後、実際に修羅NPCが使用する5枚だけを強化する。
  npcHandCards = applyShuraEnhancementsToNpcHand(npcHandCards, npc);

  const preBattleForRules = { rules: selectedRules };
  if (selectedRules.includes("wild_card")) {
    const wild = setupWildCardForHands(playerHandCards, npcHandCards, preBattleForRules);
    playerHandCards = wild.playerCards;
    npcHandCards = wild.npcCards;
  }

  const lockCells = createLockCellsForBattle(npc);
  const finalizedItems = finalizeBattlePrepItems(pendingItems, lockCells);

  state.battle = {
    npc,
    rules: selectedRules,
    playerHand: playerHandCards.map((card) => ({ card, used: false })),
    npcHand: npcHandCards.map((card) => ({ card, used: false })),
    npcBattleCards: npcDeck,
    board: Array(9).fill(null),
    currentTurn: "coin",
    locked: true,
    finished: false,
    forcedPlayerHandIndex: null,
    forcedNpcHandIndex: null,
    typeBoosts: Object.fromEntries(CARD_TYPES.map((type) => [type, 0])),
    fieldEffects: createFieldEffectsForBattle(npc),
    lockCells,
    revealLockCells: finalizedItems.lockDetectorConsumed,
    rareChanceMultiplier: finalizedItems.miracleCharmConsumed ? 2 : 1,
    usedBattleItems: {
      lockDetector: finalizedItems.lockDetectorConsumed,
      miracleCharm: finalizedItems.miracleCharmConsumed
    },
    battleItemResult: finalizedItems,
    entryFee,
    winMoney: getNpcWinMoney(npc),
    swapInfo,
    kaijutsu: {
      id: getDeckKaijutsuId(deckIndex),
      used: false,
      pending: false,
      targetHandIndex: null,
      targetMode: null
    }
  };
  state.pendingNpcItems = {
    npcId: null,
    lockDetectorUsed: false,
    miracleCharmUsed: false
  };
  const battleToken = state.battle;
  state.selectedHandIndex = null;

  showScreen("battle");
  $("battleNpcName").textContent = `${npc.name} / ${npc.difficulty}`;
  $("battleLog").innerHTML = "";
  addBattleLog(`${npc.name}との対戦を開始しました。`);
  addBattleLog(`挑戦料${formatMoney(entryFee)}は追加ルール決定時に支払い済みです。敗北・棄権時は返金されません。`);
  addBattleLog(`勝利報酬：${formatMoney(getNpcWinMoney(npc))}`);
  addBattleLog(`追加ルール：${getRuleSummary(selectedRules)}`);
  addBattleLog(`使用デッキ：${getDeckDisplayName(deckIndex)}`);
  const equippedKaijutsu = getKaijutsuSkill(state.battle.kaijutsu.id);
  addBattleLog(`怪異術：${equippedKaijutsu.id === "none" ? "未設定" : equippedKaijutsu.name}`);
  if (isShuraNpc(npc)) addBattleLog("修羅強化：相手の手札5枚にレアリティ別の数値強化が適用されました。炎表示の数字が強化箇所です。");
  const fieldEntries = Object.entries(state.battle.fieldEffects ?? {});
  if (fieldEntries.length) addBattleLog(`フィールド効果：${fieldEntries.length}マスに効果が発生しました。`);
  if (["ふつう", "つよい", "修羅"].includes(npc.difficulty)) {
    if (state.battle.revealLockCells) {
      addBattleLog("鍵探知機：ロックマスの場所を事前に表示します。");
    } else if (state.battle.battleItemResult?.lockDetectorReturned) {
      addBattleLog("鍵探知機：ロックマスがなかったため使用されず、所持数は減りませんでした。");
    } else {
      addBattleLog("ロック：0〜1マスに隠しロックマスが発生する可能性があります。");
    }
  }
  if (state.battle.rareChanceMultiplier > 1) {
    addBattleLog(`奇跡の御守り：レアチャンス率が${getRareChanceRate(npc)}%から${Math.min(100, getRareChanceRate(npc) * state.battle.rareChanceMultiplier)}%になりました。`);
  }
  if (selectedRules.includes("mirror")) addBattleLog("ミラー：場に出たカードは上下・左右の数字が入れ替わります。");
  if (selectedRules.includes("wild_card")) addBattleLog("ワイルドカード：お互いの手札からランダムで1枚ずつ選ばれ、1辺+2、または1辺A・別の1辺1の変化が発生しました。");
  if (swapInfo) addBattleLog(`スワップ：お互いの手札から1枚を交換しました。対戦後に戻ります。`);
  addBattleLog("コイントスで先攻・後攻を決定します。");
  initPixi();
  renderBattleAll();

  [...$("playerHand").children].forEach((child, index) => {
    child.classList.add("animate-draw");
    child.style.animationDelay = `${index * 80}ms`;
  });

  const firstTurn = await runCoinToss();
  if (state.battle !== battleToken) return;

  battleToken.currentTurn = firstTurn;
  prepareTurn(firstTurn);
  battleToken.locked = false;
  addBattleLog(firstTurn === "player" ? "先攻はプレイヤーです。" : `先攻は${npc.name}です。`);
  renderBattleAll();

  if (firstTurn === "npc" && !battleToken.finished) {
    setTimeout(() => npcTurn(), 550);
  }
}

async function runCoinToss() {
  const firstTurn = Math.random() < 0.5 ? "player" : "npc";
  showModal(
    "コイントス",
    `
      <div class="coin-toss-box">
        <div class="coin-toss-coin tossing" aria-label="コイントス">
          <div class="coin-face coin-front"></div>
          <div class="coin-face coin-back"></div>
        </div>
        <p id="coinTossText">コイントス中...</p>
      </div>
    `,
    []
  );

  await delay(1600);

  const coin = document.querySelector(".coin-toss-coin");
  const text = $("coinTossText");
  if (coin) {
    coin.classList.remove("tossing");
    coin.classList.add(firstTurn === "player" ? "coin-player" : "coin-npc");
  }
  if (text) text.textContent = firstTurn === "player" ? "表：プレイヤーが先攻です。" : "裏：相手が先攻です。";

  await delay(900);
  closeModal();
  return firstTurn;
}

function getFirstUnusedHandIndex(hand) {
  return hand.findIndex((entry) => !entry.used);
}

function getRandomUnusedHandIndex(hand) {
  const indexes = hand.map((entry, index) => entry.used ? null : index).filter((index) => index !== null);
  if (!indexes.length) return -1;
  return indexes[Math.floor(Math.random() * indexes.length)];
}

function prepareTurn(owner) {
  const battle = state.battle;
  if (!battle) return;
  const hand = owner === "player" ? battle.playerHand : battle.npcHand;
  const property = owner === "player" ? "forcedPlayerHandIndex" : "forcedNpcHandIndex";
  battle[property] = null;

  if (hasRule("chaos", battle)) {
    battle[property] = getRandomUnusedHandIndex(hand);
  } else if (hasRule("order", battle)) {
    battle[property] = getFirstUnusedHandIndex(hand);
  }

  if (owner === "player") {
    state.selectedHandIndex = battle[property] >= 0 ? battle[property] : null;
  }

  if (battle[property] >= 0) {
    const card = hand[battle[property]]?.card;
    const ruleName = hasRule("chaos", battle) ? "カオス" : "オーダー";
    addBattleLog(`${ruleName}：${owner === "player" ? "プレイヤー" : battle.npc.name}の出すカードは「${card?.name ?? "不明"}」です。`);
  }
}

function getForcedHandIndex(owner) {
  const battle = state.battle;
  if (!battle) return null;
  const value = owner === "player" ? battle.forcedPlayerHandIndex : battle.forcedNpcHandIndex;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

async function handleBoardClick(index) {
  const battle = state.battle;
  if (battle?.mode === "online") {
    await handleOnlineBoardClick(index);
    return;
  }
  if (!battle || battle.locked || battle.finished || battle.currentTurn !== "player") return;
  if (resolveFieldPurgeKaijutsu(index)) return;
  if (battle.board[index]) return;

  const forcedIndex = getForcedHandIndex("player");
  const skillTargetIndex = getKaijutsuTargetHandIndex(battle);
  const handIndex = skillTargetIndex !== null ? skillTargetIndex : forcedIndex !== null ? forcedIndex : state.selectedHandIndex;
  if (handIndex === null) {
    addBattleLog("手札を1枚選択してください。");
    return;
  }

  const hand = battle.playerHand[handIndex];
  if (!hand || hand.used) return;

  battle.locked = true;
  await playCard("player", handIndex, index);
  state.selectedHandIndex = null;
  battle.forcedPlayerHandIndex = null;
  battle.locked = false;

  if (!checkBattleEnd()) {
    battle.currentTurn = "npc";
    prepareTurn("npc");
    renderBattleHands();
    setTimeout(() => npcTurn(), 550);
  }
}

async function playCard(owner, handIndex, boardIndex) {
  const battle = state.battle;
  const hand = owner === "player" ? battle.playerHand : battle.npcHand;
  const entry = hand[handIndex];
  entry.used = true;
  if (owner === "player" && battle.kaijutsu?.pending && battle.kaijutsu.targetHandIndex === handIndex) {
    battle.kaijutsu.pending = false;
    battle.kaijutsu.targetHandIndex = null;
  }
  const lockedByField = isLockCell(boardIndex, battle);
  battle.board[boardIndex] = { card: entry.card, owner, locked: lockedByField };
  if (lockedByField) {
    addBattleLog(`ロック：${owner === "player" ? "プレイヤー" : battle.npc.name}のカードがロックされました。`);
  }

  if (hasRule("type_ascend", battle) || hasRule("type_descend", battle)) {
    const type = getCardType(entry.card);
    const level = getTypeRuleLevel(entry.card, battle, battle.board);
    if (type && level > 0) {
      if (hasRule("type_ascend", battle)) addBattleLog(`タイプアセンド：場の${type}カードが${level > 0 ? `+${level}` : "変化なし"}になりました。`);
      if (hasRule("type_descend", battle)) addBattleLog(`タイプディセンド：場の${type}カードが-${level}になりました。`);
    }
  }

  renderBattleAll();
  addBattleLog(`${owner === "player" ? "プレイヤー" : battle.npc.name}：${entry.card.name}を配置。`);

  await animatePlace(boardIndex, owner);
  const captured = await resolveCaptures(boardIndex);
  if (captured.length === 0) {
    addBattleLog("カードの奪取はありません。");
  } else {
    addBattleLog(`${captured.length}枚のカードを自陣色に変更しました。`);
  }
  renderBattleAll();
}

function getResolvedComparisonValue(card, side, battle, board, boardIndex) {
  // 処理順：フィールド効果 → 1〜Aへ丸める → 通常・セイム・プラス判定。
  return clamp(getEffectiveCardValue(card, side, battle, board, boardIndex), 1, 10);
}

function getCapturePlan(board, boardIndex, battle = state.battle, typeBoosts = battle?.typeBoosts ?? {}) {
  const placed = board[boardIndex];
  if (!placed) return { indexes: [], reasons: [] };
  const owner = placed.owner;
  const indexes = new Set();
  const reasons = [];
  const neighbors = getNeighbors(boardIndex)
    .map((neighbor) => ({ ...neighbor, target: board[neighbor.index] }))
    .filter((item) => item.target);

  if (hasRule("plus", battle)) {
    const sums = new Map();
    for (const item of neighbors) {
      const placedValue = getResolvedComparisonValue(placed.card, item.side, battle, board, boardIndex);
      const targetValue = getResolvedComparisonValue(item.target.card, item.opposite, battle, board, item.index);
      const sum = placedValue + targetValue;
      if (!sums.has(sum)) sums.set(sum, []);
      sums.get(sum).push(item);
    }
    for (const group of sums.values()) {
      if (group.length >= 2) {
        let flipped = 0;
        for (const item of group) {
          if (item.target.owner !== owner && !item.target.locked) {
            indexes.add(item.index);
            flipped += 1;
          }
        }
        if (flipped) reasons.push("プラス");
      }
    }
  }

  if (hasRule("same", battle)) {
    const sameItems = [];
    for (const item of neighbors) {
      const placedValue = getResolvedComparisonValue(placed.card, item.side, battle, board, boardIndex);
      const targetValue = getResolvedComparisonValue(item.target.card, item.opposite, battle, board, item.index);
      if (placedValue === targetValue) sameItems.push(item);
    }
    if (sameItems.length >= 2) {
      let flipped = 0;
      for (const item of sameItems) {
        if (item.target.owner !== owner && !item.target.locked) {
          indexes.add(item.index);
          flipped += 1;
        }
      }
      if (flipped) reasons.push("セイム");
    }
  }

  for (const item of neighbors) {
    if (item.target.owner === owner || item.target.locked) continue;
    const placedValue = getResolvedComparisonValue(placed.card, item.side, battle, board, boardIndex);
    const targetValue = getResolvedComparisonValue(item.target.card, item.opposite, battle, board, item.index);
    if (sideBeats(placedValue, targetValue, battle)) {
      indexes.add(item.index);
    }
  }

  return { indexes: [...indexes], reasons: [...new Set(reasons)] };
}

function getComboCaptures(board, startIndexes, owner, battle = state.battle, typeBoosts = battle?.typeBoosts ?? {}) {
  if (!hasRule("combo", battle)) return [];
  const captured = [];
  const queue = [...startIndexes];
  const seen = new Set(queue);

  while (queue.length) {
    const sourceIndex = queue.shift();
    const source = board[sourceIndex];
    if (!source || source.owner !== owner) continue;

    // コンボでひっくり返ったカードも、通常比較だけでなく
    // セイム・プラスを含めて再判定する。
    const plan = getCapturePlan(board, sourceIndex, battle, typeBoosts);
    for (const index of plan.indexes) {
      const target = board[index];
      if (!target || target.owner === owner || target.locked) continue;
      target.owner = owner;
      if (!seen.has(index)) {
        seen.add(index);
        queue.push(index);
        captured.push(index);
      }
    }
  }

  return captured;
}

async function resolveCaptures(boardIndex) {
  const battle = state.battle;
  const placed = battle.board[boardIndex];
  const plan = getCapturePlan(battle.board, boardIndex, battle, battle.typeBoosts);
  const captured = [];

  if (plan.reasons.length) addBattleLog(`${plan.reasons.join("・")}発動！`);

  for (const index of plan.indexes) {
    const target = battle.board[index];
    if (!target || target.owner === placed.owner || target.locked) continue;
    target.owner = placed.owner;
    captured.push(index);
    renderBoard();
    await animateFlip(index, placed.owner);
  }

  if (hasRule("combo", battle) && captured.length) {
    const comboQueue = [...captured];
    const seen = new Set(comboQueue);
    let comboCount = 0;
    const comboReasons = new Set();

    while (comboQueue.length) {
      const sourceIndex = comboQueue.shift();
      const source = battle.board[sourceIndex];
      if (!source || source.owner !== placed.owner) continue;

      // コンボでひっくり返ったカードを起点に、通常比較・セイム・プラスを再判定する。
      const comboPlan = getCapturePlan(battle.board, sourceIndex, battle, battle.typeBoosts);
      for (const index of comboPlan.indexes) {
        const target = battle.board[index];
        if (!target || target.owner === placed.owner || target.locked) continue;
        target.owner = placed.owner;
        captured.push(index);
        comboCount += 1;
        for (const reason of comboPlan.reasons) comboReasons.add(reason);
        if (!seen.has(index)) {
          seen.add(index);
          comboQueue.push(index);
        }
        renderBoard();
        await animateFlip(index, placed.owner);
      }
    }

    if (comboCount) {
      const reasonText = comboReasons.size ? `（${[...comboReasons].join("・")}含む）` : "";
      addBattleLog(`コンボ発動${reasonText}：${comboCount}枚を追加で変更しました。`);
    }
  }

  return captured;
}

function getNeighbors(index) {
  const row = Math.floor(index / 3);
  const col = index % 3;
  const result = [];

  if (row > 0) result.push({ index: index - 3, side: "up", opposite: "down" });
  if (col < 2) result.push({ index: index + 1, side: "right", opposite: "left" });
  if (row < 2) result.push({ index: index + 3, side: "down", opposite: "up" });
  if (col > 0) result.push({ index: index - 1, side: "left", opposite: "right" });

  return result;
}

async function animatePlace(index, owner) {
  if (!state.save.settings.effects) return;
  const { effectLayer, cellSize } = state.pixi;
  const pos = boardPosition(index);
  const color = owner === "player" ? 0x4aa3ff : 0xff6b7c;
  const ring = new PIXI.Graphics();
  ring.x = pos.x + cellSize / 2;
  ring.y = pos.y + cellSize / 2;
  effectLayer.addChild(ring);

  await tween(360, (t) => {
    ring.clear();
    ring.lineStyle(4, color, 1 - t);
    ring.drawCircle(0, 0, 16 + t * 90);
  });

  effectLayer.removeChild(ring);
}

async function animateFlip(index, owner) {
  if (!state.save.settings.effects) return;
  const { effectLayer, cellSize } = state.pixi;
  const pos = boardPosition(index);
  const color = owner === "player" ? 0x4aa3ff : 0xff6b7c;
  const flash = new PIXI.Graphics();
  flash.x = pos.x;
  flash.y = pos.y;
  effectLayer.addChild(flash);

  await tween(440, (t) => {
    flash.clear();
    flash.beginFill(color, Math.sin(t * Math.PI) * 0.46);
    flash.drawRoundedRect(6, 6, cellSize - 12, cellSize - 12, 18);
    flash.endFill();
  });

  effectLayer.removeChild(flash);
}

function tween(duration, draw) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      draw(t);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

async function npcTurn() {
  const battle = state.battle;
  if (!battle || battle.finished) return;

  battle.locked = true;
  const move = chooseNpcMove();
  if (!move) {
    battle.locked = false;
    checkBattleEnd();
    return;
  }

  await playCard("npc", move.handIndex, move.boardIndex);
  battle.forcedNpcHandIndex = null;
  battle.locked = false;

  if (!checkBattleEnd()) {
    battle.currentTurn = "player";
    prepareTurn("player");
    renderBattleHands();
    addBattleLog("プレイヤーのターンです。");
  }
}

function legalMovesFor(hand, board, owner = null) {
  const emptyIndexes = board
    .map((cell, index) => cell ? null : index)
    .filter((index) => index !== null);

  let allowedHandIndexes = null;
  if (owner) {
    const forcedIndex = getForcedHandIndex(owner);
    if (forcedIndex !== null) allowedHandIndexes = new Set([forcedIndex]);
  }

  const moves = [];
  hand.forEach((entry, handIndex) => {
    if (entry.used) return;
    if (allowedHandIndexes && !allowedHandIndexes.has(handIndex)) return;
    for (const boardIndex of emptyIndexes) {
      moves.push({ handIndex, boardIndex, card: entry.card });
    }
  });
  return moves;
}

function chooseNpcMove() {
  const battle = state.battle;
  let moves = legalMovesFor(battle.npcHand, battle.board, "npc");
  if (moves.length === 0) return null;

  if (battle.npc.difficulty === "よわい") {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (battle.npc.difficulty === "ふつう") {
    const scored = moves.map((move) => {
      const sim = simulateMove(battle.board, move.card, "npc", move.boardIndex);
      return {
        move,
        score: sim.captured,
        aiPower: getAiCardPower(move.card, battle, sim.board, move.boardIndex),
        safety: safetyScore(sim.board, move.boardIndex, "npc")
      };
    }).sort((a, b) => (b.score - a.score) || (b.safety - a.safety) || (b.aiPower - a.aiPower));

    if (scored[0].score > 0) return scored[0].move;
    return scored[0].move;
  }

  if (battle.npc.difficulty === "修羅") {
    return chooseShuraMove(moves);
  }

  return chooseStrongMove(moves);
}

function chooseStrongMove(moves) {
  const battle = state.battle;
  let best = null;

  for (const move of moves) {
    const sim = simulateMove(battle.board, move.card, "npc", move.boardIndex);
    const npcRemaining = battle.npcHand.filter((entry, index) => !entry.used && index !== move.handIndex).length;
    const playerRemaining = battle.playerHand.filter((entry) => !entry.used).length;

    let worstCounter = 0;
    const playerMoves = legalMovesFor(battle.playerHand, sim.board, "player");
    for (const pMove of playerMoves) {
      const counter = simulateMove(sim.board, pMove.card, "player", pMove.boardIndex, sim.typeBoosts);
      const scoreAfterCounter = boardAdvantageForNpc(counter.board, playerRemaining - 1, npcRemaining);
      worstCounter = Math.max(worstCounter, -scoreAfterCounter + counter.captured * 18);
    }

    const score = boardAdvantageForNpc(sim.board, playerRemaining, npcRemaining) * 24
      + sim.captured * 42
      + safetyScore(sim.board, move.boardIndex, "npc")
      + getAiCardPower(move.card, battle, sim.board, move.boardIndex)
      - worstCounter;

    if (!best || score > best.score) {
      best = { move, score };
    }
  }

  return best.move;
}


const SHURA_AI_SEARCH = Object.freeze({
  playerBeam: 12,
  npcBeam: 9
});

function cloneAiSearchHand(hand) {
  return (hand ?? []).map((entry) => ({ card: entry.card, used: Boolean(entry.used) }));
}

function markAiSearchHandUsed(hand, handIndex) {
  return hand.map((entry, index) => index === handIndex ? { ...entry, used: true } : entry);
}

function legalMovesForAiSearch(hand, board, owner, battle = state.battle) {
  const emptyIndexes = board
    .map((cell, index) => cell ? null : index)
    .filter((index) => index !== null);

  let allowedIndexes = hand
    .map((entry, index) => entry.used ? null : index)
    .filter((index) => index !== null);

  // オーダーは将来手でも左から最初の未使用カードに限定する。
  // カオスは次ターンの抽選結果がまだ分からないため、全候補を調べて
  // プレイヤー側は最悪ケース、NPC側は最善の返しとして評価する。
  if (hasRule("order", battle) && allowedIndexes.length) {
    allowedIndexes = [allowedIndexes[0]];
  }

  const moves = [];
  for (const handIndex of allowedIndexes) {
    const card = hand[handIndex]?.card;
    if (!card) continue;
    for (const boardIndex of emptyIndexes) {
      moves.push({ handIndex, boardIndex, card, owner });
    }
  }
  return moves;
}

function isCornerCell(index) {
  return index === 0 || index === 2 || index === 6 || index === 8;
}

function isCenterCell(index) {
  return index === 4;
}

function strategicSideStrength(value, battle = state.battle) {
  if (hasRule("reverse", battle)) return 11 - value;
  if (hasRule("ace_killer", battle) && value === 1) return 7.5;
  return value;
}

function shuraCellPlacementScore(board, boardIndex, owner, battle = state.battle) {
  const cell = board[boardIndex];
  if (!cell) return 0;
  const sign = owner === "npc" ? 1 : -1;
  let score = isCornerCell(boardIndex) ? 34 : isCenterCell(boardIndex) ? 13 : 7;
  if (cell.locked) score += 16;

  const exposed = getNeighbors(boardIndex).filter((neighbor) => !board[neighbor.index]);
  if (exposed.length) {
    const strength = exposed.reduce((sum, neighbor) => {
      const value = getResolvedComparisonValue(cell.card, neighbor.side, battle, board, boardIndex);
      return sum + strategicSideStrength(value, battle);
    }, 0) / exposed.length;
    score += (strength - 5.5) * 3.2;
  } else {
    score += 5;
  }
  return score * sign;
}

function shuraBoardShapeScore(board, battle = state.battle) {
  let score = 0;
  for (let index = 0; index < board.length; index += 1) {
    const cell = board[index];
    if (!cell) continue;
    score += shuraCellPlacementScore(board, index, cell.owner, battle);
  }
  return score;
}

function aiSearchHandPower(hand, battle = state.battle) {
  return (hand ?? [])
    .filter((entry) => !entry.used)
    .reduce((sum, entry) => sum + getAiCardPower(entry.card, battle), 0);
}

function shuraReserveScore(npcHand, playerHand, battle = state.battle) {
  const npcPower = aiSearchHandPower(npcHand, battle);
  const playerPower = aiSearchHandPower(playerHand, battle);
  return (npcPower - playerPower) * 1.15;
}

function shuraConservationBonus(move, hand, battle = state.battle) {
  const available = (hand ?? []).filter((entry) => !entry.used);
  if (available.length <= 2) return 0;
  const powers = available.map((entry) => getAiCardPower(entry.card, battle));
  const selected = getAiCardPower(move.card, battle);
  const max = Math.max(...powers);
  const min = Math.min(...powers);
  const phaseWeight = Math.min(1.4, (available.length - 2) * 0.38);
  // 序盤ほど最強カードを温存し、同等の結果なら弱いカードを先に使う。
  return ((max - selected) * 2.1 + (selected === min ? 4 : 0)) * phaseWeight;
}

function shuraOpponentCommitmentBonus(card, hand, battle = state.battle) {
  const available = (hand ?? []).filter((entry) => !entry.used);
  if (!available.length) return 0;
  const powers = available.map((entry) => getAiCardPower(entry.card, battle));
  const selected = getAiCardPower(card, battle);
  const min = Math.min(...powers);
  const max = Math.max(...powers);
  if (max <= min) return 5;
  // 相手が強いカードを切らないと返せない形を高評価する。
  return ((selected - min) / (max - min)) * 24;
}

function shuraFutureSpecialPotential(board, hand, owner, battle = state.battle) {
  if (!hasRule("same", battle) && !hasRule("plus", battle)) return 0;
  const moves = legalMovesForAiSearch(hand, board, owner, battle);
  const scores = [];

  for (const move of moves) {
    const testBoard = board.slice();
    testBoard[move.boardIndex] = {
      card: move.card,
      owner,
      locked: isLockCell(move.boardIndex, battle)
    };
    const plan = getCapturePlan(testBoard, move.boardIndex, battle, testBoard);
    let score = 0;
    if (plan.reasons.includes("セイム")) score += 22;
    if (plan.reasons.includes("プラス")) score += 22;
    if (plan.reasons.length) {
      const enemyTargets = plan.indexes.filter((index) => testBoard[index]?.owner !== owner).length;
      score += enemyTargets * 7;
      if (isCornerCell(move.boardIndex)) score += 5;
    }
    if (score > 0) scores.push(score);
  }

  scores.sort((a, b) => b - a);
  return (scores[0] ?? 0) + (scores[1] ?? 0) * 0.35;
}

function shuraComboExposure(board, owner, battle = state.battle) {
  if (!hasRule("combo", battle)) return 0;
  let risk = 0;

  for (let index = 0; index < board.length; index += 1) {
    const cell = board[index];
    if (!cell || cell.owner !== owner || cell.locked) continue;
    const friendlyLinks = getNeighbors(index).filter((neighbor) => board[neighbor.index]?.owner === owner).length;
    const exposed = getNeighbors(index).filter((neighbor) => !board[neighbor.index]);
    if (!friendlyLinks || !exposed.length) continue;

    const weakestExposed = Math.min(...exposed.map((neighbor) => {
      const value = getResolvedComparisonValue(cell.card, neighbor.side, battle, board, index);
      return strategicSideStrength(value, battle);
    }));
    risk += friendlyLinks * Math.max(0, 7.5 - weakestExposed) * 2.6;
  }
  return risk;
}

function evaluateShuraPosition(board, npcHand, playerHand, battle = state.battle) {
  const npcRemaining = npcHand.filter((entry) => !entry.used).length;
  const playerRemaining = playerHand.filter((entry) => !entry.used).length;
  const boardScore = boardAdvantageForNpc(board, playerRemaining, npcRemaining) * 72;
  const shapeScore = shuraBoardShapeScore(board, battle);
  const reserveScore = shuraReserveScore(npcHand, playerHand, battle);
  const futureNpc = shuraFutureSpecialPotential(board, npcHand, "npc", battle);
  const futurePlayer = shuraFutureSpecialPotential(board, playerHand, "player", battle);
  const npcComboRisk = shuraComboExposure(board, "npc", battle);
  const playerComboRisk = shuraComboExposure(board, "player", battle);

  return boardScore
    + shapeScore
    + reserveScore
    + futureNpc * 1.15
    - futurePlayer * 1.25
    - npcComboRisk * 1.35
    + playerComboRisk * 0.8;
}

function rankPlayerSearchBranches(branches, battle = state.battle) {
  return branches.sort((a, b) => {
    const aThreat = a.sim.captured * 50 + a.sim.comboCaptured * 74
      + (isCornerCell(a.move.boardIndex) ? 22 : 0)
      + (a.sim.captureReasons.length ? 18 : 0)
      - boardAdvantageForNpc(a.sim.board, a.playerRemaining, a.npcRemaining) * 18;
    const bThreat = b.sim.captured * 50 + b.sim.comboCaptured * 74
      + (isCornerCell(b.move.boardIndex) ? 22 : 0)
      + (b.sim.captureReasons.length ? 18 : 0)
      - boardAdvantageForNpc(b.sim.board, b.playerRemaining, b.npcRemaining) * 18;
    return bThreat - aThreat;
  });
}

function rankNpcSearchBranches(branches, battle = state.battle) {
  return branches.sort((a, b) => {
    const aValue = a.sim.captured * 48 + a.sim.comboCaptured * 68
      + (isCornerCell(a.move.boardIndex) ? 28 : 0)
      + safetyScore(a.sim.board, a.move.boardIndex, "npc")
      + shuraConservationBonus(a.move, a.handBefore, battle);
    const bValue = b.sim.captured * 48 + b.sim.comboCaptured * 68
      + (isCornerCell(b.move.boardIndex) ? 28 : 0)
      + safetyScore(b.sim.board, b.move.boardIndex, "npc")
      + shuraConservationBonus(b.move, b.handBefore, battle);
    return bValue - aValue;
  });
}

function chooseShuraMove(moves) {
  const battle = state.battle;
  const initialNpcHand = cloneAiSearchHand(battle.npcHand);
  const initialPlayerHand = cloneAiSearchHand(battle.playerHand);
  let best = null;

  // 3プライ探索：修羅の現在手 → プレイヤーの最善応手 → 修羅の次の最善手。
  // 盤面が小さいため全初手を評価し、応手以降は危険度の高い候補へ絞る。
  for (const move of moves) {
    const firstSim = simulateMove(battle.board, move.card, "npc", move.boardIndex);
    const npcAfterFirst = markAiSearchHandUsed(initialNpcHand, move.handIndex);
    const playerAfterFirst = initialPlayerHand;
    const playerMoves = legalMovesForAiSearch(playerAfterFirst, firstSim.board, "player", battle);

    let minimaxScore;
    if (!playerMoves.length) {
      minimaxScore = evaluateShuraPosition(firstSim.board, npcAfterFirst, playerAfterFirst, battle);
    } else {
      const playerBranches = playerMoves.map((playerMove) => {
        const sim = simulateMove(firstSim.board, playerMove.card, "player", playerMove.boardIndex, firstSim.typeBoosts);
        return {
          move: playerMove,
          sim,
          playerRemaining: playerAfterFirst.filter((entry, index) => !entry.used && index !== playerMove.handIndex).length,
          npcRemaining: npcAfterFirst.filter((entry) => !entry.used).length
        };
      });

      const dangerousResponses = rankPlayerSearchBranches(playerBranches, battle)
        .slice(0, SHURA_AI_SEARCH.playerBeam);
      minimaxScore = Number.POSITIVE_INFINITY;

      for (const response of dangerousResponses) {
        const playerAfterResponse = markAiSearchHandUsed(playerAfterFirst, response.move.handIndex);
        const npcFollowMoves = legalMovesForAiSearch(npcAfterFirst, response.sim.board, "npc", battle);
        const commitmentBonus = shuraOpponentCommitmentBonus(response.move.card, playerAfterFirst, battle);
        let bestFollowScore;

        if (!npcFollowMoves.length) {
          bestFollowScore = evaluateShuraPosition(response.sim.board, npcAfterFirst, playerAfterResponse, battle);
        } else {
          const npcBranches = npcFollowMoves.map((followMove) => ({
            move: followMove,
            handBefore: npcAfterFirst,
            sim: simulateMove(response.sim.board, followMove.card, "npc", followMove.boardIndex, response.sim.typeBoosts)
          }));
          const followCandidates = rankNpcSearchBranches(npcBranches, battle)
            .slice(0, SHURA_AI_SEARCH.npcBeam);
          bestFollowScore = Number.NEGATIVE_INFINITY;

          for (const follow of followCandidates) {
            const npcAfterFollow = markAiSearchHandUsed(npcAfterFirst, follow.move.handIndex);
            let leafScore = evaluateShuraPosition(follow.sim.board, npcAfterFollow, playerAfterResponse, battle);
            leafScore += follow.sim.captured * 20 + follow.sim.comboCaptured * 32;
            leafScore += shuraConservationBonus(follow.move, npcAfterFirst, battle);
            if (isCornerCell(follow.move.boardIndex)) leafScore += 16;
            bestFollowScore = Math.max(bestFollowScore, leafScore);
          }
        }

        // コンボでの大量反転は通常の枚数差以上に危険として扱う。
        const responseScore = bestFollowScore
          + commitmentBonus
          - response.sim.captured * 10
          - response.sim.comboCaptured * 46;
        minimaxScore = Math.min(minimaxScore, responseScore);
      }
    }

    let score = minimaxScore
      + firstSim.captured * 24
      + firstSim.comboCaptured * 38
      + shuraConservationBonus(move, initialNpcHand, battle);
    if (isCornerCell(move.boardIndex)) score += 32;
    if (isCenterCell(move.boardIndex)) score += 8;
    if (firstSim.captureReasons.includes("セイム")) score += 10;
    if (firstSim.captureReasons.includes("プラス")) score += 10;

    if (!best || score > best.score) best = { move, score };
  }

  return best?.move ?? moves[0];
}

function boardAdvantageForNpc(board, playerRemaining, npcRemaining) {
  const npc = board.filter((cell) => cell?.owner === "npc").length + npcRemaining;
  const player = board.filter((cell) => cell?.owner === "player").length + playerRemaining;
  return npc - player;
}

function safetyScore(board, boardIndex, owner) {
  const placed = board[boardIndex];
  if (!placed) return 0;

  const exposedSides = getNeighbors(boardIndex).filter((neighbor) => !board[neighbor.index]);
  if (exposedSides.length === 0) return 8;

  const average = exposedSides.reduce((sum, neighbor) => sum + getEffectiveCardValue(placed.card, neighbor.side, state.battle, board, boardIndex), 0) / exposedSides.length;
  return hasRule("reverse", state.battle) ? 11 - average : average;
}

function simulateMove(board, card, owner, boardIndex, typeBoostsOverride = null) {
  const battle = state.battle;
  const simBattle = { ...battle, typeBoosts: { ...(typeBoostsOverride ?? battle.typeBoosts ?? {}) } };
  const copy = board.map((cell) => cell ? { card: cell.card, owner: cell.owner, locked: Boolean(cell.locked) } : null);
  copy[boardIndex] = { card, owner, locked: isLockCell(boardIndex, battle) };
  simBattle.board = copy;

  const plan = getCapturePlan(copy, boardIndex, simBattle, copy);
  const capturedIndexes = [];
  for (const index of plan.indexes) {
    const target = copy[index];
    if (!target || target.owner === owner) continue;
    target.owner = owner;
    capturedIndexes.push(index);
  }

  const comboCaptured = getComboCaptures(copy, capturedIndexes, owner, simBattle, copy);
  return {
    board: copy,
    captured: capturedIndexes.length + comboCaptured.length,
    directCaptured: capturedIndexes.length,
    comboCaptured: comboCaptured.length,
    captureReasons: [...(plan.reasons ?? [])],
    typeBoosts: simBattle.typeBoosts
  };
}

function checkBattleEnd() {
  const battle = state.battle;
  if (!battle) return true;
  if (battle.mode === "online") return false;
  const boardFull = battle.board.every(Boolean);
  const noPlayableCards = battle.playerHand.every((entry) => entry.used) && battle.npcHand.every((entry) => entry.used);

  if (!boardFull && !noPlayableCards) return false;

  battle.finished = true;
  renderBattleAll();

  const score = calcScore();
  if (battle.mode === "onlineNpc") {
    handleOnlineNpcResult(score);
    return true;
  }
  if (score.player > score.npc) {
    addBattleLog(`勝利！ ${score.player} - ${score.npc}`);
    const winMoney = getNpcWinMoney(battle.npc);
    const refundMoney = Number(battle.entryFee ?? 0);
    addMoney(winMoney + refundMoney);
    addTotalEarnedMoney(winMoney);
    addBattleLog(`勝利報酬として${formatMoney(winMoney)}を獲得しました。`);
    if (refundMoney > 0) addBattleLog(`勝利したため挑戦料${formatMoney(refundMoney)}が返金されました。`);
    const previousWins = state.save.npcWins[battle.npc.id] ?? 0;
    const firstWinCard = previousWins === 0 && battle.npc.firstWinRewardCardId ? cardById.get(battle.npc.firstWinRewardCardId) : null;
    if (firstWinCard) {
      addOwnedCard(firstWinCard.id);
      battle.firstWinRewardCardId = firstWinCard.id;
      addBattleLog(`初回勝利報酬として「${firstWinCard.name}」を獲得しました。`);
    }
    state.save.npcWins[battle.npc.id] = previousWins + 1;
    battle.finalScore = { ...score };
    battle.overwhelmingVictoryBonus = score.player === 8 || score.player === 9;
    if (battle.overwhelmingVictoryBonus) {
      addBattleLog(`圧勝ボーナス！ 最終スコア${score.player}のためレアチャンスが確定しました。`);
    }
    save();
    handleReward();
  } else if (score.player < score.npc) {
    addBattleLog(`敗北... ${score.player} - ${score.npc}`);
    showModal("敗北", `<p>今回はカードを獲得できませんでした。</p><p>挑戦料${formatMoney(battle.entryFee)}は返金されません。</p><p>スコア：自分 ${score.player} - ${score.npc} 相手</p>`, [
      finalBoardAction(),
      { label: "再戦", onClick: () => { closeModal(); startBattle(battle.npc.id); } },
      { label: "対戦相手選択", className: "ghost", onClick: () => { closeModal(); showScreen("battleMenu"); } }
    ]);
  } else {
    addBattleLog(`引き分け ${score.player} - ${score.npc}`);
    const refundMoney = Number(battle.entryFee ?? 0);
    if (refundMoney > 0) {
      addMoney(refundMoney);
      addBattleLog(`引き分けのため挑戦料${formatMoney(refundMoney)}が返金されました。`);
    }
    showModal("引き分け", `<p>引き分けのためカード獲得はありません。</p><p>挑戦料${formatMoney(battle.entryFee)}は返金されました。</p><p>スコア：自分 ${score.player} - ${score.npc} 相手</p>`, [
      finalBoardAction(),
      { label: "再戦", onClick: () => { closeModal(); startBattle(battle.npc.id); } },
      { label: "対戦相手選択", className: "ghost", onClick: () => { closeModal(); showScreen("battleMenu"); } },
      { label: "タイトルへ戻る", className: "ghost", onClick: () => { closeModal(); showScreen("title"); } }
    ]);
  }

  return true;
}

async function handleOnlineNpcResult(score) {
  const battle = state.battle;
  const winner = score.player > score.npc ? "player" : score.player < score.npc ? "npc" : "draw";
  const myScore = winner === "draw" ? 0.5 : winner === "player" ? 1 : 0;
  const oldRating = Number(state.online.cachedProfile?.rating ?? getDefaultOnlineRating());
  const opponentRating = Number(battle.npc?.onlineNpcRating ?? 1500);
  const newRating = calculateElo(oldRating, opponentRating, myScore);
  const title = winner === "draw" ? "引き分け" : winner === "player" ? "勝利" : "敗北";
  addBattleLog(`${title} ${score.player} - ${score.npc}`);
  try {
    const fb = await ensureOnlineFirebase();
    const profileSnap = await fb.get(getProfileRef(fb.uid));
    const profile = profileSnap.exists() ? profileSnap.val() : {};
    const wins = Number(profile.onlineWins ?? 0) + (winner === "player" ? 1 : 0);
    const losses = Number(profile.onlineLosses ?? 0) + (winner === "npc" ? 1 : 0);
    const draws = Number(profile.onlineDraws ?? 0) + (winner === "draw" ? 1 : 0);
    const username = getOnlineUserName() || profile.username || "名無し";
    const now = Date.now();
    await fb.update(fb.ref(fb.db), {
      [`profiles/${fb.uid}/rating`]: newRating,
      [`profiles/${fb.uid}/onlineWins`]: wins,
      [`profiles/${fb.uid}/onlineLosses`]: losses,
      [`profiles/${fb.uid}/onlineDraws`]: draws,
      [`profiles/${fb.uid}/updatedAt`]: now,
      [`leaderboards/onlineRating/${fb.uid}`]: { username, rating: newRating, wins, losses, draws, updatedAt: now }
    });
    state.online.cachedProfile = { ...(state.online.cachedProfile ?? {}), rating: newRating, onlineWins: wins, onlineLosses: losses, onlineDraws: draws };
  } catch (error) {
    addBattleLog(`レート反映エラー：${error.message ?? error}`);
  }
  showModal(`ランダムNPC戦：${title}`, `<p>スコア：自分 ${score.player} - ${score.npc} 相手</p><p>レート：${oldRating} → <strong>${newRating}</strong>（${newRating - oldRating >= 0 ? "+" : ""}${newRating - oldRating}）</p>`, [
    finalBoardAction(),
    { label: "もう一度ランダムマッチ", onClick: () => { closeModal(); state.battle = null; showScreen("onlineBattle"); startRandomOnlineMatch(); } },
    { label: "オンライン対戦へ", className: "ghost", onClick: () => { closeModal(); state.battle = null; showScreen("onlineBattle"); } },
    { label: "タイトルへ戻る", className: "ghost", onClick: () => { closeModal(); state.battle = null; showScreen("title"); } }
  ]);
}

function getFirstWinRewardCard(battle) {
  const cardId = battle?.firstWinRewardCardId;
  return cardId ? cardById.get(cardId) : null;
}

function firstWinRewardHtml(battle) {
  const card = getFirstWinRewardCard(battle);
  if (!card) return "";
  return `
    <div class="first-win-reward">
      <p><strong>初回勝利報酬</strong>として以下のカードも獲得しました。</p>
      <div class="reward-grid">${rewardDisplayCardHtml(card)}</div>
    </div>
  `;
}

function getRareChanceCards(npc) {
  const rarities = Array.isArray(npc?.rareChanceRarities) ? npc.rareChanceRarities.map(Number) : null;
  const maxRarity = getRareChanceMaxRarity(npc);
  return CARDS.filter((card) => {
    if (npc?.rareChanceType && getCardType(card) !== npc.rareChanceType) return false;
    if (rarities && !rarities.includes(card.rarity)) return false;
    if (!rarities && card.rarity > maxRarity) return false;
    return true;
  });
}

function getChooseRewardCards(battle) {
  return battle.npcBattleCards.filter((card) => card.rarity <= 3);
}

function getRandomRewardCards(battle) {
  return battle.npcBattleCards.filter((card) => card.rarity <= 4);
}

function getRewardFallbackCard(battle) {
  return battle.npcBattleCards
    .filter((card) => card.rarity <= 4)
    .sort((a, b) => a.rarity - b.rarity || a.power - b.power)[0] ?? null;
}

function getVictoryMoneyHtml(battle) {
  const winMoney = getNpcWinMoney(battle.npc);
  const entryFee = Number(battle.entryFee ?? 0);
  if (entryFee > 0) {
    return `<p>勝利報酬として${formatMoney(winMoney)}、挑戦料返金として${formatMoney(entryFee)}を獲得しました。</p>`;
  }
  return `<p>勝利報酬として${formatMoney(winMoney)}を獲得しました。</p>`;
}

function rollRewardRule(npc, battle = state.battle) {
  if (battle?.overwhelmingVictoryBonus) return "rare_chance";
  const weights = getRewardWeights(npc, battle);
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  let roll = Math.random() * total;

  for (const [rule, weight] of Object.entries(weights)) {
    roll -= weight;
    if (roll <= 0) return rule;
  }

  return "random_one";
}

function handleReward() {
  const battle = state.battle;
  const rule = rollRewardRule(battle.npc, battle);

  if (rule === "choose_one") {
    const choices = getChooseRewardCards(battle);
    if (!choices.length) {
      const fallback = getRewardFallbackCard(battle);
      if (fallback) {
        addOwnedCard(fallback.id);
        showRewardResult(fallback, "選択可能な★3以下カードがなかったため、★4以下のカードからランダムで獲得しました。");
      } else {
        showModal("カード獲得なし", `${getVictoryMoneyHtml(battle)}${firstWinRewardHtml(battle)}<p>獲得可能なカードがありませんでした。</p>`, postVictoryActions());
      }
      return;
    }

    showModal(
      "報酬：好きなカードを1枚選択",
      `${getVictoryMoneyHtml(battle)}${firstWinRewardHtml(battle)}<p>報酬抽選：相手カードから選択取得（★3まで）</p><div class="reward-grid">${choices.map((card) => rewardCardHtml(card)).join("")}</div>`,
      [{
        label: "表示カードからランダムで受け取る",
        className: "ghost",
        onClick: () => {
          const card = choices[Math.floor(Math.random() * choices.length)];
          addOwnedCard(card.id);
          closeModal();
          showRewardResult(card, "選択取得の候補からランダム受け取りにしました。");
        }
      }]
    );

    document.querySelectorAll("[data-reward-card-id]").forEach((element) => {
      element.addEventListener("click", () => {
        const cardId = element.getAttribute("data-reward-card-id");
        const card = cardById.get(cardId);
        if (!card || card.rarity > 3) return;
        addOwnedCard(cardId);
        closeModal();
        showRewardResult(card, "選択取得で獲得しました。★3までが選択対象です。");
      });
    });
    return;
  }

  if (rule === "rare_chance") {
    const rareCards = shuffle(getRareChanceCards(battle.npc))
      .sort((a, b) => {
        const ownedA = getOwnedCount(a.id) > 0 ? 1 : 0;
        const ownedB = getOwnedCount(b.id) > 0 ? 1 : 0;
        return ownedA - ownedB || b.rarity - a.rarity || b.power - a.power;
      });
    const card = rareCards[Math.floor(Math.random() * Math.min(rareCards.length, 30))];
    if (!card) {
      showModal("カード獲得なし", `${getVictoryMoneyHtml(battle)}${firstWinRewardHtml(battle)}<p>レアチャンス対象カードがありませんでした。</p>`, postVictoryActions());
      return;
    }
    addOwnedCard(card.id);
    const effectiveRate = Math.min(100, getRareChanceRate(battle.npc) * Math.max(1, Number(battle.rareChanceMultiplier ?? 1)));
    const rewardMessage = battle.overwhelmingVictoryBonus
      ? `圧勝ボーナス！ 最終スコア${battle.finalScore?.player ?? "8または9"}のためレアチャンス確定。対象：${getRareChanceLabel(battle.npc)}`
      : `レアチャンス ${effectiveRate}% に当選しました。対象：${getRareChanceLabel(battle.npc)}`;
    showRewardResult(card, rewardMessage);
    return;
  }

  const randomCandidates = getRandomRewardCards(battle);
  const card = randomCandidates[Math.floor(Math.random() * randomCandidates.length)] ?? getRewardFallbackCard(battle);
  if (!card) {
    showModal("カード獲得なし", `${getVictoryMoneyHtml(battle)}${firstWinRewardHtml(battle)}<p>ランダム取得可能な★4以下カードがありませんでした。</p>`, postVictoryActions());
    return;
  }
  addOwnedCard(card.id);
  showRewardResult(card, "相手カードからランダム取得しました。ランダム取得は★4までが対象です。");
}

function rewardDisplayCardHtml(card) {
  const typeMeta = getCardTypeMeta(card);
  return `
    <div class="reward-card reward-display-card" data-type="${typeMeta.key}" style="--card-type-color:${typeMeta.color};">
      <div class="reward-card-preview mini-card">
        ${cardMiniHtml(card, "", { squareArt: true, detail: true, showName: false })}
      </div>
      <div class="reward-card-info">
        <strong>${escapeHtml(card.name)}</strong><br>
        <small>${rarityStars(card.rarity)} / ${cardStatLine(card)}</small>
      </div>
    </div>
  `;
}

function rewardCardHtml(card) {
  const typeMeta = getCardTypeMeta(card);
  return `
    <div class="reward-card" data-type="${typeMeta.key}" style="--card-type-color:${typeMeta.color};">
      <div class="reward-card-preview mini-card">
        ${cardMiniHtml(card, "", { squareArt: true, detail: true, showName: false })}
      </div>
      <div class="reward-card-info">
        <strong>${escapeHtml(card.name)}</strong><br>
        <small>${rarityStars(card.rarity)} / ${cardStatLine(card)}</small><br>
        <span class="owned-badge ${getOwnedCount(card.id) > 0 ? "owned" : "not-owned"}">${getOwnedCount(card.id) > 0 ? "取得済み" : "未取得"}</span>
      </div>
      <button class="small-button reward-get-button" data-reward-card-id="${card.id}">このカードを入手</button>
    </div>
  `;
}

function postVictoryActions() {
  return [
    finalBoardAction(),
    { label: "再戦", onClick: () => { const npcId = state.battle?.npc?.id; closeModal(); if (npcId) startBattle(npcId); } },
    { label: "対戦相手選択", className: "ghost", onClick: () => { closeModal(); showScreen("battleMenu"); } },
    { label: "デッキ画面", className: "ghost", onClick: () => { closeModal(); showScreen("deck"); } },
    { label: "タイトルへ戻る", className: "ghost", onClick: () => { closeModal(); showScreen("title"); } }
  ];
}

function showRewardResult(card, reason) {
  showModal(
    "カード獲得",
    `${getVictoryMoneyHtml(state.battle)}${firstWinRewardHtml(state.battle)}<p>${escapeHtml(reason)}</p><div class="reward-grid">${rewardDisplayCardHtml(card)}</div>`,
    postVictoryActions()
  );
}

function confirmBattleExit(destination = "title") {
  const battle = state.battle;
  if (battle?.mode === "online") {
    confirmOnlineExit(destination === "title" ? "title" : "onlineBattle");
    return;
  }
  if (!battle || battle.finished) {
    state.battle = null;
    showScreen(destination === "battleMenu" ? "battleMenu" : "title");
    return;
  }

  const destText = destination === "battleMenu" ? "対戦相手選択へ戻る" : "タイトルへ戻る";
  showModal(
    "棄権確認",
    `<p>対戦中に${destText}と棄権になります。</p><p>挑戦料${formatMoney(battle.entryFee ?? 0)}は返ってきませんが、よろしいですか？</p>`,
    [
      {
        label: "棄権する",
        className: "danger",
        onClick: () => {
          closeModal();
          addBattleLog("棄権しました。挑戦料は返金されません。");
          state.battle = null;
          showScreen(destination === "battleMenu" ? "battleMenu" : "title");
        }
      },
      { label: "キャンセル", className: "ghost", onClick: closeModal }
    ]
  );
}

async function forceUpdate() {
  try {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((name) => caches.delete(name)));
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch (error) {
    console.warn(error);
  }
  location.reload();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js").catch((error) => {
      console.warn("Service Worker registration failed", error);
    });
  });
}

function bindEvents() {
  $("versionLabel").textContent = `v${VERSION}`;
  $("backTitleBtn").addEventListener("click", () => confirmBattleExit("title"));

  $("goBattle").addEventListener("click", () => showScreen("battleSelect"));
  $("goNpcBattle").addEventListener("click", () => showScreen("battleMenu"));
  $("goOnlineBattle").addEventListener("click", () => showScreen("onlineBattle"));
  $("createOnlineRoom").addEventListener("click", createOnlineRoom);
  $("joinOnlineRoom").addEventListener("click", joinOnlineRoom);
  const randomMatchBtn = $("randomOnlineMatch");
  if (randomMatchBtn) randomMatchBtn.addEventListener("click", startRandomOnlineMatch);
  $("onlineRoomCode").addEventListener("input", (event) => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8); });
  $("goDeck").addEventListener("click", () => showScreen("deck"));
  $("goShop").addEventListener("click", () => showScreen("shop"));
  $("goCardEnhance").addEventListener("click", () => showScreen("cardEnhance"));
  $("goCollection").addEventListener("click", () => showScreen("collection"));
  $("goRankings").addEventListener("click", () => showScreen("rankings"));
  $("goRules").addEventListener("click", () => showScreen("rules"));
  $("goSettings").addEventListener("click", () => showScreen("settings"));
  $("updateButton").addEventListener("click", forceUpdate);

  $("showAwakeningMenu")?.addEventListener("click", () => setEnhancementView("awakening"));
  $("showResidueMenu")?.addEventListener("click", () => setEnhancementView("residue"));
  $("convertAllStar1")?.addEventListener("click", () => confirmResidueConversion(buildResidueConversion(1)));
  $("convertAllStar2")?.addEventListener("click", () => confirmResidueConversion(buildResidueConversion(2)));
  $("convertAllStar3")?.addEventListener("click", () => confirmResidueConversion(buildResidueConversion(3)));

  $("cardSearch").addEventListener("input", renderOwnedCardList);
  $("ownedViewVertical").addEventListener("click", () => setOwnedCardView("vertical"));
  $("ownedViewHorizontal").addEventListener("click", () => setOwnedCardView("horizontal"));
  $("deckSortField").addEventListener("change", (event) => {
    state.deckSort.field = event.target.value;
    renderOwnedCardList();
  });
  $("deckSortOrder").addEventListener("change", (event) => {
    state.deckSort.order = event.target.value;
    renderOwnedCardList();
  });
  $("collectionSearch").addEventListener("input", renderCollectionScreen);

  [
    ["deckRarityFilter", state.deckFilter, "rarity", renderOwnedCardList],
    ["deckAttributeFilter", state.deckFilter, "attribute", renderOwnedCardList],
    ["collectionRarityFilter", state.collectionFilter, "rarity", renderCollectionScreen],
    ["collectionAttributeFilter", state.collectionFilter, "attribute", renderCollectionScreen],
    ["collectionSortField", state.collectionFilter, "sortField", renderCollectionScreen],
    ["collectionSortOrder", state.collectionFilter, "sortOrder", renderCollectionScreen]
  ].forEach(([id, target, key, render]) => {
    const control = $(id);
    if (!control) return;
    control.addEventListener("change", (event) => {
      target[key] = event.target.value;
      render();
    });
  });

  $("npcModeToggle")?.addEventListener("click", () => {
    if (!hasDefeatedNpc(15)) {
      state.npcListMode = "normal";
      renderNpcList();
      return;
    }
    state.npcListMode = state.npcListMode === "shura" ? "normal" : "shura";
    state.npcListUi.difficulty = "all";
    renderNpcList();
  });

  [
    ["npcFilterDifficulty", "difficulty"],
    ["npcFilterWinStatus", "winStatus"],
    ["npcFilterAttribute", "attribute"],
    ["npcSortField", "sortField"],
    ["npcSortOrder", "sortOrder"]
  ].forEach(([id, key]) => {
    const control = $(id);
    if (!control) return;
    control.addEventListener("change", (event) => {
      state.npcListUi[key] = event.target.value;
      renderNpcList();
    });
  });

  $("deckKaijutsuSelect")?.addEventListener("change", (event) => {
    const skillId = String(event.target.value ?? "none");
    if (!KAIJUTSU_BY_ID.has(skillId) || !isKaijutsuUnlocked(skillId)) return;
    state.save.deckKaijutsu[state.selectedDeckIndex] = skillId;
    save();
    renderDeckKaijutsuSetting();
  });

  $("useKaijutsuButton")?.addEventListener("click", activateKaijutsu);

  $("deckNameInput").addEventListener("input", (event) => {
    const name = event.target.value.trim() || getDeckDefaultName(state.selectedDeckIndex);
    state.save.deckNames[state.selectedDeckIndex] = name;
    save();
    renderDeckTabsOnly();
  });

  $("setActiveDeck").addEventListener("click", () => {
    if (isLittleDeckIndex(state.selectedDeckIndex)) {
      $("deckMessage").textContent = "リトル専用デッキは、リトルルール時に自動で使用されます。通常使用デッキには設定できません。";
      $("deckMessage").style.color = "var(--danger)";
      return;
    }
    const error = validateDeck(state.save.decks[state.selectedDeckIndex]);
    if (error) {
      $("deckMessage").textContent = error;
      $("deckMessage").style.color = "var(--danger)";
      return;
    }
    state.save.activeDeckIndex = state.selectedDeckIndex;
    save();
    renderDeckScreen();
  });

  $("clearDeck").addEventListener("click", () => {
    state.save.decks[state.selectedDeckIndex] = [];
    save();
    renderDeckScreen();
  });

  $("effectToggle").addEventListener("change", (event) => {
    state.save.settings.effects = event.target.checked;
    save();
  });

  $("battleCardPopupToggle").addEventListener("change", (event) => {
    state.save.settings.battleCardPopup = event.target.checked;
    save();
  });

  const debugMoneyButton = $("debugMoneyButton");
  if (debugMoneyButton) {
    debugMoneyButton.addEventListener("click", () => {
      const passwordInput = $("debugPassword");
      const message = $("debugMessage");
      const password = String(passwordInput?.value ?? "");
      if (password !== "ps20240626") {
        if (message) {
          message.textContent = "パスワードが違います";
          message.style.color = "var(--danger)";
        }
        return;
      }
      addMoney(1000000);
      if (passwordInput) passwordInput.value = "";
      if (message) {
        message.textContent = "所持金を1,000,000銭増やしました。";
        message.style.color = "var(--success, #62d98b)";
      }
    });
  }

  $("checkUserName").addEventListener("click", () => checkUserNameAvailability(true));
  $("saveUserName").addEventListener("click", saveUserNameSetting);
  $("syncRankings").addEventListener("click", async () => {
    const result = $("userNameCheckResult");
    try {
      if (!getOnlineUserName()) {
        if (result) result.textContent = "先にユーザー名を保存してください。";
        return;
      }
      const profile = await syncPlayerRankings();
      renderProfileSummary(profile);
      if (result) result.textContent = "ランキング情報を更新しました。ランキング画面を開くと表示されます。";
    } catch (error) {
      if (result) result.textContent = `更新エラー：${error.message ?? error}`;
    }
  });

  $("exportSave").addEventListener("click", () => {
    $("saveText").value = btoa(unescape(encodeURIComponent(JSON.stringify(state.save))));
  });

  $("importSave").addEventListener("click", () => {
    try {
      const json = decodeURIComponent(escape(atob($("saveText").value.trim())));
      state.save = normalizeSave(JSON.parse(json));
      save();
      renderSettingsScreen();
      showModal("読み込み完了", "<p>セーブデータを読み込みました。</p>", [{ label: "閉じる", onClick: closeModal }]);
    } catch (error) {
      showModal("読み込み失敗", "<p>セーブデータの形式が正しくありません。</p>", [{ label: "閉じる", onClick: closeModal }]);
    }
  });

  $("resetSave").addEventListener("click", () => {
    showModal("初期化確認", "<p>所持カード・デッキ・図鑑情報を初期化します。</p>", [
      {
        label: "初期化する",
        className: "danger",
        onClick: () => {
          state.save = createInitialSave();
          save();
          closeModal();
          showScreen("title");
        }
      },
      { label: "キャンセル", className: "ghost", onClick: closeModal }
    ]);
  });

  $("giveUpButton").addEventListener("click", () => confirmBattleExit("battleMenu"));

  $("refreshShop").addEventListener("click", () => {
    const fee = getShopRefreshFee();
    if (!spendMoney(fee)) {
      showShopMessage(`品揃えの更新には${formatMoney(fee)}が必要です。`, true);
      renderShopScreen();
      return;
    }
    refreshShopStock();
    state.shopInitialized = true;
    showShopMessage(`品揃えを更新しました。${formatMoney(fee)}を支払いました。`);
    renderShopScreen();
  });

  window.addEventListener("resize", scheduleBattleAutoFit);
  window.addEventListener("orientationchange", () => setTimeout(scheduleBattleAutoFit, 180));
}

function init() {
  loadSave();
  bindEvents();
  showScreen("title");
}

init();
registerServiceWorker();
