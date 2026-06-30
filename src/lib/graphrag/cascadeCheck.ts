/**
 * GraphRAG-powered Cascade Check — replaces keyword-based heuristic.
 *
 * Uses the Graphiti MCP server to query the knowledge graph for entities
 * related to a changed text span. Maps multi-hop subgraph results to
 * ProseMirror conflict decorations and the conflictStore.
 *
 * Falls back to keyword-based cascade if MCP server is unavailable.
 */

import { EditorView } from 'prosemirror-view'
import { searchNodes, getSubgraph, searchFacts, type GraphNode, type SubgraphResult } from '@/lib/mcp/graphitiClient'
import { useConflictStore, type ConflictSeverity } from '@/stores/conflictStore'
import { addConflictDecoration } from '@/lib/prosemirror/plugins/conflictPlugin'
import { generateId } from '@/lib/utils/id'
import { checkCascade, type CascadeFlag } from '@/lib/annotations/cascade'

export interface CascadeResult {
  /** Total number of cascade conflicts found */
  count: number
  /** Whether GraphRAG was used (false = keyword fallback) */
  usedGraphRAG: boolean
  /** Affected entity names from the graph */
  affectedEntities: string[]
}

/**
 * Run a GraphRAG-powered cascade check after an edit is applied.
 *
 * 1. Search the knowledge graph for entities matching the changed text.
 * 2. For each matching entity, get its subgraph (blast radius).
 * 3. Map subgraph edges back to document positions.
 * 4. Create conflict decorations + store entries for each affected span.
 *
 * Falls back to keyword-based checkCascade() if MCP is unreachable.
 */
export async function runCascadeCheck(
  view: EditorView,
  changedText: string,
  newText: string,
  changeFrom: number,
): Promise<CascadeResult> {
  try {
    return await graphragCascade(view, changedText, newText, changeFrom)
  } catch {
    // MCP server unavailable — fall back to keyword-based heuristic
    return keywordFallback(view, changedText, newText, changeFrom)
  }
}

async function graphragCascade(
  view: EditorView,
  changedText: string,
  newText: string,
  changeFrom: number,
): Promise<CascadeResult> {
  // 1. Search for entities related to the changed text
  const query = changedText.slice(0, 200) // Cap query length
  const matchingNodes = await searchNodes(query, 5)

  if (matchingNodes.length === 0) {
    // No entities in graph yet — also try fact search for edge matches
    const facts = await searchFacts(query, 5)
    if (facts.length === 0) {
      return { count: 0, usedGraphRAG: true, affectedEntities: [] }
    }
    // Use fact results to find related document text
    return mapFactsToConflicts(view, facts, changedText, changeFrom)
  }

  // 2. Get subgraph for each matching entity (blast radius)
  const subgraphs: Array<{ node: GraphNode; subgraph: SubgraphResult }> = []
  for (const node of matchingNodes.slice(0, 3)) { // Cap at 3 to avoid overload
    const subgraph = await getSubgraph(node.uuid, 2)
    subgraphs.push({ node, subgraph })
  }

  // 3. Map subgraph data to document positions and create conflicts
  return mapSubgraphsToConflicts(view, subgraphs, changedText, changeFrom)
}

/**
 * Map subgraph edges/nodes to document positions, creating conflict decorations.
 */
function mapSubgraphsToConflicts(
  view: EditorView,
  subgraphs: Array<{ node: GraphNode; subgraph: SubgraphResult }>,
  changedText: string,
  changeFrom: number,
): CascadeResult {
  const doc = view.state.doc
  const docText = doc.textContent
  const affectedEntities: string[] = []
  let count = 0

  // Collect all unique entity names and facts from subgraphs
  const entityNames = new Set<string>()
  const factTexts: Array<{ fact: string; sourceName: string; targetName: string }> = []

  for (const { node, subgraph } of subgraphs) {
    entityNames.add(node.name)
    for (const graphNode of subgraph.nodes) {
      entityNames.add(graphNode.name)
    }
    for (const edge of subgraph.edges) {
      if (edge.fact) {
        // Find the node names for this edge
        const sourceNode = subgraph.nodes.find((n) => n.uuid === edge.source)
        const targetNode = subgraph.nodes.find((n) => n.uuid === edge.target)
        factTexts.push({
          fact: edge.fact,
          sourceName: sourceNode?.name ?? '',
          targetName: targetNode?.name ?? '',
        })
      }
    }
  }

  // Search for entity name mentions in the document
  for (const entityName of entityNames) {
    if (!entityName || entityName.length < 3) continue

    // Find all occurrences of this entity name in the document
    const positions = findAllOccurrences(docText, entityName)

    for (const { index, length } of positions) {
      // Map string index to ProseMirror position
      const pmPos = stringIndexToPmPos(doc, index)
      if (pmPos === null) continue

      const from = pmPos
      const to = Math.min(pmPos + length, doc.content.size)

      // Skip the changed region itself
      const changeTo = changeFrom + changedText.length
      if (from >= changeFrom && to <= changeTo) continue
      // Skip overlapping regions
      if (from < changeTo && to > changeFrom) continue

      const severity: ConflictSeverity = isDirectDependency(entityName, changedText)
        ? 'direct'
        : 'ambiguous'

      const id = generateId()
      const reasoning = buildCascadeReasoning(entityName, factTexts, changedText)

      addConflictDecoration(view, id, from, to, severity)
      useConflictStore.getState().addConflict({
        id,
        from,
        to,
        severity,
        reasoning,
        annotationId: null,
        resolution: 'pending',
        proposedText: null,
      })

      affectedEntities.push(entityName)
      count++
    }
  }

  return { count, usedGraphRAG: true, affectedEntities: [...new Set(affectedEntities)] }
}

