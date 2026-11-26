# Business Rules

This document defines the core business rules. These rules MUST be respected in all implementations unless explicitly approved otherwise.

---

## Documentation Guidelines

When a new business rule is mentioned:

1. Add it to this document immediately
2. Use a concise format (single line or brief paragraph)
3. Maintain precision - do not lose important details for brevity
4. Include rationale where it adds clarity

---

## Explored Status

- The explored status of a note is determined by a boolean frontmatter property (default name: `explored`)
- If the property is missing from a note's frontmatter, the note is considered **unexplored** (value is `false`)
- The property name is configurable both globally (plugin settings) and per-view (view options)
- Toggling explored status writes the property to the note's frontmatter via `processFrontMatter()`
- The in-memory `GraphNode.explored` is updated optimistically for immediate UI feedback (green ring, side panel button)
- Explored nodes always display a green ring (innermost ring) regardless of the color-by mode

## Graph Data

- Connections between nodes are derived from Obsidian's `metadataCache.resolvedLinks`
- The "Draw edges from" option (`edgeSource`) restricts edges to frontmatter links or body links (links + embeds); default `all` keeps the `resolvedLinks` behavior unchanged. Frontier nodes follow the same restriction
- Bidirectional links are deduplicated (A→B and B→A produce one edge)
- External nodes (linked but not in the Base filter) are only shown when the "Show linked notes outside the base" option is enabled, except the selected note's neighbors below
- "Show linked notes outside the base for the selected note" (`revealSelectedNeighbors`, default on; unset counts as on): while a node is selected, its direct neighbors not in the graph are added as external nodes — outgoing and incoming links, restricted by `edgeSource`. They carry real frontmatter. Edges added: revealed node ↔ any node in the graph. If the selected node is itself outside the graph, it is added too. Clearing the selection removes them. Existing nodes' connection counts are not changed (sizes stay stable)
- Rebuilt node objects keep their current x/y/vx/vy; new nodes start on a 40px circle around their first positioned neighbor (`carryOverPositions`). Saved (pinned) positions win
- Frontier nodes (unresolved link targets) are only shown when the "Show frontier nodes" option is enabled
- Node size is proportional to connection count by default (configurable to uniform)

## Node Visualization

- Last viewing state is saved per view in the Base config: `camera` (JSON `{k, x, y}`, written 1 s after the last zoom/pan end, only when changed, flushed on unload) and `selectedNode` (path, null when cleared). Saved state (camera, selection, left panel) is read on the first render that has data, not in `onload` (config may not be available yet). On open the camera replaces zoom-to-fit; the selected note is re-selected (neighbors revealed) and its side panel reopened if it still exists in the graph
- Node layout is not saved (only dragged, pinned nodes keep positions), so a restored camera can frame a re-laid-out graph
- One button beside the left panel hides/shows the whole panel (controls + minimap); state persisted per view as `leftPanelHidden`
- Node spacing, node size (`nodeScale`) and text size (`textScale`) sliders are persisted per view in the Base config and restored on open; missing or invalid scale values fall back to 60%, out-of-range ones are clamped to 20–300%

- Node rings must not overlap — each ring type has a distinct radius slot (explored innermost, then confidence, hover glow, selected, focused, batch outermost)
- Highlight transitions use smooth fade-in/fade-out (exponential convergence) rather than instant opacity changes
- Non-connected nodes dim to 15% opacity when a node is hovered or search is active
- Node shape is determined by wiki role and is not configurable by the user

## Note Cards

