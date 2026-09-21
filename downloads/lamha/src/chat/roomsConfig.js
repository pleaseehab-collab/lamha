/**
 * غرف الشات الأساسية — متطابقة مع تصنيفات deals.json عشان مساعد العروض الذكي
 * يقدر يقترح عروض مناسبة لكل غرفة، بالإضافة لغرف عامة ومخصصة للألعاب.
 */
export const ROOMS = [
  { id: 'general', name: 'الدردشة العامة', category: null },
  { id: 'electronics', name: 'إلكترونيات', category: 'electronics' },
  { id: 'phones', name: 'موبايلات', category: 'phones' },
  { id: 'home', name: 'منزل ومطبخ', category: 'home' },
  { id: 'fashion', name: 'أزياء', category: 'fashion' },
  { id: 'beauty', name: 'جمال وعناية', category: 'beauty' },
  { id: 'deals-hunters', name: 'صيادين العروض 🔥', category: null },
  { id: 'games-lobby', name: 'ردهة الألعاب 🎮', category: null }
];

export const ROOM_IDS = new Set(ROOMS.map(r => r.id));

export function isValidRoom(roomId) {
  return ROOM_IDS.has(roomId);
}

export function roomCategory(roomId) {
  return ROOMS.find(r => r.id === roomId)?.category || null;
}
