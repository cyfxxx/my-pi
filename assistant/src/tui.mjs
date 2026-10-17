/**
 * M1 终端前端：pi-tui 渲染 + 原生 /api 客户端。
 *
 * 它不是「另一个助手」，而是同一个宿主运行时的第二个前端：
 * 会话、工具、模型都在宿主那边，终端这边只负责画和收键。
 */
import { Container, Input, ProcessTerminal, Spacer, Text, TuiMainScreen } from '@earendil-works/pi-tui';
import { HostClient } from './transport.mjs';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

export class AssistantTui {
  /** @param {{url: string}} options */
  constructor(options) {
    this.client = new HostClient(options);
    this.sessionId = undefined;
    this.stream = undefined;
  }

  async run() {
    await this.client.connect();

    const terminal = new ProcessTerminal();
    this.tui = new TuiMainScreen(terminal, false);
    this.header = new Text('', 1, 0);
    this.transcript = new Container();
    this.status = new Text('', 1, 0);
    this.input = new Input({ prompt: '› ', placeholder: '说点什么…（Enter 发送，/new 新会话，/quit 退出）' });
    this.input.onSubmit = (value) => void this.#submit(value);

    this.tui.addChild(this.header);
    this.tui.addChild(new Spacer(1));
    this.tui.addChild(this.transcript);
    this.tui.addChild(this.status);
    this.tui.addChild(this.input);
    this.tui.setFocus(this.input);
    this.tui.start();

    this.#refreshHeader();
    this.#setStatus(dim('正在创建会话…'));
    try {
      const created = await this.client.call('session/create', { request: { cwd: process.cwd() } });
      this.sessionId = created.value.sessionId;
      // 可选：指定路线/模型（不改配置、只改本会话）。缺省用宿主的默认模型。
      const provider = process.env.MYPI_PROVIDER;
      const model = process.env.MYPI_MODEL;
      if (provider && model) {
        await this.client.call('session/selectModel', { request: { sessionId: this.sessionId, provider, model } });
      }
      this.#openFollow();
      this.#refreshHeader();
      this.#setStatus(dim('就绪'));
    } catch (error) {
      this.#setStatus(`\x1b[31m创建会话失败：${error.message}\x1b[0m`);
    }
  }

  #refreshHeader() {
    this.header.setText(
      `${bold('my-pi')}  ${dim('宿主')} ${this.client.origin}   ${dim('会话')} ${this.sessionId ?? '—'}`,
    );
    this.tui?.requestRender();
  }

  #setStatus(text) {
    this.status.setText(text);
    this.tui?.requestRender();
  }

  #append(text) {
    const node = new Text(text, 1, 0);
    this.transcript.addChild(node);
    this.tui.requestRender();
    return node;
  }

  #openFollow() {
    let live;
    let buffer = '';
    const flush = () => {
      live.setText(buffer);
      this.tui.requestRender();
    };
    const ensureLive = () => {
      if (live === undefined) {
        live = this.#append('');
        buffer = '';
      }
    };

    this.stream = this.client.openStream(
      'session/follow',
      { request: { address: { kind: 'session', sessionId: this.sessionId }, assistantStream: true } },
      {
        onItem: (item) => {
          if (item.type === 'event') {
            if (item.event?.type === 'turn/end') this.#setStatus(dim('就绪'));
            return;
          }
          if (item.type !== 'assistant-stream') return;
          const frame = item.frame ?? {};
          if (frame.type === 'start') {
            live = undefined;
            buffer = '';
            this.#setStatus(dim('模型输出中…'));
            return;
          }
          if (frame.type !== 'chunk') return;
          const chunk = frame.chunk ?? {};
          if (chunk.type === 'text-delta') {
            ensureLive();
            buffer += chunk.text ?? '';
            flush();
          } else if (chunk.type === 'block-start' && chunk.blockType === 'tool_use') {
            ensureLive();
            buffer += `\n${dim('[调用工具]')} `;
            flush();
          } else if (chunk.type === 'usage' && chunk.usage?.totalTokens !== undefined) {
            this.#setStatus(dim(`本次 ${chunk.usage.totalTokens} tokens`));
          }
        },
        onError: (error) => this.#setStatus(`\x1b[31m流错误：${JSON.stringify(error).slice(0, 160)}\x1b[0m`),
        onEnd: () => this.#setStatus(dim('流已结束（/new 重开一个会话）')),
      },
    );
  }

  async #submit(raw) {
    const text = raw.trim();
    this.input.setValue('');
    if (text === '') return;
    if (text === '/quit' || text === '/exit') {
      this.#stop();
      return;
    }
    if (text === '/new') {
      const created = await this.client.call('session/create', { request: { cwd: process.cwd() } });
      this.sessionId = created.value.sessionId;
      this.stream?.close();
      this.#openFollow();
      this.#refreshHeader();
      return;
    }
    if (this.sessionId === undefined) {
      this.#setStatus('\x1b[31m还没有会话\x1b[0m');
      return;
    }
    this.#append(`${bold('›')} ${text}`);
    try {
      await this.client.call('session/prompt', {
        request: {
          requestId: `tui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          sessionId: this.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
      });
      this.#setStatus(dim('已发送，等待模型…'));
    } catch (error) {
      this.#setStatus(`\x1b[31m发送失败：${error.message}\x1b[0m`);
    }
  }

  #stop() {
    this.stream?.close();
    this.client.close();
    this.tui.stop();
    process.exit(0);
  }
}

/** @param {string} url launcher 打印的带 token 的地址 */
export async function runTui(url) {
  const app = new AssistantTui({ url });
  process.on('SIGINT', () => {
    app.stream?.close();
    app.client.close();
    app.tui?.stop();
    process.exit(0);
  });
  await app.run();
}
