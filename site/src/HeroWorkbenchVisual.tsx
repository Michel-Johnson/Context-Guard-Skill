import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Language } from "./locale";
import { useLanguage } from "./i18n";

const sourceWidth = 1440;
const sourceHeight = 900;

export function HeroWorkbenchVisual({ language, title, reduced }: { language: Language; title: string; reduced: boolean }) {
  const { t } = useLanguage();
  const [paused, setPaused] = useState(false);
  const playback = useRef({ ready: false, visible: false, paused, reduced });
  playback.current.paused = paused;
  playback.current.reduced = reduced;
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scene = "hero-map";

  const send = useCallback((message: object) => frame.current?.contentWindow?.postMessage(
    { source: "cg-promotion", scene, ...message },
    "*",
  ), []);

  const updatePlayback = useCallback(() => {
    const state = playback.current;
    if (state.ready) {
      send({ type: "motion", reduced: state.reduced });
      send({ type: "play", playing: state.visible && !state.paused && !state.reduced });
    }
  }, [send]);

  useEffect(updatePlayback, [paused, reduced, updatePlayback]);

  useLayoutEffect(() => {
    const update = () => {
      if (!surface.current || !frame.current) return;
      const scale = surface.current.clientWidth / sourceWidth;
      frame.current.style.transform = `scale(${scale})`;
    };
    const observer = new ResizeObserver(update);
    if (surface.current) observer.observe(surface.current);
    update();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const state = playback.current;
    state.ready = false;
    state.visible = false;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.source !== "cg-workbench-tour" ||
        event.data.type !== "loaded" ||
        event.data.protocol !== 4 ||
        state.ready
      ) return;
      state.ready = true;
      send({
        type: "scene",
        chapter: "explore",
        step: 0,
        playing: state.visible && !state.paused && !state.reduced,
        reduced: state.reduced,
      });
    };
    const observer = new IntersectionObserver(([entry]) => {
      state.visible = entry.isIntersecting && entry.intersectionRatio > 0.18;
      updatePlayback();
      if (state.visible && !state.ready) send({ type: "hello" });
    }, { threshold: [0, 0.18, 0.5] });

    window.addEventListener("message", receive);
    if (surface.current) observer.observe(surface.current);
    const probe = window.setInterval(() => {
      if (state.visible && !state.ready) send({ type: "hello" });
    }, 400);
    return () => {
      window.clearInterval(probe);
      observer.disconnect();
      window.removeEventListener("message", receive);
    };
  }, [language, send, updatePlayback]);

  // 宣传镜头始终按桌面源画布渲染；宿主设备的触控信息不能把 iframe 误判成手机布局。
  const source = `${import.meta.env.BASE_URL}generated/${language === "en" ? "workbench-en.html" : "workbench.html"}?embedded=1&phone=0&hero=1`;
  return <div className="hero-preview">
    <a className="hero-visual-link" href="#workbench" aria-label={t("查看工作台宣传图")}>
    <div className="hero-workbench" ref={surface}>
    <iframe
      ref={frame}
      src={source}
      title={title}
      width={sourceWidth}
      height={sourceHeight}
      tabIndex={-1}
      aria-hidden="true"
      sandbox="allow-scripts"
      onLoad={() => send({ type: "hello" })}
    />
    </div>
    </a>
    {!reduced && <button className="hero-playback" type="button" onClick={() => setPaused(!paused)}>
      <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span> {t(paused ? "播放" : "暂停")}
    </button>}
  </div>;
}
