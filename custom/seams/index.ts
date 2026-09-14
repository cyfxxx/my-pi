/**
 * 能力缝隙（Capability Seam）类型定义
 *
 * 12 个能力缝隙，每个由三角色组成：
 * 1. Service Definition — 声明接口
 * 2. Service Provider — 实现接口
 * 3. Consumer — 消费服务（通常是模型工具）
 */

// 核心类型
export type {
  SeamName,
  ProviderName,
  SeamState,
  ServiceDefinition,
  ServiceProvider,
  SeamConsumer,
  SeamRegistry,
  SeamDefinition,
  SeamAPI,
} from './types.ts'

// 注册表
export { DefaultSeamRegistry, getSeamRegistry, resetSeamRegistry, SeamError } from './registry.ts'

// Shell 缝隙
export type {
  ShellService,
  ShellExecOptions,
  ShellResult,
  ShellProvider,
} from './shell/types.ts'
export { SHELL_SEAM_DEFINITION } from './shell/types.ts'
export { localShellProvider } from './shell/local-provider.ts'

// 文件系统 缝隙
export type {
  FSService,
  FSReadOptions,
  FSReadResult,
  FSWriteOptions,
  FSEdit,
  FSEditOptions,
  FSEditResult,
  GrepOptions,
  GrepResult,
  GrepMatch,
  FindOptions,
  FindResult,
  LSOptions,
  LSResult,
  FSEntry,
  FSStat,
  FSProvider,
} from './fs/types.ts'
export { FS_SEAM_DEFINITION } from './fs/types.ts'
export { localFSProvider } from './fs/local-provider.ts'

// 搜索 缝隙
export type {
  SearchService,
  SearchGrepOptions,
  SearchGrepResult,
  SearchGrepMatch,
  SearchFindOptions,
  SearchFindResult,
  SearchLSOptions,
  SearchLSResult,
  SearchLSEntry,
  SearchProvider,
} from './search/types.ts'
export { SEARCH_SEAM_DEFINITION } from './search/types.ts'

// 沙箱 缝隙
export type {
  SandboxService,
  SandboxType,
  SandboxWrapOptions,
  SandboxWrappedCommand,
  SandboxProvider,
} from './sandbox/types.ts'
export { SANDBOX_SEAM_DEFINITION } from './sandbox/types.ts'
export { nullSandboxProvider } from './sandbox/null-provider.ts'
export { landlockSandboxProvider } from './sandbox/landlock-provider.ts'
export { seatbeltSandboxProvider } from './sandbox/seatbelt-provider.ts'

// LLM 缝隙
export type {
  LLMService,
  LLMChatRequest,
  LLMChatResponse,
  LLMStreamChunk,
  LLMMessage,
  LLMTool,
  LLMToolCall,
  LLMUsage,
  LLMModel,
  LLMProvider,
} from './llm/types.ts'
export { LLM_SEAM_DEFINITION } from './llm/types.ts'

// 子代理 缝隙
export type {
  SubagentService,
  SubagentSpawnOptions,
  SubagentDelegateOptions,
  SubagentHandle,
  SubagentResult,
  SubagentInfo,
  SubagentProvider,
} from './subagent/types.ts'
export { SUBAGENT_SEAM_DEFINITION } from './subagent/types.ts'

// 凭证管理 缝隙
export type {
  CredentialsService,
  Credential,
  CredentialSetOptions,
  CredentialInfo,
  CredentialsProvider,
} from './credentials/types.ts'
export { CREDENTIALS_SEAM_DEFINITION } from './credentials/types.ts'

// 交互 缝隙
export type {
  InteractionService,
  ApprovalRequest,
  ApprovalResult,
  AskQuestion,
  AskOption,
  AskResult,
  Notification,
  InteractionProvider,
} from './interaction/types.ts'
export { INTERACTION_SEAM_DEFINITION } from './interaction/types.ts'

// 设置管理 缝隙
export type {
  SettingsService,
  SettingsChange,
  SettingsProvider,
} from './settings/types.ts'
export { SETTINGS_SEAM_DEFINITION } from './settings/types.ts'

// 会话日志 缝隙
export type {
  SessionLogService,
  SessionLogEvent,
  SessionLogReadOptions,
  DeriveMessagesOptions,
  SessionLogMessage,
  SessionProjection,
  SessionLogProvider,
} from './session-log/types.ts'
export { SESSION_LOG_SEAM_DEFINITION } from './session-log/types.ts'

// Webhook 缝隙
export type {
  WebhookService,
  WebhookRule,
  WebhookMatch,
  WebhookAction,
  WebhookEvent,
  WebhookResult,
  WebhookProvider,
} from './webhook/types.ts'
export { WEBHOOK_SEAM_DEFINITION } from './webhook/types.ts'

// 会话标题 缝隙
export type {
  SessionTitleService,
  SessionTitleMessage,
  SessionTitleProvider,
} from './session-title/types.ts'
export { SESSION_TITLE_SEAM_DEFINITION } from './session-title/types.ts'

// Todo 缝隙
export type {
  TodoService,
  TodoCreateInput,
  TodoUpdateInput,
  TodoItem,
  TodoListOptions,
  TodoProvider,
} from './todo/types.ts'
export { TODO_SEAM_DEFINITION } from './todo/types.ts'
