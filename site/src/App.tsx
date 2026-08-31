import { useEffect, useState } from "react";
import { MotionConfig, useReducedMotion } from "motion/react";
import { Icon, Reveal } from "./components";
import { Workbench } from "./Workbench";
import { DebugDemo } from "./DebugDemo";
import { Install } from "./Install";
import { RecordGuide } from "./RecordGuide";
import { ClientDemo } from "./ClientDemo";
import type { ClientId } from "./clients";
import { repository, type WorkbenchChapterId, type ChapterId } from "./storyboard";
import { useLanguage } from "./i18n";

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

  useEffect(() => {
    const anchor = location.hash.slice(1);
    if (!anchor) return;
    // 初次载入时 HTML 尚无锚点；等布局就绪后补定位，不覆盖已恢复的滚动位置。
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (window.scrollY === 0)
          document.getElementById(anchor)?.scrollIntoView({ behavior: "instant", block: "start" });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

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
      <div className={`site ${reduced ? "reduce-motion" : ""}`}>
        <a className="skip-link" href="#workbench">
          {t("跳到工作台演示")}
        </a>
        <header className="site-header">
          <a className="brand" href="#top" aria-label={t("Context Guard 首页")}>
            <Mark />
            <strong>Context Guard</strong>
          </a>
          <nav aria-label={t("主导航")}>
            <a href="#workbench">{t("工作台")}</a>
            <a href="#clients">{t("使用演示")}</a>
            <a href="#memory">{t("项目记忆")}</a>
            <a href="#debug">Debug</a>
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
        <main id="top" key={language}>
          <section className="hero" aria-labelledby="hero-title">
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
          <Workbench restartToken={workbenchRevision} reduced={reduced} selected={workbenchChapter} onSelect={setWorkbenchChapter} />
          <ClientDemo
            clientId={clientId}
            onClientChange={setClientId}
            reduced={reduced}
            onOpenDemo={openDemo}
          />
          <Reveal>
            <RecordGuide />
          </Reveal>
          <DebugDemo restartToken={debugRevision} reduced={reduced} />
          <Reveal>
            <Install clientId={clientId} onClientChange={setClientId} />
          </Reveal>
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
        </main>
        <footer className="site-footer">
          <div className="footer-brand">
            <a className="brand" href="#top">
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
    </MotionConfig>
  );
}
