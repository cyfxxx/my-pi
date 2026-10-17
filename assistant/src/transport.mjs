/**
 * 原生客户端传输层：把 DSH 宿主的 /api 通道（HTTP 一元调用 + WebSocket 逻辑流）
 * 封装成两个原语，供 TUI/CLI 使用。
 *
 * 为什么是它：宿主对浏览器暴露的是「一个 /api 前缀 + 一个 /api/remote.mux WebSocket」，
 * 浏览器 GUI 与本客户端用的是**同一套**远端协议，因此「同一会话、两端同步」是结构事实，
 * 而不是镜像或轮询出来的。
 *
 * 握手（读宿主源码得出，非猜测）：
 *   1) GET /?token=<launchToken>            → 302 + Set-Cookie（签名会话 cookie）
 *   2) POST /api/<endpoint>  {type:'client-request', rpcId, method, payload}
 *   3) WS   /api/remote.mux  {type:'open'|'item'|'end'|'cancel'}
 */
import { WebSocket } from 'ws';

const API = '/api';
const MUX = '/api/remote.mux';

let seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(++seq).toString(36)}`;

/** 从 launcher 打印的 `?token=…` 换出会话 cookie。 */
export async function exchangeToken(url) {
  const res = await fetch(url, { redirect: 'manual' });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookie = setCookie.map((c) => c.split(';', 1)[0]).join('; ');
  if (!cookie) {
    throw new Error(`token 交换失败：HTTP ${res.status}，没有 Set-Cookie（token 可能已过期）`);
  }
  return cookie;
}

export class HostClient {
  /** @param {{url: string}} options url 必须是 launcher 打印的带 `?token=…` 的那个地址 */
  constructor({ url }) {
    const parsed = new URL(url);
    this.origin = `${parsed.protocol}//${parsed.host}`;
    this.wsOrigin = `${parsed.protocol === 'https:' ? 'wss' : 'ws'}://${parsed.host}`;
    this.url = url;
    this.cookie = undefined;
    this.socket = undefined;
    this.streams = new Map();
    this.ready = undefined;
  }

  async connect() {
    this.cookie = await exchangeToken(this.url);
    return this;
  }

  async call(endpoint, args = {}) {
    const rpcId = nextId('rpc');
    const payload = { args };
    const res = await fetch(`${this.origin}${API}/${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: this.cookie },
      body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status} ${text.slice(0, 200)}`);
    const full = JSON.parse(text);
    if (full.rpcId !== rpcId) throw new Error(`${endpoint}: rpcId 不匹配`);
    if (full.error !== undefined) throw new Error(`${endpoint}: ${JSON.stringify(full.error).slice(0, 300)}`);
    return full.result;
  }

  /** 打开一个逻辑流；返回 {send, end, close}。 */
  openStream(endpoint, args, { onItem, onError, onEnd } = {}) {
    const streamId = nextId('stream');
    const record = { streamId, endpoint, onItem, onError, onEnd };
    this.streams.set(streamId, record);
    this.#ensureSocket();
    const send = (value) => this.#send({ type: 'item', streamId, value });
    const end = () => this.#send({ type: 'end', streamId });
    const close = () => this.#send({ type: 'cancel', streamId });
    this.#send({ type: 'open', streamId, endpoint, payload: { args } });
    return { streamId, send, end, close };
  }

  #ensureSocket() {
    if (this.socket !== undefined) return;
    this.socket = new WebSocket(`${this.wsOrigin}${MUX}`, { headers: { cookie: this.cookie } });
    this.socket.on('message', (data) => this.#dispatch(data));
    this.socket.on('error', (err) => {
      for (const record of this.streams.values()) record.onError?.(err);
      this.socket = undefined;
    });
    this.socket.on('close', () => {
      this.socket = undefined;
    });
  }

  #send(message) {
    const text = JSON.stringify(message);
    if (this.socket === undefined || this.socket.readyState === WebSocket.CONNECTING) {
      // 等 socket open 后再发；握手是毫秒级，排一次即可
      setTimeout(() => this.#send(message), 20);
      return;
    }
    this.socket.send(text);
  }

  #dispatch(raw) {
    let frame;
    try {
      frame = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const record = this.streams.get(frame.streamId);
    if (record === undefined) return;
    if (frame.type === 'item') record.onItem?.(frame.value);
    else if (frame.type === 'error') record.onError?.(frame.error);
    else if (frame.type === 'end') {
      this.streams.delete(frame.streamId);
      record.onEnd?.();
    }
  }

  close() {
    for (const record of this.streams.values()) record.close?.();
    this.streams.clear();
    this.socket?.close();
    this.socket = undefined;
  }
}
