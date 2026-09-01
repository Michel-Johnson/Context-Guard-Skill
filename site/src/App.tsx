import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { Icon } from "./components";
import { Workbench } from "./Workbench";
import { DebugDemo } from "./DebugDemo";
import { Install } from "./Install";
import { RecordGuide } from "./RecordGuide";
import { ClientDemo } from "./ClientDemo";
import type { ClientId } from "./clients";
import { repository, type WorkbenchChapterId, type ChapterId } from "./storyboard";
import { useLanguage } from "./i18n";

const pageIds = ["home", "workbench", "clients", "memory", "debug", "install"] as const;
type PageId = (typeof pageIds)[number];

const pageLabels: Record<PageId, string> = {
  home: "首页",
  workbench: "工作台",
  clients: "使用演示",
  memory: "项目记忆",
  debug: "Debug",
  install: "开始使用",
};

function pageFromHash(): PageId {
  const anchor = location.hash.slice(1);
  if (!anchor || anchor === "top") return "home";
  return pageIds.includes(anchor as PageId) ? (anchor as PageId) : "home";
}

function Page({ id, active, children }: { id: PageId; active: boolean; children: ReactNode }) {
  return (
    <div
      className={`site-page page-${id}`}
      data-page={id}
      data-active={active ? "true" : undefined}
      tabIndex={active ? -1 : undefined}
      inert={!active}
      aria-hidden={!active}
    >
      {children}
    </div>
  );
}

function Mark() {
  return (
    <img
      className="brand-mark"
      src={import.meta.env.BASE_URL + "favicon.svg?v=c-node"}
      width="32"
      height="32"
      alt=""
      aria-hidden="true"
    />
  );
}

