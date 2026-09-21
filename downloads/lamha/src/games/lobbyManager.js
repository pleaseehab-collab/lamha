import { v4 as uuid } from 'uuid';
import ludo from './engines/ludo.js';
import domino from './engines/domino.js';
import uno from './engines/uno.js';
import pool from './engines/pool.js';
import { awardGameResult } from './pointsSystem.js';
import { logger } from '../utils/logger.js';
import { assertPlayerTurn } from './serverAuthoritative.js';

const ENGINES = { ludo, domino, uno, pool };

const lobbies = new Map(); // lobbyId -> lobby

function newLobby(gameType, hostUser) {
  const engine = ENGINES[gameType];
  if (!engine) throw new Error(`لعبة غير معروفة: ${gameType}`);
  return {
    id: uuid(),
    gameType,
    meta: engine.meta,
    status: 'waiting', // waiting -> in_progress -> finished
    hostUserId: hostUser.userId,
    players: [hostUser],
    state: null,
    createdAt: Date.now()
  };
}

export function listLobbies(gameType) {
  return [...lobbies.values()]
    .filter(l => !gameType || l.gameType === gameType)
    .filter(l => l.status === 'waiting')
    .map(summarize);
}

function summarize(lobby) {
  return {
    id: lobby.id,
    gameType: lobby.gameType,
    name: lobby.meta.name,
    status: lobby.status,
    players: lobby.players.map(p => ({ userId: p.userId, username: p.username })),
    minPlayers: lobby.meta.minPlayers,
    maxPlayers: lobby.meta.maxPlayers,
    hostUserId: lobby.hostUserId
  };
}

export function createLobby(gameType, hostUser) {
  const lobby = newLobby(gameType, hostUser);
  lobbies.set(lobby.id, lobby);
  return lobby;
}

export function getLobby(lobbyId) {
  return lobbies.get(lobbyId) || null;
}

export function joinLobby(lobbyId, user) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return { ok: false, error: 'اللوبي مش موجود' };
  if (lobby.status !== 'waiting') return { ok: false, error: 'اللعبة بدأت بالفعل' };
  if (lobby.players.length >= lobby.meta.maxPlayers) return { ok: false, error: 'اللوبي مكتمل' };
  if (lobby.players.some(p => p.userId === user.userId)) return { ok: true, lobby };
  lobby.players.push(user);
  return { ok: true, lobby };
}

export function leaveLobby(lobbyId, userId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return { ok: false, error: 'اللوبي مش موجود' };
  lobby.players = lobby.players.filter(p => p.userId !== userId);
  if (lobby.players.length === 0) {
    lobbies.delete(lobbyId);
    return { ok: true, removed: true };
  }
  if (lobby.hostUserId === userId) lobby.hostUserId = lobby.players[0].userId;
  return { ok: true, lobby };
}

export function startGame(lobbyId, requestedByUserId) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return { ok: false, error: 'اللوبي مش موجود' };
  if (lobby.hostUserId !== requestedByUserId) return { ok: false, error: 'المضيف بس اللي يقدر يبدأ اللعبة' };
  if (lobby.players.length < lobby.meta.minPlayers) {
    return { ok: false, error: `محتاج ${lobby.meta.minPlayers} لاعبين على الأقل` };
  }
  const engine = ENGINES[lobby.gameType];
  lobby.state = engine.createInitialState(lobby.players);
  lobby.status = 'in_progress';
  return { ok: true, lobby };
}

export function applyMove(lobbyId, userId, move) {
  const lobby = lobbies.get(lobbyId);
  if (!lobby) return { ok: false, error: 'اللوبي مش موجود' };
  if (lobby.status !== 'in_progress') return { ok: false, error: 'اللعبة لسه مبدأتش' };
  const engine = ENGINES[lobby.gameType];

  // ⚠️ دفاع متعدد الطبقات (defense in depth): كل محرك (ludo/domino/uno)
  // بيتحقق من الدور جوّاه، لكن الفحص هنا مركزي على مستوى اللوبي عشان لو
  // اتضاف محرك جديد بعدين وناسي المطوّر يتحقق من الدور جواه، الطلب يترفض
  // من هنا برضو قبل ما يوصل للمحرك أصلاً — بدل ما نعتمد بس على التزام كل
  // محرك لوحده بالقاعدة.
  if (!assertPlayerTurn(engine, lobby.state, userId)) {
    logger.warn('محاولة حركة خارج الدور اتمنعت (defense-in-depth)', { lobbyId, userId, gameType: lobby.gameType });
    return { ok: false, error: 'مش دورك' };
  }

  const result = engine.applyMove(lobby.state, userId, move);
  if (result.error) return { ok: false, error: result.error };
  lobby.state = result.state;
  let awards = [];
  if (lobby.state.status === 'finished') {
    lobby.status = 'finished';
    // مكافأة النقاط بتتحسب هنا في السيرفر مرة واحدة بس (rewarded flag يمنع التكرار)
    if (!lobby.rewarded) {
      lobby.rewarded = true;
      awards = awardGameResult(lobby.gameType, lobby.players, lobby.state.winner);
    }
  }
  return { ok: true, lobby, events: result.events, awards };
}

// تنضيف اللوبيات القديمة اللي متفتحتش لعبة فيها (خمول أكتر من ساعة)
setInterval(() => {
  const now = Date.now();
  for (const [id, lobby] of lobbies.entries()) {
    if (lobby.status === 'waiting' && now - lobby.createdAt > 60 * 60_000) lobbies.delete(id);
  }
}, 10 * 60_000).unref();

export default { listLobbies, createLobby, getLobby, joinLobby, leaveLobby, startGame, applyMove };
