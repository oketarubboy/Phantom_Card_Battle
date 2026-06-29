import { CARDS } from "./src/data/cards.js";
import { NPCS } from "./src/data/npcs.js";

const VERSION = "0.1.6";
const SAVE_KEY = "phantom_card_battle_save_v1";

const cardById = new Map(CARDS.map((card) => [card.id, card]));
const npcById = new Map(NPCS.map((npc) => [npc.id, npc]));

const state = {
  save: null,
  selectedDeckIndex: 0,
  selectedHandIndex: null,
  deckSort: { field: "rarity", order: "desc" },
  ownedCardView: "vertical",
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
  battleMenu: $("screen-battle-menu"),
  battle: $("screen-battle"),
  deck: $("screen-deck"),
  collection: $("screen-collection"),
  settings: $("screen-settings")
};

const DECK_SORT_FIELDS = new Set(["name", "rarity", "right", "up", "left", "down", "power"]);

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
  return value === 10 ? "A" : String(value);
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

function getRareChanceRate(npc) {
  return Number.isFinite(npc.rareChanceRate) ? npc.rareChanceRate : getNpcNumber(npc);
}

function getRareChanceMaxRarity(npc) {
  if (npc.difficulty === "よわい") return 3;
  if (npc.difficulty === "ふつう") return 4;
  return 5;
}

