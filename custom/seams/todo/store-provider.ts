import { randomUUID } from 'node:crypto'
import type { TodoProvider, TodoService, TodoItem, TodoCreateInput, TodoUpdateInput, TodoListOptions } from './types.ts'

interface TodoStoreState {
  items: Map<string, TodoItem>
}

/** Store Todo Provider（内存存储） */
export const storeTodoProvider: TodoProvider = {
  name: 'store',
  seam: 'todo',
  description: '内存 Todo 存储',
  impl: {
    _state: {
      items: new Map<string, TodoItem>(),
    } as TodoStoreState,

    async create(input: TodoCreateInput): Promise<TodoItem> {
      const now = new Date()
      const item: TodoItem = {
        id: randomUUID(),
        label: input.label,
        description: input.description,
        priority: input.priority ?? 'medium',
        status: input.status ?? 'pending',
        createdAt: now,
        updatedAt: now,
      }

      this._state.items.set(item.id, item)
      return item
    },

    async update(id: string, updates: TodoUpdateInput): Promise<TodoItem> {
      const existing = this._state.items.get(id)
      if (!existing) {
        throw new Error(`Todo not found: ${id}`)
      }

      const updated: TodoItem = {
        ...existing,
        ...updates,
        updatedAt: new Date(),
      }

      this._state.items.set(id, updated)
      return updated
    },

    async delete(id: string): Promise<void> {
      this._state.items.delete(id)
    },

    async get(id: string): Promise<TodoItem | undefined> {
      return this._state.items.get(id)
    },

    async list(options?: TodoListOptions): Promise<TodoItem[]> {
      let items = Array.from(this._state.items.values())

      if (options?.status) {
        items = items.filter(i => i.status === options.status)
      }
      if (options?.priority) {
        items = items.filter(i => i.priority === options.priority)
      }

      return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    },

    async clear(): Promise<void> {
      this._state.items.clear()
    },
  } as TodoService & { _state: TodoStoreState },
}
