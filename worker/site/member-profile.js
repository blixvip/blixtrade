// Attach only the profile belonging to this verified website member. Never cache personal replies.
export async function withMemberProfile(response, member, profile) {
  if (!response.ok || !member || !profile) return response;
  let account;
  try { account = await response.clone().json(); } catch { return response; }
  if (!account?.signedIn || account.email?.toLowerCase() !== member.toLowerCase()) return response;
  const name = typeof profile.name === 'string' ? profile.name.trim().slice(0, 120) || null : null;
  const picture = typeof profile.picture === 'string' && profile.picture.length <= 500
    && /^https:\/\/lh3\.googleusercontent\.com\//.test(profile.picture) ? profile.picture : null;
  const headers = new Headers(response.headers);
  for (const key of ['content-length', 'content-encoding', 'etag']) headers.delete(key);
  headers.set('cache-control', 'private, no-store');
  return Response.json({ ...account, name, picture }, { status: response.status, headers });
}