export function App() {
  const { language, setLanguage, t } = useLanguage();
  const reducedSystem = useReducedMotion();
  const [reducedChoice, setReducedChoice] = useState<boolean | null>(null);
  const reduced = reducedChoice ?? Boolean(reducedSystem);
  const [clientId, setClientId] = useState<ClientId>("cursor");
  const [workbenchChapter, setWorkbenchChapter] = useState<WorkbenchChapterId>("explore");
  const [workbenchRevision, setWorkbenchRevision] = useState(0);
  const [debugRevision, setDebugRevision] = useState(0);
  const [activePage, setActivePage] = useState<PageId>(pageFromHash);
  const activePageRef = useRef(activePage);
  const [pageDirection, setPageDirection] = useState<"up" | "down">("down");
  const activeIndex = pageIds.indexOf(activePage);
  const wheelGesture = useRef({ delta: 0, locked: false, release: 0, lastEvent: 0 });

  const showPage = useCallback((page: PageId) => {
    const previous = pageIds.indexOf(activePageRef.current);
    const next = pageIds.indexOf(page);
    if (previous === next) return;
    setPageDirection(next > previous ? "down" : "up");
    activePageRef.current = page;
    setActivePage(page);
  }, []);

  useEffect(() => {
    const sync = () => showPage(pageFromHash());
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [showPage]);

  const goToPage = useCallback((page: PageId) => {
    if (location.hash !== `#${page}`) history.pushState(history.state, "", `#${page}`);
    showPage(page);
  }, [showPage]);

  const movePage = useCallback((offset: number) => {
    const current = pageIds.indexOf(activePageRef.current);
    const next = Math.max(0, Math.min(pageIds.length - 1, current + offset));
    if (next !== current) goToPage(pageIds[next]);
  }, [goToPage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("a, button, input, textarea, select, summary, [contenteditable='true']")) return;
      const offset = event.key === "PageDown" || event.key === "ArrowDown" ? 1
        : event.key === "PageUp" || event.key === "ArrowUp" ? -1 : 0;
      if (!offset) return;
      event.preventDefault();
      movePage(offset);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movePage]);

  const turnPageFromWheel = useCallback((deltaX: number, deltaY: number, deltaMode: number, ctrlKey: boolean) => {
    if (ctrlKey || !deltaY || Math.abs(deltaY) <= Math.abs(deltaX)) return false;
    const gesture = wheelGesture.current;
    gesture.lastEvent = performance.now();
    if (gesture.locked) return true;
    const scheduleRelease = (minimumDelay: number) => {
      window.clearTimeout(gesture.release);
      const release = () => {
        const idleFor = performance.now() - gesture.lastEvent;
        if (idleFor < 140) {
          gesture.release = window.setTimeout(release, 140 - idleFor);
          return;
        }
        gesture.delta = 0;
        gesture.locked = false;
      };
      gesture.release = window.setTimeout(release, minimumDelay);
    };
    const unit = deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : deltaMode === WheelEvent.DOM_DELTA_PAGE ? window.innerHeight : 1;
    gesture.delta += deltaY * unit;
    if (Math.abs(gesture.delta) < 48) {
      scheduleRelease(140);
      return true;
    }
    const direction = Math.sign(gesture.delta);
    gesture.delta = 0;
    gesture.locked = true;
    scheduleRelease(760);
    movePage(direction);
    return true;
  }, [movePage]);

  useEffect(() => {
    function onWheel(event: WheelEvent) {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (turnPageFromWheel(event.deltaX, event.deltaY, event.deltaMode, event.ctrlKey)) event.preventDefault();
    }
    function onFrameWheel(event: MessageEvent) {
      if (event.origin !== "null" || event.data?.source !== "cg-workbench-tour" || event.data?.type !== "page-wheel") return;
      turnPageFromWheel(Number(event.data.deltaX) || 0, Number(event.data.deltaY) || 0, Number(event.data.deltaMode) || 0, Boolean(event.data.ctrlKey));
    }
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("message", onFrameWheel);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("message", onFrameWheel);
      window.clearTimeout(wheelGesture.current.release);
      wheelGesture.current.delta = 0;
      wheelGesture.current.locked = false;
    };
  }, [turnPageFromWheel]);

  function handlePageLink(event: ReactMouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link || link.target) return;
    const anchor = link.hash.slice(1);
    const page = anchor === "top" ? "home" : anchor as PageId;
    if (!pageIds.includes(page)) return;
    event.preventDefault();
    goToPage(page);
    if (link.classList.contains("skip-link"))
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-page="${page}"]`)?.focus());
  }

  function openDemo(chapter: ChapterId) {
    if (chapter === "debug") setDebugRevision((value) => value + 1);
    else {
      setWorkbenchChapter(chapter);
      setWorkbenchRevision((value) => value + 1);
    }
  }

  return (
    <MotionConfig
      reducedMotion={reduced ? "always" : "never"}
      transition={reduced ? { duration: 0 } : undefined}
    >
      <div className={`site ${reduced ? "reduce-motion" : ""}`} onClick={handlePageLink}>
        <a className="skip-link" href="#workbench">
          {t("跳到工作台演示")}
        </a>
        <header className="site-header">
          <a className="brand" href="#home" aria-label={t("Context Guard 首页")}>
            <Mark />
            <strong>Context Guard</strong>
          </a>
          <nav aria-label={t("主导航")}>
            <a href="#workbench" aria-current={activePage === "workbench" ? "page" : undefined}>{t("工作台")}</a>
            <a href="#clients" aria-current={activePage === "clients" ? "page" : undefined}>{t("使用演示")}</a>
            <a href="#memory" aria-current={activePage === "memory" ? "page" : undefined}>{t("项目记忆")}</a>
            <a href="#debug" aria-current={activePage === "debug" ? "page" : undefined}>Debug</a>
          </nav>
          <div className="header-actions">
            <div className="language-switch" role="group" aria-label={language === "en" ? "Site language" : "页面语言"}>
              <button type="button" lang="en" aria-pressed={language === "en"} aria-label="Switch to English" onClick={() => setLanguage("en")}>EN</button>
              <button type="button" lang="zh-CN" aria-pressed={language === "zh"} aria-label="切换到中文" onClick={() => setLanguage("zh")}>中文</button>
            </div>
            <a
              className="header-github"
              href={repository}
              target="_blank"
              rel="noreferrer"
            >
              GitHub <span>↗</span>
            </a>
            <a className="header-install" href="#install">
              {t("开始使用")} <span>↓</span>
            </a>
          </div>
        </header>
        <main id="top" className="page-deck" key={language}>
          <div
            className="page-track"
            data-direction={pageDirection}
            style={{ transform: `translate3d(0, -${activeIndex * 100}%, 0)` }}
          >
          <Page id="home" active={activePage === "home"}>
            <section className="hero" id="home" aria-labelledby="hero-title">
              <h1 id="hero-title">
                {t("让每一次协作，都接得上一次。")}
              </h1>
              <div className="hero-actions">
                <a className="primary" href="#install">
                  {t("安装 Context Guard")} <span>↓</span>
                </a>
                <a className="hero-demo-link" href="#clients">
                  {t("看完整使用过程")} <Icon name="arrow" size={16} />
                </a>
              </div>
            </section>
          </Page>
          <Page id="workbench" active={activePage === "workbench"}>
            <Workbench restartToken={workbenchRevision} reduced={reduced} selected={workbenchChapter} onSelect={setWorkbenchChapter} />
          </Page>
          <Page id="clients" active={activePage === "clients"}>
            <div className="page-client-fit">
              <ClientDemo
                clientId={clientId}
                onClientChange={setClientId}
                reduced={reduced}
                active={activePage === "clients"}
                onOpenDemo={openDemo}
              />
            </div>
          </Page>
          <Page id="memory" active={activePage === "memory"}>
            <RecordGuide />
          </Page>
          <Page id="debug" active={activePage === "debug"}>
            <DebugDemo restartToken={debugRevision} reduced={reduced} />
          </Page>
          <Page id="install" active={activePage === "install"}>
            <div className="install-page-content">
              <Install clientId={clientId} onClientChange={setClientId} />
              <details className="demo-boundary">
                <summary>
                  {t("关于这份交互演示")} <span>+</span>
                </summary>
                <p>
                  {t("演示使用真实工作台与预设数据，不调用 Agent API，不读写本机项目。动画展示实际控件的操作过程；Bug 的处理与休眠展示记录状态，不代表执行了代码修复或测试。")}
                </p>
                <a
                  href={`${repository}/blob/main/prototype/workbench.html`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("查看工作台源码")} ↗
                </a>
                {" · "}<a href={`${import.meta.env.BASE_URL}client-ui-notices.txt`} target="_blank" rel="noreferrer">{t("界面素材与许可")} ↗</a>
              </details>
              <footer className="site-footer">
                <div className="footer-brand">
                  <a className="brand" href="#home">
                    <Mark />
                    <strong>Context Guard</strong>
                  </a>
                </div>
                <div className="footer-links">
                  <a
                    href={`${repository}/blob/main/${language === "en" ? "README.md" : "README.zh-CN.md"}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("文档")} ↗
                  </a>
                  <a href={repository} target="_blank" rel="noreferrer">
                    GitHub ↗
                  </a>
                  <button
                    className="motion-toggle"
                    aria-pressed={reduced}
                    onClick={() => setReducedChoice(!reduced)}
                  >
                    {t("减少动态")}
                    <span className={reduced ? "on" : ""}>
                      <i />
                    </span>
                  </button>
                </div>
              </footer>
            </div>
          </Page>
          </div>
        </main>
        <div className="page-position" aria-hidden="true">
          <span style={{ width: `${((activeIndex + 1) / pageIds.length) * 100}%` }} />
        </div>
        <div className="visually-hidden" aria-live="polite">
          {t("当前页面")}：{t(pageLabels[activePage])}
        </div>
      </div>
    </MotionConfig>
  );
}
