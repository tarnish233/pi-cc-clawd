# Changelog

## 0.8.0 - 2026-11-19

- Read the bash command line, not just the tool name: tests and builds keep `Running`, `git commit/push/...` uses `Laptop`, package installs use `CrabWalking`, and a long-running dev server uses the `Desktop` scene.
- Change scene every 15 s while one tool keeps running (`Running` ↔ `CrabWalking`, `Laptop` ↔ `Desktop`, `Waving` ↔ `Pointing`, ...), so a three-minute build no longer loops the same two seconds.
- Answer praise in the prompt (`谢谢`, `thanks`, `干得漂亮`, ...) with `Excited`: immediately during a turn, and at the start of the next turn when typed while idle.
- Turn into a talking gesture while assistant text streams (`Pointing` from the first `text_delta`), then return to the desk on `message_end` or when a tool starts.
- Split the footer into two 4×2 mini Clawds while two or more tools run, each with its own Kitty image id and 8 fps wall-clock frames; the stage stays off in that mode and the full glyph returns when one tool is left.
- Cover the new triggers with animation, footer and extension tests (127 tests total).

## 0.7.0 - 2026-11-19

- Give every idle clip a guaranteed slot: idle acts now draw from a shuffled weighted bag, so `JumpingHappy` and `BreakDancing` (previously manual-only) appear automatically, along with all thirteen existing idle acts.
- Map MCP tools to `Spark`, use `JumpingHappy` for a quick tool-free success and `BreakDancing` for every tenth success, so all 25 official animations now have an automatic trigger.
- Click the mascot in the footer or on the stage overlay (fullscreen renderer) for a happy one-shot; four quick clicks spin it dizzy.
- Keep the existing `/clawd pet` command and Ctrl+Alt+C shortcut as the regular-mode path, where Pi does not deliver mouse events to extensions.

## 0.6.0 - 2026-11-19

- Map each tool family to its own official clip: reading, editing (laptop scene), shell, web search, subagents, questions and todo plans, with the crab walk as the default.
- Hold every tool clip for at least 20 frames and keep it through a four-frame gap between tools, so millisecond tools no longer restart the animation; parallel tools follow the latest one.
- Add turn-node endings: a steer prompt hops, an aborted turn plays Disappointed, and a busy turn (12+ tools) ends with the confetti scene.
- Split idle into an ambient blink clock (4-7 s) and a separate act pool (6-10 s) of short and tall official clips, so blinks no longer take half the repertoire; add one dizzy reaction when the context passes 85%, a tired sway after two minutes, and a slow sleeping loop after ten quiet minutes (three at night).
- Add `/clawd pet` and the Ctrl+Alt+C shortcut for interaction; the shortcut works while motion is paused.
- Fix pause/off being defeated when the last tool ends, and let a crowded crossing wait until the mascot is running again.
- Give millisecond tools their full 20-frame hold, reuse the running loop for the same tool family, request redraws in standalone Kitty mode, keep the stage off the prompt while it holds typed text, and anchor the stage to the footer's real row so a short session can no longer put it below its own body.
- Keep the six behaviour groups documented in the README and cover each with animation tests (106 tests total).

## 0.5.1 - 2026-11-19

- Standalone mode without a decoratable footer now keeps the 8×2 glyph centered over the native footer instead of reserving a `belowEditor` row; the overlay hides below 110 columns where the footer's model label reaches the middle.
- Terminals without Kitty keep the four-row half-block text widget: shrinking the same art into two rows loses the pixel size that makes the sprite readable.
- Remove the braille experiment; the inline overlay renders both glyph rows without a border row, and the footer stage keeps its border-preserving mask.

## 0.5.0 - 2026-11-18

- Enable all 25 official clips for `/clawd play`; the 15 compact canvases keep the original 8×2 framing.
- Add a non-capturing 8×2 overlay above the footer so tall canvases render in an 8×4 stage at the canonical body size, borrowing the editor's blank right margin without adding layout rows.
- Mask overlay cells per frame, keep cells the sprite does not cross filled with the editor's own border glyph, and never enlarge or squash the character.
- Tie the overlay to tall clips only, remove it between clips, and fall back to the 8×2 fit when Kitty placeholders or the editor rows are unavailable.
- Reserve one blank column after the footer glyph: Rex drops the trailing cell's combining diacritics, which clipped the sprite's right arm in every previous version.
- Add stage coverage for placeholder rows, body-size invariance, border masking, overlay lifecycle and both real renderers (81 tests total).

## 0.4.1 - 2026-11-18

