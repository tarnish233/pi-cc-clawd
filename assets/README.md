# Official Clawd sprite data

`official-sprites.json` is the embedded sprite catalogue extracted read-only from the official Claude macOS 6.6395.0 release (`clawdQuestEngine-lZ9dF-II.js`). It contains 25 animations using the official base palette indices and base-36 delta frames; no GIF or raster screenshot substitutes are used.

- Source release date: 2026-11-17.
- Catalogue JSON SHA-256: `21fe0c314861b769f3532389ced58dde489449bf7630264254c91704fdeec4de`.
- Official release manifest: <https://downloads.claude.ai/releases/darwin/universal/RELEASES.json>.
- Evidence boundary: these assets come from the offline Clawd Quest engine; their use here does not claim that the normal Claude prompt mascot has the same state machine.
- The runtime decoder validates bases, palette indices, delta coordinates and frame bounds. Frames are decoded and rasterized lazily.

This data is **not** MIT-licensed project code. Claude, Clawd, the character design and original animation data belong to Anthropic. See the top-level `NOTICE`. The data comes from the offline Clawd Quest engine; its presence here does not claim that the normal Claude prompt mascot uses the same state machine.
