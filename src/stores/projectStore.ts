'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateId } from '@/lib/utils/id'

export interface Document {
  id: string
  name: string
  docJson: any
  createdAt: number
}

export interface Project {
  id: string
  name: string
  documents: Document[]
  createdAt: number
}

interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  activeDocumentId: string | null
  createProject: (name: string) => string
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  addDocument: (projectId: string, doc: Document) => void
  removeDocument: (projectId: string, docId: string) => void
  renameDocument: (projectId: string, docId: string, name: string) => void
  setActiveProject: (id: string | null) => void
  setActiveDocument: (id: string | null) => void
  getActiveDocument: () => Document | null
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      activeDocumentId: null,
      createProject: (name) => {
        const id = generateId()
        set((s) => ({
          projects: [
            ...s.projects,
            { id, name, documents: [], createdAt: Date.now() },
          ],
        }))
        return id
      },
      deleteProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          activeProjectId: s.activeProjectId === id ? null : s.activeProjectId,
          activeDocumentId:
            s.activeProjectId === id ? null : s.activeDocumentId,
        })),
      renameProject: (id, name) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === id ? { ...p, name } : p
          ),
        })),
      addDocument: (projectId, doc) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, documents: [...p.documents, doc] }
              : p
          ),
        })),
      removeDocument: (projectId, docId) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? { ...p, documents: p.documents.filter((d) => d.id !== docId) }
              : p
          ),
          activeDocumentId:
            s.activeDocumentId === docId ? null : s.activeDocumentId,
        })),
      renameDocument: (projectId, docId, name) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  documents: p.documents.map((d) =>
                    d.id === docId ? { ...d, name } : d
                  ),
                }
              : p
          ),
        })),
      setActiveProject: (id) => set({ activeProjectId: id }),
      setActiveDocument: (id) => set({ activeDocumentId: id }),
      getActiveDocument: () => {
        const state = get()
        if (!state.activeProjectId || !state.activeDocumentId) return null
        const project = state.projects.find(
          (p) => p.id === state.activeProjectId
        )
        if (!project) return null
        return (
          project.documents.find((d) => d.id === state.activeDocumentId) ??
          null
        )
      },
    }),
    { name: 'intent-ide-projects' }
  )
)
