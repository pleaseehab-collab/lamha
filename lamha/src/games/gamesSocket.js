import { v4 as uuid } from 'uuid';
import * as lobbyManager from './lobbyManager.js';
import * as wheel from './engines/wheel.js';
import { logger } from '../utils/logger.js';
import { requireSocketAuth } from '../security/socketAuth.js';
import { createSocketActionLimiter, sanitizeClientPayload } from './serverAuthoritative.js';

/**
 * @param {import('socket.io').Server} io
 */
export function attachGames(io) {
  const gamesNs = io.of('/games');
  // مصادقة حقيقية بـ JWT بدل الوثوق بـ handshake.auth.userId اللي كان
  // بييجي زي ما هو من العميل من غير أي تحقق (ثغرة انتحال هوية/سرقة نقاط).
  gamesNs.use(requireSocketAuth);
  const checkActionRate = createSocketActionLimiter();

  gamesNs.on('connection', socket => {
    const userId = socket.data.userId || uuid();
    const username = (socket.handshake.auth?.username || `لاعب_${userId.slice(0, 4)}`).slice(0, 30);
    socket.data.userId = userId;
    socket.data.username = username;
    socket.data.lobbyId = null;
    socket.join(`user:${userId}`); // غرفة خاصة بالمستخدم لإرسال المكافآت له هو بس
    // العميل محتاج يعرف هويته عشان يحدد دوره (ludo.html وغيرها)
    socket.emit('games:me', { userId, username, authenticated: !!socket.data.authenticated });

    // --- عجلة الحظ: لعبة فردية فورية، مش محتاجة لوبي ---
    socket.on('wheel:spin', () => {
      if (!checkActionRate(socket)) return socket.emit('games:error', { error: 'حركات كتير بسرعة، هدّي شوية.' });
      const result = wheel.spin(userId);
      socket.emit('wheel:result', result);
    });

    // --- اللوبي: ليدو / دومينو / أونو ---
    socket.on('games:list', gameType => {
      socket.emit('games:list', lobbyManager.listLobbies(gameType));
    });

    socket.on('games:create', gameType => {
      try {
        const lobby = lobbyManager.createLobby(gameType, { userId, username });
        joinSocketRoom(socket, lobby.id);
        gamesNs.emit('games:list', lobbyManager.listLobbies());
        socket.emit('games:lobby', lobby);
      } catch (err) {
        socket.emit('games:error', { error: err.message });
      }
    });

    socket.on('games:join', lobbyId => {
      const result = lobbyManager.joinLobby(lobbyId, { userId, username });
      if (!result.ok) return socket.emit('games:error', { error: result.error });
      joinSocketRoom(socket, lobbyId);
      gamesNs.to(lobbyId).emit('games:lobby', result.lobby);
      gamesNs.emit('games:list', lobbyManager.listLobbies());
    });

    socket.on('games:leave', () => {
      const lobbyId = socket.data.lobbyId;
      if (!lobbyId) return;
      const result = lobbyManager.leaveLobby(lobbyId, userId);
      socket.leave(lobbyId);
      socket.data.lobbyId = null;
      if (result.ok && !result.removed) gamesNs.to(lobbyId).emit('games:lobby', result.lobby);
      gamesNs.emit('games:list', lobbyManager.listLobbies());
    });

    socket.on('games:start', () => {
      const lobbyId = socket.data.lobbyId;
      if (!lobbyId) return;
      const result = lobbyManager.startGame(lobbyId, userId);
      if (!result.ok) return socket.emit('games:error', { error: result.error });
      gamesNs.to(lobbyId).emit('games:state', result.lobby);
      gamesNs.emit('games:list', lobbyManager.listLobbies()); // اللوبي اختفى من قايمة الانتظار
    });

    /**
     * المسار الموحّد لكل حركات الألعاب. `expectedGame` (اختياري) بيتأكد إن
     * اللوبي الحالي هو فعلاً اللعبة المقصودة — عشان أحداث زي pool:shoot
     * مينفعش تتنفذ على لوبي ليدو مثلاً.
     */
    function handleMove(move, expectedGame) {
      if (!checkActionRate(socket)) return socket.emit('games:error', { error: 'حركات كتير بسرعة، هدّي شوية.' });
      const lobbyId = socket.data.lobbyId;
      if (!lobbyId) return socket.emit('games:error', { error: 'مش داخل أي لوبي' });
      const lobby = lobbyManager.getLobby(lobbyId);
      if (expectedGame && lobby?.gameType !== expectedGame) {
        return socket.emit('games:error', { error: 'الحركة دي مش تابعة للعبة الحالية' });
      }
      // بنشيل أي فيلد العميل ممكن يحاول يبعته كأنه "نتيجة" (نرد، فايز...)
      // — النتيجة دايماً لازم تتحسب جوه lobbyManager/محرك اللعبة نفسه.
      const safeMove = sanitizeClientPayload(move);
      const result = lobbyManager.applyMove(lobbyId, userId, safeMove);
      if (!result.ok) return socket.emit('games:error', { error: result.error });

      // الأحداث الأول (فيها frames أنيميشن البلياردو)، وبعدها الحالة النهائية
      if (result.events?.length) gamesNs.to(lobbyId).emit('games:events', { lobbyId, events: result.events });
      if (lobby.gameType === 'pool') {
        const shot = result.events?.find(e => e.type === 'shot_result');
        if (shot) gamesNs.to(lobbyId).emit('pool:shot_result', { lobbyId, ...shot });
      }
      gamesNs.to(lobbyId).emit('games:state', result.lobby);

      if (result.lobby.status === 'finished') {
        logger.info('لعبة خلصت', { lobbyId, gameType: result.lobby.gameType, winner: result.lobby.state.winner });
        gamesNs.emit('games:list', lobbyManager.listLobbies());
        for (const award of result.awards || []) {
          gamesNs.to(`user:${award.userId}`).emit('games:rewards', {
            lobbyId,
            delta: award.delta,
            balance: award.balance,
            newCoupons: award.newCoupons
          });
        }
      }
    }

    socket.on('games:move', move => handleMove(move));

    // --- 8-Ball Pool: أحداث مخصصة (نية العميل بس؛ الفيزياء والقواعد في السيرفر) ---
    socket.on('pool:place_cue', payload => handleMove({ type: 'place_cue', x: payload?.x, y: payload?.y }, 'pool'));
    socket.on('pool:shoot', payload => handleMove({ type: 'shoot', angle: payload?.angle, power: payload?.power }, 'pool'));

    // --- ليدو ---
    socket.on('ludo:roll', () => handleMove({ type: 'roll_dice' }, 'ludo'));
    socket.on('ludo:move', payload => handleMove({ type: 'move_piece', pieceIndex: payload?.pieceIndex }, 'ludo'));

    socket.on('disconnect', () => {
      if (socket.data.lobbyId) {
        lobbyManager.leaveLobby(socket.data.lobbyId, userId);
        gamesNs.emit('games:list', lobbyManager.listLobbies());
      }
      // تنظيف حالة الـ rate limiter الخاصة بالسوكت ده، وإلا هتفضل في
      // الذاكرة للأبد حتى بعد قطع الاتصال (تسريب ذاكرة بطيء).
      checkActionRate.release(socket);
    });
  });

  return gamesNs;
}

function joinSocketRoom(socket, lobbyId) {
  if (socket.data.lobbyId) socket.leave(socket.data.lobbyId);
  socket.join(lobbyId);
  socket.data.lobbyId = lobbyId;
}

export default { attachGames };
