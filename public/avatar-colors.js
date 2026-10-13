// Stable wallet colours: a profile keeps its colour when its rank or name changes.
export const AVATAR_COLORS = ['#5065ed','#d88142','#8c65d6','#319a85','#cc628e','#55a8cc','#ba963a','#a86bba','#d16460','#4a9a64','#697ccc','#ba7851','#ad5684','#628eaf','#819d43','#876ab0','#3f999f','#c57076','#758543','#647db3'];
export function avatarColor(key = '') {
  let hash = 2166136261;
  for (const c of String(key || 'anonymous')) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
