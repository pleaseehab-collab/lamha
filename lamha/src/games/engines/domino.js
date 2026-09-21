/**
 * الدومينو — Phase 1: بنية اللوبي، توزيع القطع، دور اللاعبين. منطق التحقق
 * من صحة النقلة على الطاولة (matching pips) TODO.
 */

export const meta = {
  id: 'domino',
  name: 'الدومينو',
  minPlayers: 2,
  maxPlayers: 4
};

function buildDeck() {
  const deck = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) deck.push([a, b]);
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
  const handSize = players.length > 2 ? 6 : 7;
  const hands = {};
  players.forEach((p, i) => {
    hands[p.userId] = deck.slice(i * handSize, (i + 1) * handSize);
  });

  return {
    gameId: meta.id,
    status: 'in_progress',
    turnIndex: 0,
    players: players.map(p => ({ userId: p.userId, username: p.username })),
    hands,
    boneyard: deck.slice(players.length * handSize),
    table: [], // TODO: تمثيل خط الدومينو على الطاولة [[a,b], ...]
    winner: null
  };
}

export function currentPlayer(state) {
  return state.players[state.turnIndex];
}

function nextTurn(state) {
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
}

/**
 * @param {object} state
 * @param {string} userId
 * @param {{type: 'play_tile'|'draw', tile?: [number,number], side?: 'left'|'right'}} move
 */
export function applyMove(state, userId, move) {
  if (state.status !== 'in_progress') return { state, events: [], error: 'اللعبة خلصت' };
  const player = currentPlayer(state);
  if (player.userId !== userId) return { state, events: [], error: 'مش دورك' };

  if (move?.type === 'draw') {
    if (state.boneyard.length === 0) return { state, events: [], error: 'مفيش قطع تسحبها' };
    const tile = state.boneyard.pop();
    state.hands[userId].push(tile);
    nextTurn(state);
    return { state, events: [{ type: 'tile_drawn', userId }] };
  }

  if (move?.type === 'play_tile') {
    // تحقق سيرفر: القطعة لازم تكون في إيد اللاعب فعلاً (بأي اتجاه).
    // TODO: التحقق من مطابقة طرف الطاولة (matching pips).
    const t = Array.isArray(move.tile) ? move.tile : [];
    const hand = state.hands[userId];
    const idx = hand.findIndex(h => (h[0] === t[0] && h[1] === t[1]) || (h[0] === t[1] && h[1] === t[0]));
    if (idx === -1) return { state, events: [], error: 'القطعة دي مش في إيدك' };
    const [tile] = hand.splice(idx, 1);
    state.table.push(tile);
    if (state.hands[userId].length === 0) {
      state.status = 'finished';
      state.winner = userId;
      return { state, events: [{ type: 'game_finished', winner: userId }] };
    }
    nextTurn(state);
    return { state, events: [{ type: 'tile_played', userId, tile }] };
  }

  return { state, events: [], error: 'حركة غير مدعومة' };
}

export default { meta, createInitialState, applyMove, currentPlayer };