function getRewardWeights(npc) {
  const rare = Math.min(Math.max(getRareChanceRate(npc), 0), 100);
  const remaining = 100 - rare;
  return {
    random_one: remaining * (70 / 95),
    choose_one: remaining * (25 / 95),
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
  Object.values(screens).forEach((screen) => screen.classList.remove("active"));
  screens[name].classList.add("active");
  document.body.classList.toggle("is-battle-screen", name === "battle");
  $("backTitleBtn").style.visibility = name === "title" ? "hidden" : "visible";
  if (name === "battle") scheduleBattleAutoFit();

  if (name === "deck") renderDeckScreen();
  if (name === "collection") renderCollectionScreen();
  if (name === "settings") renderSettingsScreen();
  if (name === "battleMenu") renderNpcList();
}

function createInitialSave() {
  const starterCards = CARDS
    .filter((card) => card.rarity === 1 || card.rarity === 2)
    .sort((a, b) => a.rarity - b.rarity || a.power - b.power || Number(String(a.no).replace(/\D/g, "")) - Number(String(b.no).replace(/\D/g, "")))
    .slice(0, 30);

  const ownedCards = {};
  for (const card of starterCards) {
    ownedCards[card.id] = card.rarity === 1 ? 2 : 1;
  }

  const firstDeck = starterCards.slice(0, 5).map((card) => card.id);

  return {
    version: VERSION,
    activeDeckIndex: 0,
    selectedDeckIndex: 0,
    ownedCards,
    discoveredCards: Object.fromEntries(starterCards.map((card) => [card.id, true])),
    decks: [firstDeck, [], [], [], []],
    npcWins: {},
    settings: {
      effects: true,
      ownedCardView: "vertical"
    }
  };
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

  normalized.decks = Array.from({ length: 5 }, (_, index) => {
    const deck = Array.isArray(save?.decks?.[index]) ? save.decks[index] : [];
    return deck.filter((cardId) => cardById.has(cardId)).slice(0, 5);
  });

  normalized.ownedCards = normalized.ownedCards ?? {};
  normalized.discoveredCards = normalized.discoveredCards ?? {};
  normalized.npcWins = normalized.npcWins ?? {};
  normalized.activeDeckIndex = Number.isInteger(normalized.activeDeckIndex) ? Math.min(Math.max(normalized.activeDeckIndex, 0), 4) : 0;
  normalized.selectedDeckIndex = Number.isInteger(normalized.selectedDeckIndex) ? Math.min(Math.max(normalized.selectedDeckIndex, 0), 4) : 0;

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
  save();
}

function save() {
  state.save.version = VERSION;
  state.save.selectedDeckIndex = state.selectedDeckIndex;
  localStorage.setItem(SAVE_KEY, JSON.stringify(state.save));
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

function validateDeck(deck) {
  const cards = deck.map((id) => cardById.get(id)).filter(Boolean);
  const star5 = cards.filter((card) => card.rarity === 5).length;
  const star4 = cards.filter((card) => card.rarity === 4).length;

  for (const card of cards) {
    if (countInDeck(deck, card.id) > getOwnedCount(card.id)) {
      return `「${card.name}」の所持数が足りません。`;
    }
  }

  if (deck.length !== 5) return "デッキは5枚必要です。";
  if (star5 > 1) return "★5は1枚までです。";
  if (star4 > 2) return "★4は2枚までです。";
  return "";
}

function canAddToDeck(deck, cardId) {
  const card = cardById.get(cardId);
  if (!card) return "カードが見つかりません。";
  if (deck.length >= 5) return "デッキは5枚までです。";
  if (countInDeck(deck, cardId) >= getOwnedCount(cardId)) return "所持数を超えて追加できません。";

  const after = [...deck, cardId].map((id) => cardById.get(id));
  if (after.filter((c) => c.rarity === 5).length > 1) return "★5は1枚までです。";
  if (after.filter((c) => c.rarity === 4).length > 2) return "★4は2枚までです。";
  return "";
}

function cardValuesHtml(card, center = "") {
  return `
    <div class="card-values">
      <span class="v-up">${displayValue(card.up)}</span>
      <span class="v-right">${displayValue(card.right)}</span>
      <span class="v-down">${displayValue(card.down)}</span>
      <span class="v-left">${displayValue(card.left)}</span>
      <span class="v-center">${center}</span>
    </div>
  `;
}

function cardMiniHtml(card, extra = "") {
  return `
    <div class="card-stars">${rarityStars(card.rarity)}</div>
    ${cardArtHtml(card)}
    <div class="card-name">${escapeHtml(card.name)}</div>
    ${cardValuesHtml(card, extra)}
  `;
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

function renderNpcList() {
  const list = $("npcList");
  list.innerHTML = "";

  for (const npc of NPCS) {
    const poolCards = npc.cardPool.map((id) => cardById.get(id)).filter(Boolean);
    const avgPower = poolCards.reduce((sum, card) => sum + card.power, 0) / Math.max(poolCards.length, 1);
    const maxRarity = Math.max(...poolCards.map((card) => card.rarity));
    const difficultyClass = npc.difficulty === "よわい" ? "weak" : npc.difficulty === "ふつう" ? "normal" : "strong";

    const item = document.createElement("div");
    item.className = "npc-card";
    item.innerHTML = `
      <h3>${escapeHtml(npc.name)} <span class="badge ${difficultyClass}">${npc.difficulty}</span></h3>
      <p class="muted">所持カード：${poolCards.length}枚 / 最大${rarityStars(maxRarity)} / 平均力 ${avgPower.toFixed(1)}</p>
      <p class="muted">レアチャンス率：${getRareChanceRate(npc)}% / 上限${rarityStars(getRareChanceMaxRarity(npc))}</p>
      <button data-npc-id="${npc.id}">対戦する</button>
    `;
    item.querySelector("button").addEventListener("click", () => startBattle(npc.id));
    list.appendChild(item);
  }
}

function renderDeckScreen() {
  const tabs = $("deckTabs");
  tabs.innerHTML = "";

  for (let i = 0; i < 5; i += 1) {
    const button = document.createElement("button");
    button.textContent = `デッキ${i + 1}${state.save.activeDeckIndex === i ? " 使用中" : ""}`;
    button.className = state.selectedDeckIndex === i ? "active" : "";
    button.addEventListener("click", () => {
      state.selectedDeckIndex = i;
      save();
      renderDeckScreen();
    });
    tabs.appendChild(button);
  }

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
      row.querySelector("button").addEventListener("click", () => {
        deck.splice(i, 1);
        save();
        renderDeckScreen();
      });
    }
    box.appendChild(row);
  }

  const error = validateDeck(deck);
  $("deckMessage").textContent = error ? error : "このデッキは使用できます。";
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
      const error = canAddToDeck(deck, card.id);
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
      ? `${cardMiniHtml(card, `x${owned}`)}<small>No.${escapeHtml(card.no)}</small>`
      : `
        <div class="card-stars">${rarityStars(card.rarity)}</div>
        <div class="card-name">???</div>
        <div class="card-values">
          <span class="v-up">?</span><span class="v-right">?</span><span class="v-down">?</span><span class="v-left">?</span><span class="v-center">?</span>
        </div>
        <small>No.${escapeHtml(card.no)}</small>
      `;
    grid.appendChild(div);
  }
}

function renderSettingsScreen() {
  $("effectToggle").checked = Boolean(state.save.settings.effects);
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
  $("modal").classList.add("hidden");
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


    const placed = state.battle?.board[index];
    if (placed) {
      boardLayer.addChild(createPixiCard(placed.card, placed.owner, pos.x + 8, pos.y + 8));
    }
  }
}

