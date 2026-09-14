import type { ServiceDefinition, ServiceProvider } from '../types.ts'

// ============================================================================
// Todo 缝隙接口
// ============================================================================

export interface TodoService {
  /** 创建 todo */
  create(todo: TodoCreateInput): Promise<TodoItem>
  /** 更新 todo */
  update(id: string, updates: TodoUpdateInput): Promise<TodoItem>
  /** 删除 todo */
  delete(id: string): Promise<void>
  /** 获取 todo */
  get(id: string): Promise<TodoItem | undefined>
  /** 列出 todo */
  list(options?: TodoListOptions): Promise<TodoItem[]>
  /** 清空 todo */
  clear(): Promise<void>
}

export interface TodoCreateInput {
  label: string
  description?: string
  priority?: 'low' | 'medium' | 'high'
  status?: 'pending' | 'in_progress' | 'completed'
}

export interface TodoUpdateInput {
  label?: string
  description?: string
  priority?: 'low' | 'medium' | 'high'
  status?: 'pending' | 'in_progress' | 'completed'
}

export interface TodoItem {
  id: string
  label: string
  description?: string
  priority: 'low' | 'medium' | 'high'
  status: 'pending' | 'in_progress' | 'completed'
  createdAt: Date
  updatedAt: Date
}

export interface TodoListOptions {
  status?: 'pending' | 'in_progress' | 'completed'
  priority?: 'low' | 'medium' | 'high'
}

export const TODO_SEAM_DEFINITION: ServiceDefinition<TodoService> = {
  name: 'todo',
  description: '任务跟踪能力',
  defaultProvider: 'store',
}

export type TodoProvider = ServiceProvider<TodoService>
