import { CARDS } from "./src/data/cards.js";
import { NPCS } from "./src/data/npcs.js";

const VERSION = "0.1.36";
const SAVE_KEY = "phantom_card_battle_save_v5_182_rules_npc15";

const cardById = new Map(CARDS.map((card) => [card.id, card]));
const npcById = new Map(NPCS.map((npc) => [npc.id, npc]));

const state = {
  save: null,
  selectedDeckIndex: 0,
  selectedHandIndex: null,
  deckSort: { field: "rarity", order: "desc" },
  ownedCardView: "vertical",
  battleCardPopup: true,
  selectedRuleIds: [],
  shopStock: [],
  shopInitialized: false,
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
  { id: "wild_card", name: "ワイルドカード", short: "各プレイヤーの手札1枚に、1辺+2またはA/1化のランダム変化が発生します。" },
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

function cloneCardForBattle(card, battleValues = null) {
  if (!card) return card;
  const cleanValues = battleValues && typeof battleValues === "object"
    ? Object.fromEntries(CARD_SIDES.map((side) => [side, clamp(Number(battleValues[side] ?? card[side] ?? 0), 1, 10)]))
    : null;
  return cleanValues ? { ...card, battleValues: cleanValues } : card;
}

function generateWildCardMods(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return {};
  const index = Math.floor(Math.random() * cards.length);
  const card = cards[index];
  if (!card) return {};
  const values = Object.fromEntries(CARD_SIDES.map((side) => [side, Number(card?.[side] ?? 0)]));
  if (Math.random() < 0.5) {
    const side = sample(CARD_SIDES, 1)[0];
    values[side] = clamp(values[side] + 2, 1, 10);
  } else {
    const sides = shuffle(CARD_SIDES);
    values[sides[0]] = 10;
    values[sides[1]] = 1;
  }
  return { [index]: values };
}

function applyWildCardModsToCards(cards, mods = {}) {
  return (cards ?? []).map((card, index) => cloneCardForBattle(card, mods?.[index] ?? mods?.[String(index)] ?? null));
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
  if (npc?.difficulty !== "つよい") return {};
  const indexes = shuffle(Array.from({ length: 9 }, (_, index) => index)).slice(0, 1 + Math.floor(Math.random() * 3));
  const values = [-2, -1, 1, 2];
  return Object.fromEntries(indexes.map((index) => [index, values[Math.floor(Math.random() * values.length)]]));
}

function createLockCellsForBattle(npc) {
  if (!npc || !["ふつう", "つよい"].includes(npc.difficulty)) return {};
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
  const baseSide = getMirrorSide(side, battle, boardIndex);
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
  if (number <= 2) return true;
  if (number >= 3 && number <= 6) return hasDefeatedNpc(2);
  if (number >= 7 && number <= 10) return [3, 4, 5, 6].every(hasDefeatedNpc);
  if (number >= 11 && number <= 14) return [7, 8, 9, 10].every(hasDefeatedNpc);
  if (number === 15) return [11, 12, 13, 14].every(hasDefeatedNpc);
  return false;
}

function getNpcUnlockMessage() {
  if (!hasDefeatedNpc(2)) return "NPC2に勝利するとNPC3〜6が解放されます。";
  if (![3, 4, 5, 6].every(hasDefeatedNpc)) return "NPC3〜6全員に勝利するとNPC7〜10が解放されます。";
  if (![7, 8, 9, 10].every(hasDefeatedNpc)) return "NPC7〜10全員に勝利するとNPC11〜14が解放されます。";
  if (![11, 12, 13, 14].every(hasDefeatedNpc)) return "NPC11〜14全員に勝利するとNPC15が解放されます。";
  return "すべての対戦相手が解放されています。";
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

function getRewardWeights(npc) {
  const number = getNpcNumber(npc);
  if (number >= 1 && number <= 6) return { random_one: 80, choose_one: 17, rare_chance: 3 };
  if (number >= 7 && number <= 10) return { random_one: 80, choose_one: 15, rare_chance: 5 };
  if (number >= 11 && number <= 14) return { random_one: 72, choose_one: 20, rare_chance: 8 };
  if (number === 15) return { random_one: 70, choose_one: 20, rare_chance: 10 };
  const rare = Math.min(Math.max(getRareChanceRate(npc), 0), 20);
  return { random_one: Math.max(0, 20 - rare), choose_one: 80, rare_chance: rare };
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
  normalized.activeDeckIndex = Number.isInteger(normalized.activeDeckIndex) ? Math.min(Math.max(normalized.activeDeckIndex, 0), NORMAL_DECK_COUNT - 1) : 0;
  normalized.selectedDeckIndex = Number.isInteger(normalized.selectedDeckIndex) ? Math.min(Math.max(normalized.selectedDeckIndex, 0), TOTAL_DECK_COUNT - 1) : 0;

  return normalized;
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
  const displayValues = values ?? { up: card.up, right: card.right, down: card.down, left: card.left };
  return `
    <div class="card-values">
      <span class="v-up">${displayValue(displayValues.up)}</span>
      <span class="v-right">${displayValue(displayValues.right)}</span>
      <span class="v-down">${displayValue(displayValues.down)}</span>
      <span class="v-left">${displayValue(displayValues.left)}</span>
      <span class="v-center">${center}</span>
    </div>
  `;
}

function cardMiniHtml(card, extra = "", options = {}) {
  const values = options.effective ? getCardValueSet(card) : { up: card.up, right: card.right, down: card.down, left: card.left };
  const typeMeta = getCardTypeMeta(card);
  const centerLabel = extra ? escapeHtml(extra) : "";
  const showName = options.showName !== false;
  const showTop = options.showTop !== false;
  const showValues = options.showValues !== false;
  const visualClasses = ["card-visual"];
  if (options.squareArt) visualClasses.push("square-art");
  if (options.detail) visualClasses.push("card-detail-visual");

  return `
    <div class="${visualClasses.join(" ")}" data-type="${typeMeta.key}" style="--card-type-color:${typeMeta.color};">
      ${cardArtHtml(card)}
      ${showTop ? `<div class="card-visual-top only-stars">
        <span class="card-stars">${rarityStars(card.rarity)}</span>
      </div>` : ""}
      ${showValues ? `<div class="card-visual-values">
        <span class="cv cv-up">${displayValue(values.up)}</span>
        <span class="cv cv-right">${displayValue(values.right)}</span>
        <span class="cv cv-down">${displayValue(values.down)}</span>
        <span class="cv cv-left">${displayValue(values.left)}</span>
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

function renderNpcList() {
  const panel = document.querySelector(".rule-panel");
  if (panel) {
    panel.innerHTML = `
      <h3>追加ルール</h3>
      <p class="muted">よわい：自由に設定可能</p>
      <p class="muted">ふつう：ランダムで追加ルールが1つ適用される</p>
      <p class="muted">つよい：ランダムで追加ルールが2つ適用される</p>
    `;
  }

  const list = $("npcList");
  const hiddenCount = NPCS.filter((npc) => !isNpcUnlocked(npc)).length;
  list.innerHTML = hiddenCount > 0
    ? `<div class="summary">${escapeHtml(getNpcUnlockMessage())}<br>未解放の対戦相手：${hiddenCount}人</div>`
    : "";

  for (const npc of NPCS) {
    if (!isNpcUnlocked(npc)) continue;
    const poolCards = getNpcCardPool(npc);
    const avgPower = poolCards.reduce((sum, card) => sum + card.power, 0) / Math.max(poolCards.length, 1);
    const maxRarity = poolCards.length ? Math.max(...poolCards.map((card) => card.rarity)) : 0;
    const difficultyClass = npc.difficulty === "よわい" ? "weak" : npc.difficulty === "ふつう" ? "normal" : "strong";
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

function renderDeckScreen() {
  renderDeckTabsOnly();

  const deckNameInput = $("deckNameInput");
  if (deckNameInput) deckNameInput.value = getDeckDisplayName(state.selectedDeckIndex);

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
      const card = cardById.get(cardId);
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

function renderOwnedCardList() {
  const query = $("cardSearch").value.trim().toLowerCase();
  const list = $("ownedCardList");
  const view = getOwnedCardView();
  list.className = `card-list owned-card-list view-${view}`;
  list.innerHTML = "";

  const owned = CARDS
    .filter((card) => getOwnedCount(card.id) > 0)
    .filter((card) => !query || card.name.toLowerCase().includes(query))
    .sort(compareOwnedCards);

  for (const card of owned) {
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
  const obtained = CARDS.filter((card) => state.save.discoveredCards[card.id]).length;
  $("collectionSummary").textContent = `取得済み：${obtained} / ${CARDS.length} 枚`;

  const grid = $("collectionGrid");
  grid.innerHTML = "";

  const cards = CARDS
    .filter((card) => !query || card.name.toLowerCase().includes(query))
    .sort((a, b) => Number(String(a.no).replace(/\D/g, "")) - Number(String(b.no).replace(/\D/g, "")));

  for (const card of cards) {
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
  $("modalTitle").textContent = title;
  $("modalBody").innerHTML = bodyHtml;
  const actionBox = $("modalActions");
  actionBox.innerHTML = "";
  for (const action of actions) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.className = action.className ?? "";
    button.addEventListener("click", action.onClick);
    actionBox.appendChild(button);
  }
  $("modal").classList.remove("hidden");
}

function closeModal() {
  const modal = $("modal");
  modal.classList.add("hidden");
  delete modal.dataset.onlineWaiting;
  delete modal.dataset.onlineRematchWaiting;
}

function getCardDetailHtml(card, options = {}) {
  const effective = Boolean(options.effective);
  return `
    <div class="card-detail-popup">
      <div class="card-detail-preview mini-card detail-card-card">
        ${cardMiniHtml(card, "", { effective, squareArt: true, detail: true })}
      </div>
      <div class="card-detail-meta">
        <div><strong>No.${escapeHtml(card.no)}</strong></div>
        <div>${rarityStars(card.rarity)} / 所持 ${getOwnedCount(card.id)}</div>
        <div>総合力 ${card.power}</div>
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
  addValueText(container, displayValue(values.up), 58, 18);
  addValueText(container, displayValue(values.right), 98, 58);
  addValueText(container, displayValue(values.down), 58, 98);
  addValueText(container, displayValue(values.left), 18, 58);

  if (isBattleCardPopupEnabled()) {
    container.eventMode = "static";
    container.cursor = "pointer";
    container.on("pointertap", (event) => {
      event.stopPropagation();
      showCardDetailPopup(card, { title: owner === "player" ? "場の自分カード" : "場の相手カード", effective: true });
    });
  }

  return container;
}

function addValueText(container, text, x, y) {
  const bg = new PIXI.Graphics();
  bg.beginFill(0x0b1020, 0.82);
  bg.lineStyle(1, 0xffffff, 0.16);
  bg.drawRoundedRect(x - 12, y - 10, 24, 20, 7);
  bg.endFill();
  container.addChild(bg);

  const label = new PIXI.Text(text, {
    fontFamily: "Arial",
    fontSize: 14,
    fontWeight: "bold",
    fill: 0xffffff
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

function renderBattleHands() {
  const battle = state.battle;
  if (!battle) return;

  const forcedPlayerIndex = getForcedHandIndex("player");
  const playerHand = $("playerHand");
  playerHand.innerHTML = "";
  battle.playerHand.forEach((entry, index) => {
    const div = document.createElement("div");
    const isForced = forcedPlayerIndex === index && battle.currentTurn === "player" && !entry.used;
    div.className = `mini-card ${entry.used ? "used" : ""} ${state.selectedHandIndex === index || isForced ? "selected" : ""} ${isForced ? "forced" : ""}`;
    div.innerHTML = cardMiniHtml(entry.card, isForced ? "指定" : "", { showName: false });
    applyCardTypeStyle(div, entry.card);

    const canSelect = !entry.used && battle.currentTurn === "player" && !battle.locked && forcedPlayerIndex === null;
    if (isBattleCardPopupEnabled()) {
      div.addEventListener("click", () => {
        showCardDetailPopup(entry.card, canSelect ? {
          title: "手札カード",
          onSelect: () => {
            state.selectedHandIndex = state.selectedHandIndex === index ? null : index;
            renderBattleHands();
          },
          selectLabel: state.selectedHandIndex === index ? "選択を解除" : "このカードを選ぶ"
        } : { title: "手札カード" });
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
      div.innerHTML = cardMiniHtml(entry.card, "", { showName: false });
      applyCardTypeStyle(div, entry.card);
      if (isBattleCardPopupEnabled()) {
        div.addEventListener("click", () => showCardDetailPopup(entry.card, { title: "相手の手札" }));
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
  if (npc.difficulty === "ふつう" && group1.length) {
    rolled.push(sample(group1, 1)[0]);
  } else if (npc.difficulty === "つよい") {
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

function showWeakRuleSelection(npc) {
  state.selectedRuleIds = [];
  showModal(
    "追加ルール設定",
    `
      <p><strong>${escapeHtml(npc.name)}</strong>は難易度「よわい」のため、追加ルールを自由に設定できます。</p>
      <p class="muted">オーダーとカオス、リバースとエースキラーは同時に付けられません。</p>
      <div id="weakRuleList" class="rule-list"></div>
      <p class="muted">挑戦料：${formatMoney(getNpcEntryFee(npc))} / 勝利報酬：${formatMoney(getNpcWinMoney(npc))}</p>
    `,
    [
      { label: "このルールで対戦開始", onClick: () => { const scope = $("weakRuleList"); const rules = getSelectedRuleIds(scope); closeModal(); startBattle(npc.id, rules); } },
      { label: "キャンセル", className: "ghost", onClick: closeModal }
    ]
  );
  renderRuleSelector("weakRuleList", RULES.map((rule) => rule.id), []);
}

function showRuleLottery(npc) {
  const rules = rollNpcAdditionalRules(npc);
  showModal(
    "追加ルール抽選",
    `
      <p><strong>${escapeHtml(npc.name)}</strong>との対戦では、追加ルールが自動で決まります。</p>
      <p class="rule-result-text">追加ルールは <strong>${escapeHtml(getRuleSummary(rules))}</strong> です。</p>
      ${getRuleDescriptionHtml(rules)}
      <p class="muted">挑戦料：${formatMoney(getNpcEntryFee(npc))} / 勝利報酬：${formatMoney(getNpcWinMoney(npc))}</p>
    `,
    [
      { label: "対戦開始", onClick: () => { closeModal(); startBattle(npc.id, rules); } }
    ]
  );
}

function prepareBattleStart(npcId) {
  const npc = npcById.get(npcId);
  if (!npc) return;
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
async function startBattle(npcId, selectedRules = null) {
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
  if (Number(state.save.money ?? 0) < entryFee) {
    showModal("所持金不足", `<p>${escapeHtml(npc.name)}への挑戦料は${formatMoney(entryFee)}です。</p><p>現在の所持金：${formatMoney(state.save.money)}</p>`, [
      { label: "ショップへ", onClick: () => { closeModal(); showScreen("shop"); } },
      { label: "閉じる", className: "ghost", onClick: closeModal }
    ]);
    return;
  }
  spendMoney(entryFee);

  const playerBattleDeck = deck.map((id) => cardById.get(id)).filter(Boolean);
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

  const preBattleForRules = { rules: selectedRules };
  if (selectedRules.includes("wild_card")) {
    const wild = setupWildCardForHands(playerHandCards, npcHandCards, preBattleForRules);
    playerHandCards = wild.playerCards;
    npcHandCards = wild.npcCards;
  }

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
    lockCells: createLockCellsForBattle(npc),
    entryFee,
    winMoney: getNpcWinMoney(npc),
    swapInfo
  };
  const battleToken = state.battle;
  state.selectedHandIndex = null;

  showScreen("battle");
  $("battleNpcName").textContent = `${npc.name} / ${npc.difficulty}`;
  $("battleLog").innerHTML = "";
  addBattleLog(`${npc.name}との対戦を開始しました。`);
  addBattleLog(`挑戦料として${formatMoney(entryFee)}を支払いました。敗北・棄権時は返金されません。`);
  addBattleLog(`勝利報酬：${formatMoney(getNpcWinMoney(npc))}`);
  addBattleLog(`追加ルール：${getRuleSummary(selectedRules)}`);
  addBattleLog(`使用デッキ：${getDeckDisplayName(deckIndex)}`);
  const fieldEntries = Object.entries(state.battle.fieldEffects ?? {});
  if (fieldEntries.length) addBattleLog(`フィールド効果：${fieldEntries.length}マスに効果が発生しました。`);
  if (["ふつう", "つよい"].includes(npc.difficulty)) addBattleLog("ロック：0〜1マスに隠しロックマスが発生する可能性があります。");
  if (selectedRules.includes("mirror")) addBattleLog("ミラー：場に出たカードは上下・左右の数字が入れ替わります。");
  if (selectedRules.includes("wild_card")) addBattleLog("ワイルドカード：お互いの手札1枚にランダム変化が発生しました。");
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
  if (battle.board[index]) return;

  const forcedIndex = getForcedHandIndex("player");
  const handIndex = forcedIndex !== null ? forcedIndex : state.selectedHandIndex;
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
      const placedValue = getEffectiveCardValue(placed.card, item.side, battle, board, boardIndex);
      const targetValue = getEffectiveCardValue(item.target.card, item.opposite, battle, board, item.index);
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
      const placedValue = getEffectiveCardValue(placed.card, item.side, battle, board, boardIndex);
      const targetValue = getEffectiveCardValue(item.target.card, item.opposite, battle, board, item.index);
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
    const placedValue = getEffectiveCardValue(placed.card, item.side, battle, board, boardIndex);
    const targetValue = getEffectiveCardValue(item.target.card, item.opposite, battle, board, item.index);
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

    for (const neighbor of getNeighbors(sourceIndex)) {
      const target = board[neighbor.index];
      if (!target || target.owner === owner || target.locked) continue;
      const sourceValue = getEffectiveCardValue(source.card, neighbor.side, battle, board, sourceIndex);
      const targetValue = getEffectiveCardValue(target.card, neighbor.opposite, battle, board, neighbor.index);
      if (sideBeats(sourceValue, targetValue, battle)) {
        target.owner = owner;
        if (!seen.has(neighbor.index)) {
          seen.add(neighbor.index);
          queue.push(neighbor.index);
          captured.push(neighbor.index);
        }
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

    while (comboQueue.length) {
      const sourceIndex = comboQueue.shift();
      const source = battle.board[sourceIndex];
      if (!source || source.owner !== placed.owner) continue;

      for (const neighbor of getNeighbors(sourceIndex)) {
        const target = battle.board[neighbor.index];
        if (!target || target.owner === placed.owner || target.locked) continue;
        const sourceValue = getEffectiveCardValue(source.card, neighbor.side, battle, battle.board, sourceIndex);
        const targetValue = getEffectiveCardValue(target.card, neighbor.opposite, battle, battle.board, neighbor.index);
        if (sideBeats(sourceValue, targetValue, battle)) {
          target.owner = placed.owner;
          captured.push(neighbor.index);
          comboCount += 1;
          if (!seen.has(neighbor.index)) {
            seen.add(neighbor.index);
            comboQueue.push(neighbor.index);
          }
          renderBoard();
          await animateFlip(neighbor.index, placed.owner);
        }
      }
    }

    if (comboCount) addBattleLog(`コンボ発動：${comboCount}枚を追加で変更しました。`);
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
  return { board: copy, captured: capturedIndexes.length + comboCaptured.length, typeBoosts: simBattle.typeBoosts };
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
    save();
    handleReward();
  } else if (score.player < score.npc) {
    addBattleLog(`敗北... ${score.player} - ${score.npc}`);
    showModal("敗北", `<p>今回はカードを獲得できませんでした。</p><p>挑戦料${formatMoney(battle.entryFee)}は返金されません。</p><p>スコア：自分 ${score.player} - ${score.npc} 相手</p>`, [
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

function rollRewardRule(npc) {
  const weights = getRewardWeights(npc);
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
  const rule = rollRewardRule(battle.npc);

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
    showRewardResult(card, `レアチャンス ${getRareChanceRate(battle.npc)}% に当選しました。対象：${getRareChanceLabel(battle.npc)}`);
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
  $("goCollection").addEventListener("click", () => showScreen("collection"));
  $("goRankings").addEventListener("click", () => showScreen("rankings"));
  $("goRules").addEventListener("click", () => showScreen("rules"));
  $("goSettings").addEventListener("click", () => showScreen("settings"));
  $("updateButton").addEventListener("click", forceUpdate);

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