/**
 * Map search_facts results to conflict decorations when no entity nodes match.
 */
function mapFactsToConflicts(
  view: EditorView,
  facts: Array<{ fact: string; source_node_uuid?: string; target_node_uuid?: string; name?: string }>,
  changedText: string,
  changeFrom: number,
): CascadeResult {
  const doc = view.state.doc
  const docText = doc.textContent
  let count = 0
  const affectedEntities: string[] = []

  for (const fact of facts) {
    // Try to find fact-related text in the document
    // Extract key phrases from the fact
    const keywords = extractKeyPhrases(fact.fact)

    for (const keyword of keywords) {
      if (keyword.length < 4) continue

      const positions = findAllOccurrences(docText, keyword)
      for (const { index, length } of positions) {
        const pmPos = stringIndexToPmPos(doc, index)
        if (pmPos === null) continue

        const from = pmPos
        const to = Math.min(pmPos + length, doc.content.size)

        // Skip the changed region
        const changeTo = changeFrom + changedText.length
        if (from >= changeFrom && to <= changeTo) continue
        if (from < changeTo && to > changeFrom) continue

        const id = generateId()
        addConflictDecoration(view, id, from, to, 'ambiguous')
        useConflictStore.getState().addConflict({
          id,
          from,
          to,
          severity: 'ambiguous',
          reasoning: `Knowledge graph relationship: "${fact.fact}"`,
          annotationId: null,
          resolution: 'pending',
          proposedText: null,
        })

        affectedEntities.push(keyword)
        count++
      }
    }
  }

  return { count, usedGraphRAG: true, affectedEntities: [...new Set(affectedEntities)] }
}

/**
 * Keyword-based fallback when MCP server is unreachable.
 */
function keywordFallback(
  view: EditorView,
  changedText: string,
  newText: string,
  changeFrom: number,
): CascadeResult {
  const flags = checkCascade(
    changedText,
    newText,
    view.state,
    changeFrom,
    view.state.doc.content.size,
  )

  let count = 0
  for (const flag of flags) {
    const id = generateId()
    addConflictDecoration(view, id, flag.from, flag.to, 'ambiguous')
    useConflictStore.getState().addConflict({
      id,
      from: flag.from,
      to: flag.to,
      severity: 'ambiguous',
      reasoning: flag.reason,
      annotationId: null,
      resolution: 'pending',
      proposedText: null,
    })
    count++
  }

  return { count, usedGraphRAG: false, affectedEntities: [] }
}

// --- Helpers ---

function findAllOccurrences(text: string, term: string): Array<{ index: number; length: number }> {
  const results: Array<{ index: number; length: number }> = []
  const lowerText = text.toLowerCase()
  const lowerTerm = term.toLowerCase()
  let startIndex = 0

  while (startIndex < lowerText.length) {
    const idx = lowerText.indexOf(lowerTerm, startIndex)
    if (idx === -1) break

    // Only match at word boundaries
    const beforeChar = idx > 0 ? lowerText[idx - 1] : ' '
    const afterChar = idx + lowerTerm.length < lowerText.length ? lowerText[idx + lowerTerm.length] : ' '
    if (/\W/.test(beforeChar) && /\W/.test(afterChar)) {
      results.push({ index: idx, length: term.length })
    }

    startIndex = idx + 1
  }

  return results
}

/**
 * Convert a string index (from textContent) to a ProseMirror position.
 */
function stringIndexToPmPos(doc: import('prosemirror-model').Node, index: number): number | null {
  let charCount = 0
  let result: number | null = null

  doc.descendants((node, pos) => {
    if (result !== null) return false
    if (node.isText && node.text) {
      const nodeEnd = charCount + node.text.length
      if (index >= charCount && index < nodeEnd) {
        result = pos + (index - charCount)
      }
      charCount = nodeEnd
    }
  })

  return result
}

function isDirectDependency(entityName: string, changedText: string): boolean {
  return changedText.toLowerCase().includes(entityName.toLowerCase())
}

function buildCascadeReasoning(
  entityName: string,
  facts: Array<{ fact: string; sourceName: string; targetName: string }>,
  changedText: string,
): string {
  const relatedFacts = facts.filter(
    (f) =>
      f.sourceName.toLowerCase().includes(entityName.toLowerCase()) ||
      f.targetName.toLowerCase().includes(entityName.toLowerCase())
  )

  if (relatedFacts.length > 0) {
    const factList = relatedFacts
      .slice(0, 3)
      .map((f) => f.fact)
      .join('; ')
    return `Entity "${entityName}" is related to the changed text via: ${factList}`
  }

  return `Entity "${entityName}" appears in the knowledge graph and may be affected by changes to "${changedText.slice(0, 50)}..."`
}

function extractKeyPhrases(text: string): string[] {
  // Extract multi-word phrases and significant terms from fact text
  return text
    .split(/[,;.!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 4 && s.split(/\s+/).length <= 4)
}
