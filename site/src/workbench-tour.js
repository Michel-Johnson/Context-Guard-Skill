// 只驱动原工作台控件。导览时钟、光标与取景属于宣传层，不替代产品行为。
(() => {
  const demoLanguage = window.__CG_TOUR_LANG__ || "zh";
  const text = window.__CG_TOUR_TEXT__ || ((value) => value);
  const parentOrigin = new URL(document.referrer || location.href).origin;
  let generation = 0;
  let playing = false;
  let reduced = false;
  let activeScene = "";
  let initialized = false;
  let loadError = "";
  let pageWheelEnabled = true;
  let completedThrough = -1;
  let cursorPosition = { x: 480, y: 270 };
  let simulatedTimers = [];
  // 只缩短演示空等；输入、镜头过渡与产品自身的状态计时保持原速。
  const pace = { opening: 650, step: 450, reading: 800, loop: 1100 };
  const cancelled = () => new DOMException("Tour cancelled", "AbortError");
  const send = (type, extra = {}) =>
    parent.postMessage(
      { source: "cg-workbench-tour", type, scene: activeScene, ...extra },
      parentOrigin,
    );
  const currentView = () =>
    document.querySelector("#nav-crumbs")?.innerText || "";
  const style = document.createElement("style");
  style.textContent = [
    ".cg-tour-target{outline:2px solid #b2783f!important;outline-offset:5px!important}",
    ".cg-tour-cursor{position:fixed;left:0;top:0;width:24px;height:30px;z-index:9999;pointer-events:none;opacity:0;filter:drop-shadow(0 2px 3px #0004)}",
    ".cg-tour-cursor svg{display:block;width:100%;height:100%}",
    ".cg-tour-cursor:after{content:'';position:absolute;left:-12px;top:-12px;width:30px;height:30px;border:2px solid #a56936;border-radius:50%;opacity:0}",
    ".cg-tour-cursor.pressing:after{opacity:.6;transform:scale(1.25)}",
    ".cg-tour-paused *,.cg-tour-paused *:before,.cg-tour-paused *:after{animation-play-state:paused!important}",
    ".cg-tour-reduced *{transition-duration:0s!important;animation-duration:0s!important}",
  ].join("\n");
  document.head.append(style);
  const cursor = document.createElement("div");
  cursor.className = "cg-tour-cursor";
  cursor.setAttribute("aria-hidden", "true");
  cursor.innerHTML =
    '<svg viewBox="0 0 24 30" fill="none"><path d="M3 2L20 17L12 18L8 26L3 2Z" fill="#29251e" stroke="#fffdf7" stroke-width="2" stroke-linejoin="round"/></svg>';
  document.body.append(cursor);
  // 防止内嵌工作台的编辑焦点将宣传页滚到别的章节。
  const nativeFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (options) {
    nativeFocus.call(this, { ...options, preventScroll: true });
  };

  function setPlaying(value) {
    playing = value;
    document.documentElement.classList.toggle(
      "cg-tour-paused",
      !value || document.hidden,
    );
  }
  document.addEventListener("visibilitychange", () => setPlaying(playing));
  function clearTarget() {
    document
      .querySelectorAll(".cg-tour-target")
      .forEach((el) => el.classList.remove("cg-tour-target"));
  }
  function highlight(el) {
    clearTarget();
    if (!el?.isConnected) return;
    el.classList.add("cg-tour-target");
  }
  function camera(el, overview = false) {
    if (overview || !el) {
      send("camera", { overview: true });
      return;
    }
    const rect = el.getBoundingClientRect();
    send("camera", {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    });
  }
  function node(title) {
    const localizedTitle = text(title);
    return [...document.querySelectorAll("#nodes .node")].find((el) =>
      [...el.querySelectorAll(".m-head > span"), ...el.children].some(
        (child) => child.tagName === "SPAN" && child.textContent === localizedTitle,
      ),
    );
  }
  function find(selector) {
    const el =
      typeof selector === "function"
        ? selector()
        : typeof selector === "string"
          ? document.querySelector(selector)
          : selector;
    if (!el) throw new Error(demoLanguage === "en" ? "A required workbench control is missing." : "未找到产品控件：" + String(selector));
    return el;
  }
  function positionCursor(x, y) {
    cursorPosition = { x, y };
    cursor.style.transform = "translate(" + x + "px," + y + "px)";
  }
  // 逻辑时间只在播放且标签可见时前进，暂停不消耗等待、输入或状态计时。
  function wait(ms, request, update) {
    return new Promise((resolve, reject) => {
      let elapsed = 0;
      let previous = performance.now();
      const tick = (now) => {
        if (request !== generation) {
          reject(cancelled());
          return;
        }
        const dt =
          playing && !document.hidden ? Math.min(now - previous, 80) : 0;
        previous = now;
        elapsed += dt;
        if (dt && update) update(Math.min(1, elapsed / Math.max(1, ms)));
        if (elapsed >= ms) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  async function settle(request) {
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    if (request !== generation) throw cancelled();
  }
  function revealInInspector(el) {
    const panel = el.closest("#detail");
    if (!panel) return;
    const rect = el.getBoundingClientRect();
    const bounds = panel.getBoundingClientRect();
    if (rect.top < bounds.top + 30 || rect.bottom > bounds.bottom - 30)
      panel.scrollTop += rect.top - bounds.top - 110;
  }
  async function point(selector, animate, request, overview = false) {
    let el = find(selector);
    revealInInspector(el);
    highlight(el);
    camera(el, overview);
    if (!animate || reduced) return el;
    cursor.style.opacity = "1";
    const from = { ...cursorPosition };
    await wait(620, request, (progress) => {
      el = find(selector);
      const rect = el.getBoundingClientRect();
      const t = 1 - Math.pow(1 - progress, 3);
      positionCursor(
        from.x + (rect.x + rect.width * 0.46 - from.x) * t,
        from.y + (rect.y + rect.height * 0.5 - from.y) * t,
      );
    });
    return el;
  }
  async function tap(selector, animate, request, overview = false, action) {
    const el = await point(selector, animate, request, overview);
    if (el.disabled || el.getAttribute("aria-disabled") === "true")
      throw new Error((demoLanguage === "en" ? "Workbench control is not ready: " : "产品控件尚不可用：") + el.textContent.trim());
    if (animate && !reduced) {
      cursor.classList.add("pressing");
      await wait(160, request);
    }
    if (request !== generation) throw cancelled();
    if (action) await action(el);
    else el.click();
    cursor.classList.remove("pressing");
    await settle(request);
  }
  async function type(selector, text, animate, request) {
    const el = await point(selector, animate, request);
    if (request !== generation) throw cancelled();
    el.focus({ preventScroll: true });
    const content = document.createTextNode("");
    el.replaceChildren(content);
    const characters = Array.from(text);
    let written = 0;
    const write = (count) => {
      if (request !== generation) throw cancelled();
      if (count <= written) return;
      content.appendData(characters.slice(written, count).join(""));
      written = count;
      getSelection()?.collapse(content, content.length);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // 整句使用一条时间轴，不让每个字的 rAF 取整误差累积；保留同一文本节点和光标。
    if (animate && !reduced && characters.length)
      await wait(characters.length * (demoLanguage === "en" ? 18 : 32), request, (progress) => write(Math.floor(progress * characters.length)));
    else write(characters.length);
    if (request !== generation) throw cancelled();
    el.blur();
    await settle(request);
  }
  function reset(chapter) {
    simulatedTimers = [];
    clearTarget();
    cursor.style.opacity = "0";
    cursor.classList.remove("pressing");
    clearRelationMode();
    exitBugPath(false);
    openBugPanel(false);
    closeOverlay();
    document.getElementById("tray").classList.remove("open");
    if (lensMode) exitLensMode();
    authMode = false;
    document.body.classList.remove("auth-mode");
    document.getElementById("btn-auth").classList.remove("on");
    repoId = "context-guard";
    catalog[repoId].auth = ["T0"];
    const sample = clone(window.__CG_TOUR_MAP__);
    if (chapter === "map" || chapter === "first-use") {
      sample.children = [];
      sample.memories = [];
    }
    applyMapDoc({ v: 1, project: repoId, bootstrap: "ready", root: sample });
    if (chapter === "proposals") {
      sample.children.forEach((n) => {
        n.origin = "agent";
      });
      catalog[repoId].live = proposedTree({ blueprint: sample });
      catalog[repoId].bootstrap = "proposed";
      loadLive(catalog[repoId]);
    }
    selectedId = data.id;
    viewRootId = data.id;
    focusId = null;
    clearCompose();
    clearAttach();
    foldMem = true;
    foldIdea = true;
    foldBug = true;
    foldDormant = true;
    foldInherited = false;
    uiLang = demoLanguage;
    applyStaticI18n();
    renderAll();
    syncChrome();
    fitView();
    document.getElementById("detail").scrollTop = 0;
    camera(null, true);
  }
  function scheduleProductState(callback, ms, request) {
    const timer = { callback, done: false };
    simulatedTimers.push(timer);
    wait(ms, request)
      .then(() => {
        if (!timer.done) {
          timer.done = true;
          callback();
        }
      })
      .catch(() => {});
  }
  async function stage(chapter, step, animate, request) {
    if (chapter === "first-use") {
      return stage(step < 4 ? "map" : "memory", step < 4 ? step : step - 4, animate, request);
    }
    const click = (selector, overview = false, action) =>
      tap(selector, animate, request, overview, action);
    if (chapter === "explore") {
      if (step === 0) camera(null, true);
      if (step === 1) await click(() => node("工作台"), true);
      if (step === 2) await click(() => node("前端设计"));
      if (step === 3) await click("#nav-crumbs a", true);
      if (step === 1 || step === 2) {
        highlight(document.querySelector("#detail h2"));
        camera(document.querySelector("#detail h2"));
      } else camera(null, true);
    } else if (chapter === "relations") {
      if (step === 0) camera(null, true);
      if (step === 1) await click("#btn-rel");
      if (step === 2) {
        await click(() => node("工作台"), true);
        highlight(node("工作台"));
        camera(null, true);
      }
      if (step === 3) {
        await click('[data-act="enter"]');
        camera(null, true);
      }
    } else if (chapter === "memory") {
      if (step === 0) {
        await click(() => node("工作台"), true);
        camera(document.querySelector('[data-fold="mem"]'));
      }
      if (step === 1) {
        await click('[data-act="add-mem"]');
        await type(
          '[data-fold="mem"] li:last-child [data-ed="mem"]',
          text("第一层已确认。工作台负责人与 Agent 的协作界面。"),
          animate,
          request,
        );
      }
      if (step === 2) {
        await click('[data-act="add-idea"]');
        await type(
          '[data-fold="idea"] li:last-child [data-ed="idea"]',
          text("下一步：先讨论工作台的第二层，再逐层确认。"),
          animate,
          request,
        );
      }
      if (step === 3) {
        // 叶模块只有选中态时仍在根视图，不一定有可返回的面包屑。
        await click(() => document.querySelector("#nav-crumbs a") || node("Context Guard"), true);
        await click(() => node("工作台"), true);
        camera(document.querySelector('[data-fold="mem"]'));
        highlight(document.querySelector('[data-fold="mem"]'));
      }
    } else if (chapter === "proposals") {
      if (step === 0) {
        highlight(node("工作台"));
        camera(null, true);
      }
      if (step === 1) {
        await click(() => node("工作台"));
        camera(document.querySelector("#detail h2"));
      }
      if (step === 2) {
        await click('[data-act="accept"]');
        camera(null, true);
      }
      if (step === 3) {
        // 继续处理另一张尚未加入的卡，不把“加入后隐藏”伪装成同一路径。
        // 提议详情可能仍在根视图，此时没有可返回的面包屑，直接选择另一张卡。
        if (document.querySelector("#nav-crumbs a")) await click("#nav-crumbs a", true);
        await click(() => node("冷启动"));
        await click('[data-act="cancel"]');
        await click("#btn-tray");
        camera(document.querySelector("#tray"));
      }
    } else if (chapter === "auth") {
      if (step === 0) camera(null, true);
      if (step === 1) await click("#btn-auth");
      if (step === 2 || step === 3) {
        await click(() => node("工作台"), true);
        highlight(node("工作台"));
        camera(null, true);
      }
    } else if (chapter === "map") {
      if (step === 0) camera(null, true);
      if (step === 1) {
        await click("#btn-lens", true, async () => {
          await enterLensMode();
          closeOverlay();
        });
        camera(null, true);
      }
      if (step === 2) {
        for (const id of ["M1", "M2", "M3", "M4"]) {
          await click('.shelf-card[data-cand="' + id + '"]', true);
          if (animate) await wait(100, request);
        }
        camera(null, true);
      }
      if (step === 3) {
        await click("#lens-finish-canvas", true);
        if (lensMode) throw new Error(demoLanguage === "en" ? "Layer one has not passed validation." : "第一层校验未通过，未完成定稿");
        await click(() => node("Context Guard"), true);
        await click('[data-act="accept-layer"]');
        camera(null, true);
      }
    } else if (chapter === "debug") {
      if (step === 0) {
        await click("#btn-bugs", true);
        camera(document.querySelector("#bug-panel-list"));
      }
      if (step === 1) {
        await click('#bug-panel-list li[data-bug="B20"]', true);
        camera(null, true);
      }
      if (step === 2) {
        await click("#bug-panel-list li.on .bug-status", true, () => {});
        camera(document.querySelector("#bug-panel-list li.on"));
      }
      if (step === 3) {
        await click("#btn-bug-exit", true);
        if (document.body.classList.contains("bugs-open"))
          await click("#btn-bugs", true);
        await click(() => node("工作台"), true);
        camera(document.querySelector('[data-fold="bug"]'));
      }
      if (step === 4) {
        await click('.bug-check[data-bug="B20"]', false, (el) => {
          const schedule = window.setTimeout;
          window.setTimeout = (callback, delay) => {
            scheduleProductState(callback, delay, request);
            return 0;
          };
          try {
            el.click();
          } finally {
            window.setTimeout = schedule;
          }
        });
        highlight(document.querySelector(".bug-pending"));
      }
      if (step === 5) {
        if (animate) await wait(1700, request);
        else
          simulatedTimers.forEach((timer) => {
            if (!timer.done) {
              timer.done = true;
              timer.callback();
            }
          });
        await settle(request);
        highlight(document.querySelector('[data-fold="dormant"]'));
        camera(document.querySelector('[data-fold="dormant"]'));
      }
    }
    if (request !== generation) throw cancelled();
    send("view", { view: currentView() });
  }
  async function run(chapter, start, request, options = {}) {
    try {
      if (options.once) {
        const first = Math.max(0, Math.min(7, start));
        const last = Math.max(first, Math.min(7, Number(options.stopAt) || 0));
        const resume = options.resume && chapter === "first-use" && completedThrough === first - 1;
        completedThrough = -1;
        if (!resume) {
          reset(chapter);
          await settle(request);
          // 任意跳章先重放前置操作快照；正常连播不重置地图。
          for (let i = 0; i < first; i++) await stage(chapter, i, false, request);
        }
        await settle(request);
        // 前置状态已经可见，父页可开始画面过渡；光标动作等播放消息后再执行。
        send("prepared");
        if (!reduced) await wait(1, request);
        for (let i = first; i <= last; i++) {
          send("step", { step: i, complete: false });
          await stage(chapter, i, !reduced, request);
          if (!reduced) await wait(i === 0 ? pace.opening : i === 5 || i === 6 ? pace.reading : pace.step, request);
        }
        completedThrough = last;
        cursor.style.opacity = "0";
        setPlaying(false);
        send("step", { step: last, complete: true });
        return;
      }
      completedThrough = -1;
      const count = chapter === "debug" ? 6 : 4;
      let first = Math.max(0, Math.min(start, count - 1));
      while (request === generation) {
        reset(chapter);
        await settle(request);
        for (let i = 0; i <= first; i++)
          await stage(chapter, i, false, request);
        // 告知父页新章节的首帧已经建立，避免上一章的结束消息触发连跳。
        send("prepared");
        send("step", { step: first, complete: false });
        // 快照先可见，再开始光标动作。重复播放只在一整段结束后重置。
        await wait(pace.opening, request);
        for (let i = first + 1; i < count; i++) {
          send("step", { step: i, complete: false });
          await stage(chapter, i, true, request);
          await wait(chapter === "debug" && i === 4 ? 300 : chapter === "memory" && (i === 1 || i === 2) ? pace.reading : pace.step, request);
        }
        cursor.style.opacity = "0";
        send("step", { step: count - 1, complete: true });
        await wait(pace.loop, request);
        first = 0;
      }
    } catch (error) {
      if (error.name !== "AbortError" && request === generation) {
        setPlaying(false);
        send("error", { message: String(error) });
      }
    }
  }
  window.addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.origin !== parentOrigin ||
      event.data?.source !== "cg-promotion"
    )
      return;
    const message = event.data;
    if (message.type === "hello") {
      if (loadError) send("error", { phase: "load", message: loadError });
      else if (initialized) send("loaded", { protocol: 4 });
      return;
    }
    if (message.type === "scene") {
      if (!initialized) return;
      activeScene = message.scene;
      reduced = Boolean(message.reduced);
      document.documentElement.classList.toggle("cg-tour-reduced", reduced);
      setPlaying(Boolean(message.playing));
      run(message.chapter, Number(message.step) || 0, ++generation, message);
    }
    if (message.type === "play" && message.scene === activeScene)
      setPlaying(Boolean(message.playing));
    if (message.type === "motion") {
      reduced = Boolean(message.reduced);
      document.documentElement.classList.toggle("cg-tour-reduced", reduced);
    }
    if (message.type === "page-wheel")
      pageWheelEnabled = Boolean(message.enabled);
    if (message.type === "overview") camera(null, true);
  });
  document.addEventListener(
    "wheel",
    (event) => {
      if (pageWheelEnabled) {
        event.preventDefault();
        send("page-wheel", {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ctrlKey: event.ctrlKey,
        });
        return;
      }
      if (!event.isTrusted) return;
      ++generation;
      completedThrough = -1;
      setPlaying(false);
      clearTarget();
      cursor.style.opacity = "0";
      send("interaction");
    },
    { capture: true, passive: false },
  );
  for (const name of ["pointerdown", "keydown"])
    document.addEventListener(
      name,
      (event) => {
        if (!event.isTrusted) return;
        ++generation;
        completedThrough = -1;
        setPlaying(false);
        clearTarget();
        cursor.style.opacity = "0";
        send("interaction");
      },
      { capture: true, passive: true },
    );
  for (const name of ["click", "keyup"])
    document.addEventListener(name, (event) => {
      if (event.isTrusted)
        queueMicrotask(() => send("view", { view: currentView() }));
    });
  // 复用产品唯一一次 boot；字体等待有上限，加载通知也可通过 hello 重取。
  const fontsReady = new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    Promise.resolve(document.fonts?.ready).then(() => {
      clearTimeout(timer);
      resolve();
    }, () => { clearTimeout(timer); resolve(); });
  });
  Promise.all([window.__CG_TOUR_BOOT__, fontsReady]).then(() => {
    initialized = true;
    setPlaying(false);
    send("loaded", { protocol: 4 });
  }).catch((error) => {
    loadError = (demoLanguage === "en" ? "Workbench failed to load: " : "工作台载入失败：") + String(error);
    send("error", { phase: "load", message: loadError });
  });
})();
