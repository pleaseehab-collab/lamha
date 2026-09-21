import { v4 as uuid } from 'uuid';
import { ROOMS, isValidRoom } from './roomsConfig.js';
import { reviewMessage } from './moderator/moderator.js';
import { allowMessage } from './chatRateLimiter.js';
import { isDealQuery, buildDealReply, BOT_ID, BOT_NAME } from './dealAssistant.js';
import { logger } from '../utils/logger.js';
import { requireSocketAuth } from '../security/socketAuth.js';

const presence = new Map(); // roomId -> Set(socketId)

function roomCount(roomId) {
  return presence.get(roomId)?.size || 0;
}

function joinPresence(roomId, socketId) {
  if (!presence.has(roomId)) presence.set(roomId, new Set());
  presence.get(roomId).add(socketId);
}

function leavePresence(roomId, socketId) {
  presence.get(roomId)?.delete(socketId);
}

/**
 * يوصّل نظام الشات بالكامل على السيرفر بتاع Socket.io.
 * @param {import('socket.io').Server} io
 */
export function attachChat(io) {
  const chatNs = io.of('/chat');
  // مصادقة حقيقية لو فيه JWT — وإلا زائر مؤقت. ده بيمنع تحايل بسيط زي فتح
  // اتصال جديد بـ userId مختلف عشان تتهرب من الكتم (mute) بتاع نفس الحساب.
  chatNs.use(requireSocketAuth);

  chatNs.on('connection', socket => {
    const userId = socket.data.userId || uuid();
    const username = (socket.handshake.auth?.username || `زائر_${userId.slice(0, 4)}`).slice(0, 30);
    socket.data.userId = userId;
    socket.data.username = username;
    socket.data.currentRoom = null;

    socket.emit('chat:rooms', ROOMS.map(r => ({ ...r, online: roomCount(r.id) })));

    socket.on('chat:join', roomId => {
      if (!isValidRoom(roomId)) return socket.emit('chat:error', { error: 'غرفة غير موجودة' });

      if (socket.data.currentRoom) {
        socket.leave(socket.data.currentRoom);
        leavePresence(socket.data.currentRoom, socket.id);
        chatNs.to(socket.data.currentRoom).emit('chat:presence', {
          roomId: socket.data.currentRoom,
          online: roomCount(socket.data.currentRoom)
        });
      }

      socket.join(roomId);
      joinPresence(roomId, socket.id);
      socket.data.currentRoom = roomId;

      chatNs.to(roomId).emit('chat:presence', { roomId, online: roomCount(roomId) });
      socket.emit('chat:joined', { roomId, username });
    });

    socket.on('chat:typing', () => {
      if (!socket.data.currentRoom) return;
      socket.to(socket.data.currentRoom).emit('chat:typing', { username });
    });

    socket.on('chat:message', async payload => {
      const roomId = socket.data.currentRoom;
      if (!roomId) return socket.emit('chat:error', { error: 'انضم لغرفة الأول' });

      const text = typeof payload === 'string' ? payload : payload?.text;
      if (typeof text !== 'string') return;

      if (!allowMessage(userId)) {
        return socket.emit('chat:error', { error: 'ابعت رسايل أهدى شوية 🙂', code: 'rate_limited' });
      }

      const decision = await reviewMessage({ userId, text, siteHost: extractHost(socket) });

      if (decision.action === 'blocked') {
        return socket.emit('chat:error', {
          error: decision.reason === 'muted'
            ? `انت متكتم لسه ${decision.muteRemainingSeconds} ثانية.`
            : 'الرسالة مش مسموحة.',
          code: decision.reason
        });
      }

      if (decision.action === 'mute') {
        socket.emit('chat:muted', {
          reason: decision.reason,
          muteSeconds: decision.mute.muteSeconds,
          strikes: decision.mute.strikes
        });
        logger.warn('تم كتم مستخدم', { userId, reason: decision.reason, strikes: decision.mute.strikes });
        return;
      }

      const message = {
        id: uuid(),
        roomId,
        userId,
        username,
        text: text.slice(0, 500),
        ts: Date.now(),
        warned: decision.action === 'warn' ? decision.reason : null
      };

      chatNs.to(roomId).emit('chat:message', message);

      // مساعد العروض الذكي: لو الرسالة بتسأل عن عروض، بيرد في نفس الغرفة كرسالة بوت
      if (isDealQuery(text)) {
        try {
          const reply = await buildDealReply(text);
          if (reply) {
            chatNs.to(roomId).emit('chat:message', {
              id: uuid(),
              roomId,
              userId: BOT_ID,
              username: BOT_NAME,
              text: reply.text,
              ts: Date.now(),
              bot: true,
              products: reply.products
            });
          }
        } catch (err) {
          logger.error('خطأ في مساعد العروض', err);
        }
      }
    });

    socket.on('disconnect', () => {
      if (socket.data.currentRoom) {
        leavePresence(socket.data.currentRoom, socket.id);
        chatNs.to(socket.data.currentRoom).emit('chat:presence', {
          roomId: socket.data.currentRoom,
          online: roomCount(socket.data.currentRoom)
        });
      }
    });
  });

  return chatNs;
}

function extractHost(socket) {
  const origin = socket.handshake.headers.origin;
  try {
    return origin ? new URL(origin).hostname : null;
  } catch {
    return null;
  }
}

export default { attachChat };
