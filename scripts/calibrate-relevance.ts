/**
 * Dump every related-passage candidate the doc graph offers for a document,
 * with its relevance score and both provenance forms.
 *
 * The constants in `lib/graphrag/relevanceScore.ts` decide what a reader is
 * shown. Reasoning about them in the abstract is how the original bug got
 * shipped, so this exists to re-derive them against a real document instead:
 *
 *   npx tsx scripts/calibrate-relevance.ts <file.md> [--all]
 *
 * By default it prints, per seed block, what SURVIVED and what was REJECTED,
 * so a wrong call in either direction is visible. `--all` prints every scored
 * pair for eyeballing the distribution.
 *
 * Deterministic edges only — no LLM, no embeddings, no network. That is also
 * the state a reader is actually in while reading (the background rebuild is
 * deliberately deterministic-only), so it is the state worth calibrating.
 */
import fs from 'node:fs'
import { EditorState } from 'prosemirror-state'
import { parseTextToDoc } from '../src/lib/docInput/parser'
import { computeBlockIdFixes } from '../src/lib/prosemirror/blockIds'
import { schema } from '../src/lib/prosemirror/schema'
import { buildDeterministicGraph, findEdgePath, formatEdgePath, describeEdgePath, getNeighborhood } from '../src/lib/graphrag/docGraph'
import { RELATED_MIN_SCORE, scorePath } from '../src/lib/graphrag/relevanceScore'

const file = process.argv[2]
const showAll = process.argv.includes('--all')
if (!file) {
  console.error('usage: npx tsx scripts/calibrate-relevance.ts <file.md> [--all]')
  process.exit(1)
}

// The parser leaves blockId null — ids are minted by the blockId plugin when
// the document mounts in an editor. The graph keys everything off them, so
// stamp them here the same way the plugin does, or every block is invisible.
function withBlockIds(markdown: string) {
  const state = EditorState.create({ schema, doc: parseTextToDoc(markdown) })
  const fixes = computeBlockIdFixes(state.doc)
  if (!fixes.length) return state.doc
  const tr = state.tr
  for (const fix of fixes) tr.setNodeMarkup(tr.mapping.map(fix.pos), undefined, fix.attrs)
  return tr.doc
}

const graph = buildDeterministicGraph(withBlockIds(fs.readFileSync(file, 'utf8')))

const snip = (s: string, n = 90) => {
  const clean = s.trim().replace(/\s+/g, ' ')
  return clean.length > n ? `${clean.slice(0, n)}…` : clean
}

let kept = 0
let rejected = 0
const seedsWithAny: string[] = []

for (const seed of graph.nodes.values()) {
  if (!seed.text.trim()) continue
  const neighborhood = getNeighborhood(graph, seed.blockId, 2)
  const rows: Array<{ id: string; score: number; why: string; path: string; text: string }> = []
  for (const [blockId, entry] of neighborhood) {
    if (blockId === seed.blockId) continue
    const node = graph.nodes.get(blockId)
    if (!node?.text.trim()) continue
    const path = findEdgePath(graph, seed.blockId, blockId)
    rows.push({
      id: blockId,
      score: scorePath(graph, seed.blockId, blockId, path, entry.hop),
      why: path?.length ? describeEdgePath(graph, path, seed.blockId) : 'related',
      path: path?.length ? formatEdgePath(path) : 'related',
      text: node.text,
    })
  }
  if (!rows.length) continue
  rows.sort((a, b) => b.score - a.score)

  const survivors = rows.filter((r) => r.score >= RELATED_MIN_SCORE)
  kept += survivors.length
  rejected += rows.length - survivors.length
  if (survivors.length) seedsWithAny.push(seed.blockId)

  if (!showAll && !survivors.length) continue
  console.log(`\n=== SEED ${seed.blockId} :: ${snip(seed.text)}`)
  for (const r of rows) {
    if (!showAll && r.score < RELATED_MIN_SCORE) continue
    const mark = r.score >= RELATED_MIN_SCORE ? 'KEEP  ' : 'reject'
    console.log(`  ${mark} ${r.score.toFixed(3)}  ${r.why}`)
    console.log(`         path: ${r.path}`)
    console.log(`         text: ${snip(r.text)}`)
  }
}

console.log(`\n--- summary -------------------------------------------------`)
console.log(`blocks:            ${graph.nodes.size}`)
console.log(`edges:             ${graph.edges.length}`)
console.log(`hub terms dropped: ${(graph.hubTerms ?? []).join(', ') || '(none)'}`)
console.log(`threshold:         ${RELATED_MIN_SCORE}`)
console.log(`candidates kept:   ${kept}`)
console.log(`candidates cut:    ${rejected}`)
console.log(`blocks offering >=1 related passage: ${seedsWithAny.length}`)
