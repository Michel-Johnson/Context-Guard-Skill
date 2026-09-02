import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { Language } from "./locale";

const sourceWidth = 1440;
const sourceHeight = 900;

export function HeroWorkbenchVisual({ language, title }: { language: Language; title: string }) {
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const scene = "hero-map";

  const send = useCallback((message: object) => frame.current?.contentWindow?.postMessage(
    { source: "cg-promotion", scene, ...message },
    "*",
  ), []);

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
    let ready = false;
    let visible = false;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const play = () => {
      if (ready && !reduced) send({ type: "play", playing: visible });
    };
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.source !== "cg-workbench-tour" ||
        event.data.type !== "loaded" ||
        event.data.protocol !== 4 ||
        ready
      ) return;
      ready = true;
      if (!reduced) send({
        type: "scene",
        chapter: "map",
        step: 0,
        playing: visible,
        reduced: false,
      });
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio > 0.18;
      play();
      if (visible && !ready) send({ type: "hello" });
    }, { threshold: [0, 0.18, 0.5] });

    window.addEventListener("message", receive);
    if (surface.current) observer.observe(surface.current);
    const probe = window.setInterval(() => {
      if (visible && !ready) send({ type: "hello" });
    }, 400);
    return () => {
      window.clearInterval(probe);
      observer.disconnect();
      window.removeEventListener("message", receive);
    };
  }, [language, send]);

  // 宣传镜头始终按桌面源画布渲染；宿主设备的触控信息不能把 iframe 误判成手机布局。
  const source = `${import.meta.env.BASE_URL}generated/${language === "en" ? "workbench-en.html" : "workbench.html"}?embedded=1&phone=0&hero=1`;
  return <div className="hero-workbench" ref={surface}>
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
  </div>;
}
