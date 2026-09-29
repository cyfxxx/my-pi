/*
 * web-terminal/public/app.js — 浏览器终端前端
 *
 * 普通脚本（非 module）：xterm 的 UMD 包把 Terminal/FitAddon 挂在 globalThis 上，
 * 这样整个前端不需要打包器，改完刷新即可。
 *
 * 与后端的约定：
 *   二进制帧  = pty 原始字节（双向）
 *   文本帧    = JSON 控制消息 {t:…}
 *   服务端 → 客户端：hello / size / exit
 *   客户端 → 服务端：resize / restart / redraw / ping
 */
/* global Terminal, FitAddon */
(function () {
  'use strict';

  var statusEl = document.getElementById('status');
  var metaEl = document.getElementById('meta');
  var bootEl = document.getElementById('boot');
  var overlay = document.getElementById('overlay');
  var overlayText = document.getElementById('overlay-text');
  var overlayAction = document.getElementById('overlay-action');
  var reconnectBtn = document.getElementById('reconnect');
  var restartBtn = document.getElementById('restart');

  var FitAddonCtor = window.FitAddon && window.FitAddon.FitAddon ? window.FitAddon.FitAddon : window.FitAddon;
  if (typeof window.Terminal !== 'function' || typeof FitAddonCtor !== 'function') {
    document.body.innerHTML = '<p style="padding:20px;color:#f7768e">终端资源未加载（xterm.js / addon-fit.js 404）。请确认 npm install 已执行。</p>';
    return;
  }

  var term = new window.Terminal({
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK SC", monospace',
    fontSize: fontSizeFor(window.innerWidth),
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 5000,
    convertEol: false,
    macOptionIsMeta: true,
    theme: {
      background: '#0f1216',
      foreground: '#d7dde5',
      cursor: '#7aa2f7',
      selectionBackground: '#2a3446',
      black: '#1b2027',
      red: '#f7768e',
      green: '#4cc38a',
      yellow: '#e0af68',
      blue: '#7aa2f7',
      magenta: '#bb9af7',
      cyan: '#7dcfff',
      white: '#c0caf5'
    }
  });
  var fit = new FitAddonCtor();
  term.loadAddon(fit);
  term.open(document.getElementById('terminal'));

  var socket = null;
  var retryCount = 0;
  var retryTimer = null;
  var lastSent = { cols: 0, rows: 0 };
  var pendingRestart = false;
  var fitTimer = null;
  var closedByUs = false;
  var ptyBytes = 0;
  var sawPtyOutput = false;
  /* supervisor 会先打一行 ~23 字节的横幅，不能用"有任意输出"判定 TUI 就绪；
     pi 的首屏是数 KB，故用字节阈值。 */
  var TUI_READY_BYTES = 400;
  var bootStartedAt = 0;
  var bootTicker = null;

  function fontSizeFor(width) {
    if (width < 420) return 11;
    if (width < 700) return 12.5;
    return 14;
  }

  function setStatus(kind, text) {
    statusEl.className = 'pill pill--' + kind;
    statusEl.textContent = text;
  }

  /* ---- 启动提示 ---- */
  /* pi 首次启动要 ~20 秒（jiti 编译 custom/ 扩展）；这段时间只有 supervisor 一行提示，
     必须让用户知道是"在启动"而不是"卡住了"。 */

  function tickBoot() {
    var seconds = Math.round((Date.now() - bootStartedAt) / 1000);
    bootEl.textContent =
      seconds > 90
        ? 'agent 启动较慢（已 ' + seconds + 's）。可查看上方输出，或点「重连」重试。'
        : 'agent 启动中… ' + seconds + 's（首次启动需加载扩展，通常 20 秒左右）';
  }

  function startBootHint() {
    if (bootTicker !== null || sawPtyOutput) return;
    bootStartedAt = Date.now();
    bootEl.hidden = false;
    tickBoot();
    bootTicker = setInterval(tickBoot, 1000);
  }

  function stopBootHint() {
    if (bootTicker !== null) {
      clearInterval(bootTicker);
      bootTicker = null;
    }
    bootEl.hidden = true;
  }

  function showOverlay(text) {
    overlayText.textContent = text;
    overlay.hidden = false;
  }

  function hideOverlay() {
    overlay.hidden = true;
  }

  function shorten(text) {
    return text.length > 60 ? text.slice(0, 57) + '…' : text;
  }

  function sendControl(payload) {
    if (socket && socket.readyState === 1) socket.send(JSON.stringify(payload));
  }

  function sendBytes(bytes) {
    if (socket && socket.readyState === 1) socket.send(bytes);
  }

  /* ---- 尺寸 ---- */

  function applyFit() {
    try {
      fit.fit();
    } catch (err) {
      return;
    }
    var cols = term.cols;
    var rows = term.rows;
    if (cols === lastSent.cols && rows === lastSent.rows) return;
    lastSent.cols = cols;
    lastSent.rows = rows;
    sendControl({ t: 'resize', cols: cols, rows: rows });
  }

  function scheduleFit() {
    if (fitTimer !== null) return;
    fitTimer = setTimeout(function () {
      fitTimer = null;
      term.options.fontSize = fontSizeFor(window.innerWidth);
      applyFit();
    }, 120);
  }

  /* ---- 连接 ---- */

  function connect() {
    clearTimeout(retryTimer);
    retryTimer = null;
    closedByUs = false;
    setStatus('connecting', '连接中…');
    if (socket === null) ptyBytes = 0;

    var protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(protocol + '//' + location.host + '/ws');
    ws.binaryType = 'arraybuffer';
    socket = ws;

    ws.onopen = function () {
      retryCount = 0;
      setStatus('online', '已连接');
      applyFit();
      if (pendingRestart) {
        pendingRestart = false;
        sendControl({ t: 'restart' });
      }
      // 重放缓冲可能从中途开始（4MB 上限），强制一次全屏重绘。
      sendControl({ t: 'redraw' });
      term.focus();
    };

    ws.onmessage = function (event) {
      if (typeof event.data === 'string') {
        handleControl(event.data);
        return;
      }
      ptyBytes += event.data.byteLength;
      if (!sawPtyOutput && ptyBytes >= TUI_READY_BYTES) {
        sawPtyOutput = true;
        stopBootHint();
        setStatus('online', '已连接');
      }
      term.write(new Uint8Array(event.data));
    };

    ws.onclose = function () {
      if (socket === ws) socket = null;
      if (closedByUs) return;
      scheduleReconnect();
    };

    ws.onerror = function () {
      try {
        ws.close();
      } catch (err) {
        /* 交给 onclose 处理 */
      }
    };
  }

  function scheduleReconnect() {
    stopBootHint();
    retryCount += 1;
    var wait = Math.min(10000, 500 * Math.pow(2, retryCount - 1));
    setStatus('offline', '已断开，' + Math.round(wait / 1000) + 's 后重连');
    retryTimer = setTimeout(connect, wait);
  }

  function handleControl(text) {
    var message;
    try {
      message = JSON.parse(text);
    } catch (err) {
      return;
    }
    if (!message || typeof message !== 'object') return;

    if (message.t === 'hello') {
      metaEl.textContent = typeof message.command === 'string' ? shorten(message.command) : '';
      // 服务端随后会重放整个缓冲，先清屏避免叠加。
      term.reset();
      if (message.exit) {
        showExit(message.exit);
      } else {
        hideOverlay();
        if (!sawPtyOutput) {
          setStatus('connecting', '启动中…');
          startBootHint();
        }
      }
      applyFit();
      return;
    }

    if (message.t === 'exit') {
      showExit(message);
      return;
    }

    if (message.t === 'size') {
      // 服务端确认了尺寸；本地已经是这个值，无需处理。
      return;
    }

    if (message.t === 'pong') return;
  }

  function showExit(info) {
    stopBootHint();
    var detail = info.signal ? '信号 ' + info.signal : '退出码 ' + String(info.code);
    setStatus('exited', '会话已结束');
    showOverlay('agent 会话已结束（' + detail + '）。\n点下面的按钮重新拉起。');
  }

  /* ---- 输入 ---- */

  term.onData(function (data) {
    sendBytes(new TextEncoder().encode(data));
  });

  term.onBinary(function (data) {
    var bytes = new Uint8Array(data.length);
    for (var i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
    sendBytes(bytes);
  });

  /* ---- 按钮 ---- */

  function requestRestart() {
    hideOverlay();
    stopBootHint();
    sawPtyOutput = false;
    ptyBytes = 0;
    lastSent = { cols: 0, rows: 0 };
    if (socket && socket.readyState === 1) {
      sendControl({ t: 'restart' });
      setStatus('connecting', '重启中…');
    } else {
      pendingRestart = true;
      connect();
    }
  }

  restartBtn.addEventListener('click', requestRestart);
  overlayAction.addEventListener('click', requestRestart);
  reconnectBtn.addEventListener('click', function () {
    closedByUs = true;
    if (socket) {
      try {
        socket.close();
      } catch (err) {
        /* 忽略 */
      }
      socket = null;
    }
    retryCount = 0;
    connect();
  });

  /* ---- 尺寸变化 ---- */

  window.addEventListener('resize', scheduleFit);
  window.addEventListener('orientationchange', scheduleFit);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleFit);
  }

  connect();
  setTimeout(function () {
    term.focus();
  }, 50);
})();
