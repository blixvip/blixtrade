# Floating TikTok panel

The bottom bar opens an on-demand floating player. Desktop and mobile launchers share one panel across routes. Users add full HTTPS TikTok video/photo URLs to a deduplicated, browser-local queue (maximum 200). The official player retains its controls, description, music info and related recommendations. This does not expose a personalized For You feed. Short share links must first be opened to obtain the full post URL.

Drag and keyboard movement, pointer and keyboard resize, saved geometry, minimize, close/Escape, wheel navigation, touch swipe, previous/next and optional auto-next are supported. Only one player mounts at a time; minimize, editing and close unload it. Hidden browser tabs send pause. Playback messages require both the official origin and current iframe source. Invalid links cannot create arbitrary frames.

Validation: TypeScript and release build passed; four URL/storage/geometry tests passed and are in the main test command. Browser checks passed at 320, 390, 768, 1024 and 1440 pixels against downloaded production assets. Separate 390px CDP touch swipe check passed. Tests mock only network edges and never submit account mutations or trades. Screenshots and logs: `data/tiktok-check`, `data/tiktok-release`.

A real official sample video returned TikTok player error 2001 (`SERVER_ERROR`); the retry/external-link fallback rendered correctly. Successful real video playback remains unverified from this connection.

The guarded UI publish refused because another release changed the live index. That release already contained the final panel, so its actual assets were downloaded and tested without overwriting it. Verified index: `4a9204f5c31442aaf299c9d0391a87dd248fc992325fc2790bec4c6a72b1db91` (70 HTML/JS/CSS files).

Official API: https://developers.tiktok.com/docs/en/embed-player