function createPixiCard(card, owner, x, y) {
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

  const shine = new PIXI.Graphics();
  shine.beginFill(0xffffff, 0.08);
  shine.drawRoundedRect(8, 8, 100, 26, 12);
  shine.endFill();
  container.addChild(shine);

  const art = PIXI.Sprite.from(getCardImagePath(card));
  art.anchor.set(0.5);
  art.x = 58;
  art.y = 60;
  art.width = 70;
  art.height = 70;
  art.alpha = 0.58;
  container.addChild(art);

  const name = new PIXI.Text(card.name, {
    fontFamily: "Arial",
    fontSize: 12,
    fontWeight: "bold",
    fill: 0xffffff,
    wordWrap: true,
    wordWrapWidth: 98,
    align: "center"
  });
  name.anchor.set(0.5, 0);
  name.x = 58;
  name.y = 42;
  container.addChild(name);

  const star = new PIXI.Text(rarityStars(card.rarity), {
    fontFamily: "Arial",
    fontSize: 12,
    fill: 0xffd66b
  });
  star.anchor.set(0.5, 0);
  star.x = 58;
  star.y = 10;
  container.addChild(star);

  addValueText(container, displayValue(card.up), 58, 24);
  addValueText(container, displayValue(card.right), 92, 58);
  addValueText(container, displayValue(card.down), 58, 92);
  addValueText(container, displayValue(card.left), 24, 58);

  return container;
}

