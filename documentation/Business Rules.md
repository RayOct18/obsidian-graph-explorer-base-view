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

- Node rings must not overlap — each ring type has a distinct radius slot (explored innermost, then confidence, hover glow, selected, focused, batch outermost)
- Highlight transitions use smooth fade-in/fade-out (exponential convergence) rather than instant opacity changes
- Non-connected nodes dim to 15% opacity when a node is hovered or search is active
- Node shape is determined by wiki role and is not configurable by the user

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