- Double-click a node toggles it as an expanded card (right-click → Expand as card / Collapse card does the same). "Open in new tab" moved to the right-click menu only. Frontier nodes cannot expand
- Cards are HTML overlays (`GraphCardLayer`) above the canvas, repositioned after every frame (`onRenderFramePost`): graph-space rectangle centered on the node → screen via `graph2ScreenCoords`, `scale(zoom)`. Size is in graph units, so cards scale with the zoom
- Card content is the same markdown embed editor as the side panel; pending edits are flushed before a card is removed
- Card header ◨ button: flushes the card's edits, collapses the card, selects the note and opens it in the side panel (replaces the earlier ↗ open-in-tab button; new tab stays in the context menu)
- Properties start collapsed in cards (embed's shared fold state, like Canvas cards: expanding them in one card expands them in all cards); the side panel keeps the note's own fold state
- Card text size comes from the left panel's Card slider (8–40 px, default 24; cards scale with the zoom, so this is the size at zoom 1), saved per view as `cardFontSize`; applied as `--ge-card-font-size` on the card layer, properties 1 px smaller; `font-size: … !important` is set on every editor level inside the card body (embed, source view, cm-editor, scroller, preview), because the variables alone and a plain `font-size` on the card body did not reach the editor text under the Minimal theme. `--font-text-size` / `--font-adaptive-normal` are overridden too. Tables get 0.875 × the card size the same way (`--table-text-size` is also resolved on body)
- Other nodes are kept out of cards by the `cardAvoid` d3 force (rectangle + 16 px padding, push along the shorter axis; cards push each other apart; pinned nodes do not move)
- Header drag moves and pins the node (saved like a node drag); bottom-right handle resizes symmetrically around the node, clamped to 160×100 – 2000×2000
- Expanded cards are saved per view as `expandedCards` (JSON path → `{w, h}`) and restored with the other view state; a card is hidden while its note is not in the graph and kept in the config
- View keyboard shortcuts ignore events from inside cards

## Side Panel Opening

- Clicking a node selects it (highlight, reveal neighbors) but does not open the side panel; while the panel is open it follows the clicked node
- The panel opens when the already selected node is clicked again (500 ms later, cancelled by a double-click so expanding a card does not also open it), from right-click → Open in side panel (and from navigating links inside the panel); ✕ or a background click closes it and deselects
- Open/closed is saved per view as `sidePanelOpen`; on reopen the saved selection comes back, with the panel only if it was open
- Lower note (compare): right-click → Open below in side panel shows a second note with its own editor under the first (`SidePanelCompare`). When the panel is closed, the same entry opens the note as the panel's main note instead. Clicking a node switches the note that last had the cursor (focusin on the upper content or the lower pane; resets to upper when the lower note closes); that note's header gets an accent bar while split
- A splitter between the notes sets the lower height (min 80 px each side, default half); ✕ on the lower note closes it; closing the panel closes it too. Pending edits are flushed before its editor goes away
- Saved per view as `sidePanelCompare` (path, empty when none) and restored with the panel
- Double-click uses the native `dblclick` event (OS double-click speed), not a timer around force-graph clicks: the first click selects, reveals neighbors and re-lays out the graph, which delayed the second click past the old 400 ms window. The node is the one under the first click (it may have moved by the second). A click within 500 ms of a node click is treated as the second half of a double-click: it does not reselect, and on the background it does not deselect

## Hover Preview

- The plugin registers hover link source `graph-explorer` ("Graph Explorer", `defaultMod: true`); Page preview settings decide whether Ctrl/Cmd is required
- Hovering a node triggers `hover-link` with `targetEl: null`, `linktext` = node path — same flow as the core graph. Leaving the node sets the popover off-target (`onTarget = false; transition()`); re-hovering the same node while its popover is shown keeps it
- Page preview ignores a Mod press after hover when `targetEl` is null, so the view re-triggers on a Ctrl/Cmd keydown (not auto-repeat) while a node is hovered, with a copy of the last pointer event carrying the modifier
- Frontier nodes have no preview

## Side Panel

- The "explored" badge pill is not shown in the side panel — the toggle button alone indicates explored state
- Internal links navigate in-panel when the target is a node in the current graph; otherwise they open in a new tab
- Middle-click on links always opens in a new tab
- Edit mode mounts Obsidian's internal markdown embed (`app.embedRegistry.getEmbedCreator`, same editor as Canvas file cards). Internal API: guarded at runtime; when missing, the Edit button is hidden and the panel stays read-only
- The editor sets `useLocalPropertiesFoldState = true` so properties follow the note's own fold state (expanded unless folded in the note), not Obsidian's shared embed state that starts collapsed
- The panel opens in edit mode by default; edit/preview mode is sticky across node selections until toggled
- Pending edits are flushed (`save(text, true)`, debounce cancelled) before the editor is unloaded on node switch, close, or view unload — no edits lost to the embed's 2 s save debounce
- View keyboard shortcuts are ignored when the event target is inside the side panel

## Link Visibility

- Links are drawn stronger than upstream so relations read at a glance: normal 1.2 px at 35% (dark) / 30% (light) opacity, external 0.8 px, highlighted (hovered/selected node) 2.5 px at 85% / 70%, role-colored links 45–50%, frontier dashes 1 px at 40–45%
