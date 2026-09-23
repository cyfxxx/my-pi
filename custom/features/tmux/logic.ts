/**
 * Tmux Feature — 纯逻辑层 barrel（零 Pi 依赖）
 *
 * 实现按职责拆分：config（配置/路径）、session（tmux 进程/会话）、registry（注册表）。
 * 此文件仅重导出既有公开符号，保持 index.ts 与测试的导入路径不变。
 */

export {
  SESSION_PREFIX,
  TMUX_LOG_MAX_BYTES,
  defaultLogDir,
  registryPath,
  loadTmuxConfig,
  normalizeSessionName,
  isPiSession,
  ensureLogDir,
  logPathFor,
  rotateLogIfLarge,
  removeLog,
} from './config';
export type { TmuxOpts, TmuxConfig } from './config';

export {
  runTmux,
  classifySessionProbe,
  probeSession,
  hasSession,
  listSessions,
  startSession,
  readOutput,
  sendKeys,
  killSession,
  waitSession,
  tmuxMissingError,
} from './session';
export type { TmuxRunResult, SessionProbe, SessionInfo, ReadOutput, SendOpts, WaitResult } from './session';

export {
  loadRegistry,
  saveRegistry,
  registerSession,
  unregisterSession,
  pruneRegistry,
  shutdownCleanup,
} from './registry';
export type { RegistryEntry, Registry } from './registry';