function addValueText(container, text, x, y) {
  const bg = new PIXI.Graphics();
  bg.beginFill(0x000000, 0.26);
  bg.drawRoundedRect(x - 13, y - 12, 26, 24, 8);
  bg.endFill();
  container.addChild(bg);

  const label = new PIXI.Text(text, {
    fontFamily: "Arial",
    fontSize: 16,
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

  const playerHand = $("playerHand");
  playerHand.innerHTML = "";
  battle.playerHand.forEach((entry, index) => {
    const div = document.createElement("div");
    div.className = `mini-card ${entry.used ? "used" : ""} ${state.selectedHandIndex === index ? "selected" : ""}`;
    div.innerHTML = cardMiniHtml(entry.card);
    if (!entry.used && battle.currentTurn === "player" && !battle.locked) {
      div.addEventListener("click", () => {
        state.selectedHandIndex = state.selectedHandIndex === index ? null : index;
        renderBattleHands();
      });
    }
    playerHand.appendChild(div);
  });

  const npcHand = $("npcHand");
  npcHand.innerHTML = "";
  const revealNpcHand = battle.npc.difficulty === "よわい";
  battle.npcHand.forEach((entry) => {
    const div = document.createElement("div");
    if (revealNpcHand) {
      div.className = `mini-card opponent-open ${entry.used ? "used" : ""}`;
      div.innerHTML = cardMiniHtml(entry.card, entry.used ? "済" : "NPC");
    } else {
      div.className = "card-back";
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

async function startBattle(npcId) {
  const npc = npcById.get(npcId);
  const deck = state.save.decks[state.save.activeDeckIndex];
  const error = validateDeck(deck);
  if (error) {
    showModal("デッキ確認", `<p>${escapeHtml(error)}</p><p>デッキ画面で5枚のデッキを作成してください。</p>`, [
      { label: "デッキへ", onClick: () => { closeModal(); showScreen("deck"); } },
      { label: "閉じる", className: "ghost", onClick: closeModal }
    ]);
    return;
  }

  const npcDeck = sample(npc.cardPool, 5).map((id) => cardById.get(id)).filter(Boolean);
  state.battle = {
    npc,
    playerHand: deck.map((id) => ({ card: cardById.get(id), used: false })),
    npcHand: npcDeck.map((card) => ({ card, used: false })),
    npcBattleCards: npcDeck,
    board: Array(9).fill(null),
    currentTurn: "coin",
    locked: true,
    finished: false
  };
  const battleToken = state.battle;
  state.selectedHandIndex = null;

  showScreen("battle");
  $("battleNpcName").textContent = `${npc.name} / ${npc.difficulty}`;
  $("battleLog").innerHTML = "";
  addBattleLog(`${npc.name}との対戦を開始しました。`);
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
        <div class="coin-toss-coin">PCB</div>
        <p id="coinTossText">コイントス中...</p>
      </div>
    `,
    []
  );

  await delay(1600);

  const coin = document.querySelector(".coin-toss-coin");
  const text = $("coinTossText");
  if (coin) coin.classList.add(firstTurn === "player" ? "coin-player" : "coin-npc");
  if (text) text.textContent = firstTurn === "player" ? "表：プレイヤーが先攻です。" : "裏：相手が先攻です。";

  await delay(900);
  closeModal();
  return firstTurn;
}

async function handleBoardClick(index) {
  const battle = state.battle;
  if (!battle || battle.locked || battle.finished || battle.currentTurn !== "player") return;
  if (battle.board[index]) return;
  if (state.selectedHandIndex === null) {
    addBattleLog("手札を1枚選択してください。");
    return;
  }

  const hand = battle.playerHand[state.selectedHandIndex];
  if (!hand || hand.used) return;

  battle.locked = true;
  await playCard("player", state.selectedHandIndex, index);
  state.selectedHandIndex = null;
  battle.locked = false;

  if (!checkBattleEnd()) {
    battle.currentTurn = "npc";
    renderBattleHands();
    setTimeout(() => npcTurn(), 550);
  }
}

async function playCard(owner, handIndex, boardIndex) {
  const battle = state.battle;
  const hand = owner === "player" ? battle.playerHand : battle.npcHand;
  const entry = hand[handIndex];
  entry.used = true;
  battle.board[boardIndex] = { card: entry.card, owner };
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

async function resolveCaptures(boardIndex) {
  const battle = state.battle;
  const placed = battle.board[boardIndex];
  const captured = [];
  const neighbors = getNeighbors(boardIndex);

  for (const neighbor of neighbors) {
    const target = battle.board[neighbor.index];
    if (!target || target.owner === placed.owner) continue;
    if (placed.card[neighbor.side] > target.card[neighbor.opposite]) {
      target.owner = placed.owner;
      captured.push(neighbor.index);
      renderBoard();
      await animateFlip(neighbor.index, placed.owner);
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
  battle.locked = false;

  if (!checkBattleEnd()) {
    battle.currentTurn = "player";
    renderBattleHands();
    addBattleLog("プレイヤーのターンです。");
  }
}

function legalMovesFor(hand, board) {
  const emptyIndexes = board
    .map((cell, index) => cell ? null : index)
    .filter((index) => index !== null);

  const moves = [];
  hand.forEach((entry, handIndex) => {
    if (entry.used) return;
    for (const boardIndex of emptyIndexes) {
      moves.push({ handIndex, boardIndex, card: entry.card });
    }
  });
  return moves;
}

function chooseNpcMove() {
  const battle = state.battle;
  const moves = legalMovesFor(battle.npcHand, battle.board);
  if (moves.length === 0) return null;

  if (battle.npc.difficulty === "よわい") {
    return moves[Math.floor(Math.random() * moves.length)];
  }

  if (battle.npc.difficulty === "ふつう") {
    const scored = moves.map((move) => ({
      move,
      score: simulateMove(battle.board, move.card, "npc", move.boardIndex).captured
    })).sort((a, b) => b.score - a.score);

    if (scored[0].score > 0) return scored[0].move;
    return moves[Math.floor(Math.random() * moves.length)];
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
    const playerMoves = legalMovesFor(battle.playerHand, sim.board);
    for (const pMove of playerMoves) {
      const counter = simulateMove(sim.board, pMove.card, "player", pMove.boardIndex);
      const scoreAfterCounter = boardAdvantageForNpc(counter.board, playerRemaining - 1, npcRemaining);
      worstCounter = Math.max(worstCounter, -scoreAfterCounter + counter.captured * 18);
    }

    const score = boardAdvantageForNpc(sim.board, playerRemaining, npcRemaining) * 24
      + sim.captured * 42
      + safetyScore(sim.board, move.boardIndex, "npc")
      + move.card.power
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

  return exposedSides.reduce((sum, neighbor) => sum + placed.card[neighbor.side], 0) / exposedSides.length;
}

function simulateMove(board, card, owner, boardIndex) {
  const copy = board.map((cell) => cell ? { card: cell.card, owner: cell.owner } : null);
  copy[boardIndex] = { card, owner };
  let captured = 0;

  for (const neighbor of getNeighbors(boardIndex)) {
    const target = copy[neighbor.index];
    if (!target || target.owner === owner) continue;
    if (card[neighbor.side] > target.card[neighbor.opposite]) {
      target.owner = owner;
      captured += 1;
    }
  }

  return { board: copy, captured };
}

function checkBattleEnd() {
  const battle = state.battle;
  if (!battle) return true;
  const boardFull = battle.board.every(Boolean);
  const noPlayableCards = battle.playerHand.every((entry) => entry.used) && battle.npcHand.every((entry) => entry.used);

  if (!boardFull && !noPlayableCards) return false;

  battle.finished = true;
  renderBattleAll();

  const score = calcScore();
  if (score.player > score.npc) {
    addBattleLog(`勝利！ ${score.player} - ${score.npc}`);
    state.save.npcWins[battle.npc.id] = (state.save.npcWins[battle.npc.id] ?? 0) + 1;
    save();
    handleReward();
  } else if (score.player < score.npc) {
    addBattleLog(`敗北... ${score.player} - ${score.npc}`);
    showModal("敗北", `<p>今回はカードを獲得できませんでした。</p><p>スコア：自分 ${score.player} - ${score.npc} 相手</p>`, [
      { label: "再戦", onClick: () => { closeModal(); startBattle(battle.npc.id); } },
      { label: "対戦相手選択", className: "ghost", onClick: () => { closeModal(); showScreen("battleMenu"); } }
    ]);
  } else {
    addBattleLog(`引き分け ${score.player} - ${score.npc}`);
    showModal("引き分け", `<p>引き分けのためカード獲得はありません。</p>`, [
      { label: "再戦", onClick: () => { closeModal(); startBattle(battle.npc.id); } },
      { label: "対戦相手選択", className: "ghost", onClick: () => { closeModal(); showScreen("battleMenu"); } }
    ]);
  }

  return true;
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
    const choices = battle.npcBattleCards;
    showModal(
      "報酬：好きなカードを1枚選択",
      `<p>報酬抽選：指定選択</p><div class="reward-grid">${choices.map((card) => rewardCardHtml(card)).join("")}</div>`,
      [{
        label: "ランダムで受け取る",
        className: "ghost",
        onClick: () => {
          const card = choices[Math.floor(Math.random() * choices.length)];
          addOwnedCard(card.id);
          closeModal();
          showRewardResult(card, "指定選択をランダム受け取りにしました。");
        }
      }]
    );

    document.querySelectorAll("[data-reward-card-id]").forEach((element) => {
      element.addEventListener("click", () => {
        const cardId = element.getAttribute("data-reward-card-id");
        const card = cardById.get(cardId);
        addOwnedCard(cardId);
        closeModal();
        showRewardResult(card, "指定選択で獲得しました。");
      });
    });
    return;
  }

  if (rule === "rare_chance") {
    const maxRarity = getRareChanceMaxRarity(battle.npc);
    const rareCards = shuffle(CARDS.filter((card) => card.rarity <= maxRarity))
      .sort((a, b) => {
        const ownedA = getOwnedCount(a.id) > 0 ? 1 : 0;
        const ownedB = getOwnedCount(b.id) > 0 ? 1 : 0;
        return ownedA - ownedB || b.rarity - a.rarity || b.power - a.power;
      });
    const card = rareCards[Math.floor(Math.random() * Math.min(rareCards.length, 30))];
    addOwnedCard(card.id);
    showRewardResult(card, `レアチャンス ${getRareChanceRate(battle.npc)}% に当選しました。${battle.npc.difficulty}の上限は${rarityStars(maxRarity)}です。`);
    return;
  }

  const card = battle.npcBattleCards[Math.floor(Math.random() * battle.npcBattleCards.length)];
  addOwnedCard(card.id);
  showRewardResult(card, "ランダム報酬で獲得しました。");
}

function rewardCardHtml(card) {
  return `
    <div class="reward-card" data-reward-card-id="${card.id}">
      <strong>${escapeHtml(card.name)}</strong><br>
      <small>${rarityStars(card.rarity)}</small>
      <div class="card-values">
        <span class="v-up">${displayValue(card.up)}</span>
        <span class="v-right">${displayValue(card.right)}</span>
        <span class="v-down">${displayValue(card.down)}</span>
        <span class="v-left">${displayValue(card.left)}</span>
        <span class="v-center">GET</span>
      </div>
    </div>
  `;
}

function showRewardResult(card, reason) {
  showModal(
    "カード獲得",
    `<p>${escapeHtml(reason)}</p><div class="reward-grid">${rewardCardHtml(card)}</div>`,
    [
      { label: "再戦", onClick: () => { const npcId = state.battle.npc.id; closeModal(); startBattle(npcId); } },
      { label: "対戦相手選択", className: "ghost", onClick: () => { closeModal(); showScreen("battleMenu"); } },
      { label: "図鑑を見る", className: "ghost", onClick: () => { closeModal(); showScreen("collection"); } }
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
  $("backTitleBtn").addEventListener("click", () => showScreen("title"));

  $("goBattle").addEventListener("click", () => showScreen("battleMenu"));
  $("goDeck").addEventListener("click", () => showScreen("deck"));
  $("goCollection").addEventListener("click", () => showScreen("collection"));
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

  $("setActiveDeck").addEventListener("click", () => {
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

  $("giveUpButton").addEventListener("click", () => {
    state.battle = null;
    showScreen("battleMenu");
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