- Sanitize the private marker on every incompatible footer line, mount the native widget fallback, and remove only separators adjacent to the marker instead of corrupting footer text.
- Re-upload placeholder data after hide/show, keep direct-image continuation rows empty for Pi's reservation logic, and resample all text clips into a fixed four-row widget.
- Distinguish manual clips from state-owned transitions, preserve live Agent/tool state during tree preference restores, and consume turn failure state once.
- Reject malformed base/delta characters instead of silently painting palette zero; offer only the 15 playable clips in completions and clarify startup readiness.
- Ship development scripts, tests and `tsconfig.json` in the npm artifact; verify its tests, typecheck, preview and Pi loading independently.
- Add regression coverage for marker leaks/corruption, incompatible footers, text-height jitter, manual/state clip conflicts, malformed assets and packaged scripts (73 tests total).

## 0.4.0 - 2026-11-18

- Bundle the official 6.6395.0 base-and-delta sprite catalogue and lazily decode all 25 animations with palette, coordinate and frame validation.
- Enable 15 animations whose canvases fit the 8×2 footer; skip 10 taller clips rather than shrinking the mascot or changing footer height.
- React to Agent events: Desktop while working, CrabWalking during tools, DancingHappy on success, Meditating during compaction and Facepalm on errors.
- Track parallel tool calls, preserve paused/off preferences, restore the latest state on resume and cancel frame timers on shutdown.
- Add `/clawd play <animation>` with nested completions and manual one-shot playback while paused.
- Generalize PNG and half-block rendering for full RGBA official frames; retain the canonical built-in silhouette and both existing image transports.
- Add official catalogue, state-machine, renderer and command integration tests; verify real Desktop frame progression in an isolated Rex session.

## 0.3.1 - 2026-11-18

- Render the shared footer mascot with Kitty Unicode placeholders so both footer rows keep native text selection and copy highlighting.
- Upload image data outside Pi's rendered text lines so footer text refreshes no longer delete and re-place the mascot.
- Restore placeholder image data after a full terminal redraw, while retaining the direct-image 4×1 `belowEditor` fallback.
- Add real fullscreen mouse-selection and no-delete/no-reupload regression coverage; verify rendering and reload in an isolated Rex session.

## 0.3.0 - 2026-11-18

- Span one 8-column, two-row image across the right side of both existing footer lines.
- Reserve the image's physical width independently on each line so model, path and git text cannot overlap it.
- Keep the second glyph line as padding only; do not draw a second image or add a footer row.
- Retain the 4-column, one-row native `belowEditor` fallback and its original dimensions when a custom footer is removed.

## 0.2.0 - 2026-11-18

- Move the fixed 4-column, one-row Clawd to the right of the existing second footer line.
- Preserve the actual `pi-cc-extensions` footer factory and both lines; never replace its model, usage, path or git rendering.
- Remove prompt-editor decoration from production; native `belowEditor` is the fallback when no compatible custom footer is captured.
- Wrap later footer factories during startup and require `pi-cc-clawd` to precede `pi-cc-extensions` in package order.
- Keep image protocols out of the ANSI-stripping `setStatus` channel; replace only the reserved marker in rendered output.
- Clear markers/images on hide, restore the original footer setter on shutdown and verify the real installed footer component.

## 0.1.5 - 2026-11-18

- Add the requested four-column, one-row micro Clawd while preserving the canonical pixel model and right-edge placement.
- Keep a one-row default for width overrides; add an explicit `PI_CLAWD_LEGACY_ROWS=1` escape hatch for the previous 8×2 layout.
- Exercise actual one-row editor, mouse routing and Kitty placement.

## 0.1.4 - 2026-11-18

- Try a narrower seven-column, two-row graphical size without changing the canonical pixel model.
- Allow `PI_CLAWD_COLUMNS=5..14` for local size experiments; invalid values safely use the default.

## 0.1.3 - 2026-11-18

- Shrink graphical rendering to 8 columns / two rows without changing the canonical 24×16 silhouette.
- Keep lossless scaling and the existing text fallback; adjust image and mouse-layout regression tests.

## 0.1.2 - 2026-11-18

- Restore the canonical 24×16 Clawd silhouette; stop redrawing its proportions to fit fewer text cells.
- Render a sharp, transparent PNG at 9 columns / three rows on Kitty-compatible terminals such as Rex.
- Use uniform scaling and terminal cell dimensions; preserve the original shape in the text fallback.
- Cache all poses under one image ID and refresh Kitty data correctly when returning to a cached pose.
- Add canonical-mask, PNG, image-cache and graphical renderer regression tests.

## 0.1.1 - 2026-11-18

- Reduce Clawd from 14 columns / four rows to 10 columns / three rows.
- Keep the complete face, arms and four separate feet, with the same position and quiet motions.
- Update rendering and mouse-coordinate regression tests for the smaller footprint.

## 0.1.0 - 2026-11-18

- Add a 14-column, four-row pixel Clawd above the prompt, with feet touching the top border.
- Occasional blinking and sideways glances; no continuous animation loop or model calls.
- Preserve the current editor and footer; use native stack layout for mouse routing.
- Mount after all editor startup handlers so package and CLI load order cannot discard the decoration.
- Add `/clawd` visibility, pause, resume, and blink commands.
- Clean up timers on reload/session replacement and hide in small terminals.
