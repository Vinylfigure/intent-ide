'use client'

import { useState } from 'react'
import { useProjectStore, type Document } from '@/stores/projectStore'
import { useEditorStore } from '@/stores/editorStore'
import { generateId } from '@/lib/utils/id'
import { Node } from 'prosemirror-model'
import { schema } from '@/lib/prosemirror/schema'

export function ProjectSidebar() {
  const projects = useProjectStore((s) => s.projects)
  const activeProjectId = useProjectStore((s) => s.activeProjectId)
  const activeDocumentId = useProjectStore((s) => s.activeDocumentId)
  const createProject = useProjectStore((s) => s.createProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const renameProject = useProjectStore((s) => s.renameProject)
  const addDocument = useProjectStore((s) => s.addDocument)
  const removeDocument = useProjectStore((s) => s.removeDocument)
  const renameDocument = useProjectStore((s) => s.renameDocument)
  const setActiveProject = useProjectStore((s) => s.setActiveProject)
  const setActiveDocument = useProjectStore((s) => s.setActiveDocument)

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set()
  )
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [showNewProject, setShowNewProject] = useState(false)

  const toggleExpanded = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const saveCurrentDoc = () => {
    const view = useEditorStore.getState().view
    const state = useProjectStore.getState()
    if (!view || !state.activeProjectId || !state.activeDocumentId) return

    const docJson = view.state.doc.toJSON()
    const project = state.projects.find(
      (p) => p.id === state.activeProjectId
    )
    if (!project) return

    const doc = project.documents.find(
      (d) => d.id === state.activeDocumentId
    )
    if (!doc) return

    // Update the document's docJson in-place via the store
    useProjectStore.setState((s) => ({
      projects: s.projects.map((p) =>
        p.id === state.activeProjectId
          ? {
              ...p,
              documents: p.documents.map((d) =>
                d.id === state.activeDocumentId
                  ? { ...d, docJson }
                  : d
              ),
            }
          : p
      ),
    }))
  }

  const loadDocument = (projectId: string, doc: Document) => {
    const view = useEditorStore.getState().view
    if (!view) return

    // Save current document first
    saveCurrentDoc()

    // Load new document
    try {
      const newDoc = Node.fromJSON(schema, doc.docJson)
      const tr = view.state.tr.replaceWith(0, view.state.doc.content.size, newDoc.content)
      view.dispatch(tr)
      setActiveProject(projectId)
      setActiveDocument(doc.id)
    } catch {
      // If docJson is invalid, just set active without loading
      setActiveProject(projectId)
      setActiveDocument(doc.id)
    }
  }

  const handleNewDocument = (projectId: string) => {
    const view = useEditorStore.getState().view
    if (!view) return

    // Save current doc first
    saveCurrentDoc()

    const doc: Document = {
      id: generateId(),
      name: 'Untitled',
      docJson: view.state.doc.toJSON(),
      createdAt: Date.now(),
    }
    addDocument(projectId, doc)
    setActiveProject(projectId)
    setActiveDocument(doc.id)
  }

  const handleCreateProject = () => {
    if (!newProjectName.trim()) return
    const id = createProject(newProjectName.trim())
    setExpandedProjects((prev) => new Set(prev).add(id))
    setNewProjectName('')
    setShowNewProject(false)
  }

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id)
    setRenameValue(currentName)
  }

  const commitRename = (type: 'project' | 'document', projectId?: string) => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null)
      return
    }
    if (type === 'project') {
      renameProject(renamingId, renameValue.trim())
    } else if (projectId) {
      renameDocument(projectId, renamingId, renameValue.trim())
    }
    setRenamingId(null)
  }

  return (
    <div className="p-3 space-y-3">
      {projects.length === 0 && !showNewProject && (
        <div className="text-center py-8">
          <p className="text-sm text-muted mb-3">No projects yet</p>
          <button
            onClick={() => setShowNewProject(true)}
            className="px-4 py-2 bg-ink text-white rounded-lg text-sm font-medium hover:bg-ink/80 transition-colors"
          >
            Create Project
          </button>
        </div>
      )}

      {/* New project input */}
      {showNewProject && (
        <div className="flex gap-2">
          <input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateProject()
              if (e.key === 'Escape') setShowNewProject(false)
            }}
            placeholder="Project name..."
            autoFocus
            className="flex-1 px-2 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
          <button
            onClick={handleCreateProject}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/80 transition-colors"
          >
            Add
          </button>
          <button
            onClick={() => setShowNewProject(false)}
            className="px-2 py-1.5 text-xs text-muted hover:text-ink"
          >
            &times;
          </button>
        </div>
      )}

      {projects.length > 0 && !showNewProject && (
        <button
          onClick={() => setShowNewProject(true)}
          className="w-full px-3 py-1.5 text-xs font-medium border border-dashed border-border rounded hover:bg-warm transition-colors text-muted hover:text-ink"
        >
          + New Project
        </button>
      )}

      {/* Project list */}
      {projects.map((project) => {
        const isExpanded = expandedProjects.has(project.id)
        return (
          <div key={project.id} className="border border-border rounded-lg overflow-hidden">
            {/* Project header */}
            <div
              className={`flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-warm/80 transition-colors ${
                activeProjectId === project.id ? 'bg-accent/5' : ''
              }`}
              onClick={() => toggleExpanded(project.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-muted">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                {renamingId === project.id ? (
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename('project')
                      if (e.key === 'Escape') setRenamingId(null)
                    }}
                    onBlur={() => commitRename('project')}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="flex-1 px-1 py-0.5 text-sm border border-accent rounded focus:outline-none"
                  />
                ) : (
                  <span className="text-sm font-medium truncate">{project.name}</span>
                )}
                <span className="text-xs text-muted">({project.documents.length})</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename(project.id, project.name)
                  }}
                  className="p-0.5 text-xs text-muted hover:text-ink"
                  title="Rename project"
                >
                  \u270E
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteProject(project.id)
                  }}
                  className="p-0.5 text-xs text-red-400 hover:text-red-600"
                  title="Delete project"
                >
                  \u2715
                </button>
              </div>
            </div>

            {/* Documents */}
            {isExpanded && (
              <div className="border-t border-border bg-white/50">
                {project.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={`flex items-center justify-between px-3 py-1.5 pl-7 cursor-pointer hover:bg-warm/50 transition-colors ${
                      activeDocumentId === doc.id ? 'bg-accent/10 text-accent' : ''
                    }`}
                    onClick={() => loadDocument(project.id, doc)}
                  >
                    {renamingId === doc.id ? (
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename('document', project.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        onBlur={() => commitRename('document', project.id)}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="flex-1 px-1 py-0.5 text-xs border border-accent rounded focus:outline-none"
                      />
                    ) : (
                      <span className="text-xs truncate">{doc.name}</span>
                    )}
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          startRename(doc.id, doc.name)
                        }}
                        className="p-0.5 text-xs text-muted hover:text-ink"
                        title="Rename document"
                      >
                        \u270E
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          removeDocument(project.id, doc.id)
                        }}
                        className="p-0.5 text-xs text-red-400 hover:text-red-600"
                        title="Delete document"
                      >
                        \u2715
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  onClick={() => handleNewDocument(project.id)}
                  className="w-full px-3 py-1.5 pl-7 text-xs text-muted hover:text-ink hover:bg-warm/50 text-left transition-colors"
                >
                  + New Document
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
