/**
 * أونو — Phase 1: بنية اللوبي وتوزيع الكوتشينة ودور اللاعبين. كروت الأكشن
 * الخاصة (Skip, Reverse, Draw Two, Wild...) معمول لها موضع في الكود
 * (actionCards) بس تفعيلها الكامل TODO.
 */

export const meta = {
  id: 'uno',
  name: 'أونو',
  minPlayers: 2,
  maxPlayers: 6
};

const COLORS = ['red', 'yellow', 'green', 'blue'];
const ACTION_CARDS = ['skip', 'reverse', 'draw_two'];

function buildDeck() {
  const deck = [];
  for (const color of COLORS) {
    for (let n = 0; n <= 9; n++) {
      deck.push({ color, value: String(n) });
      if (n > 0) deck.push({ color, value: String(n) }); // كل رقم غير الصفر مرتين
    }
    for (const action of ACTION_CARDS) {
      deck.push({ color, value: action });
      deck.push({ color, value: action });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'wild' });
    deck.push({ color: 'wild', value: 'wild_draw_four' });
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createInitialState(players) {
  const deck = shuffle(buildDeck());
  const hands = {};
  players.forEach((p, i) => {
    hands[p.userId] = deck.slice(i * 7, (i + 1) * 7);
  });
  const drawPile = deck.slice(players.length * 7);
  const discardPile = [drawPile.pop()];

  return {
    gameId: meta.id,
    status: 'in_progress',
    turnIndex: 0,
    direction: 1, // 1 = مع عقارب الساعة، -1 = عكسها (بيتقلب مع Reverse)
    players: players.map(p => ({ userId: p.userId, username: p.username })),
    hands,
    drawPile,
    discardPile,
    winner: null
  };
}

export function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function nextTurn(state) {
  const n = state.players.length;
  state.turnIndex = (state.turnIndex + state.direction + n) % n;
}

/**
 * @param {object} state
 * @param {string} userId
 * @param {{type: 'play_card'|'draw', card?: {color:string,value:string}}} move
 */
export function applyMove(state, userId, move) {
  if (state.status !== 'in_progress') return { state, events: [], error: 'اللعبة خلصت' };
  const player = currentPlayer(state);
  if (player.userId !== userId) return { state, events: [], error: 'مش دورك' };

  if (move?.type === 'draw') {
    if (state.drawPile.length === 0) return { state, events: [], error: 'الكوتشينة خلصت' };
    const card = state.drawPile.pop();
    state.hands[userId].push(card);
    nextTurn(state);
    return { state, events: [{ type: 'card_drawn', userId }] };
  }

  if (move?.type === 'play_card') {
    // تحقق سيرفر: الكارت لازم يكون فعلاً في إيد اللاعب، ويطابق اللون/الرقم
    // (أو يكون Wild). من غير ده أي عميل كان يقدر يلعب كروت مش معاه ويكسب.
    // TODO: تفعيل تأثير كروت الأكشن + اختيار لون الـ Wild.
    const card = move.card;
    const hand = state.hands[userId];
    const idx = card ? hand.findIndex(c => c.color === card.color && c.value === card.value) : -1;
    if (idx === -1) return { state, events: [], error: 'الكارت ده مش في إيدك' };
    const top = state.discardPile[state.discardPile.length - 1];
    const matches = card.color === 'wild' || !top || top.color === 'wild' || top.color === card.color || top.value === card.value;
    if (!matches) return { state, events: [], error: 'الكارت ده مبيطابقش' };
    hand.splice(idx, 1); // بنشيل كارت واحد بس (كان بيشيل كل النسخ المكررة)
    state.discardPile.push({ color: card.color, value: card.value });
    if (state.hands[userId].length === 0) {
      state.status = 'finished';
      state.winner = userId;
      return { state, events: [{ type: 'game_finished', winner: userId }] };
    }
    nextTurn(state);
    return { state, events: [{ type: 'card_played', userId, card }] };
  }

  return { state, events: [], error: 'حركة غير مدعومة' };
}

export default { meta, createInitialState, applyMove, currentPlayer };
