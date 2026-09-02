import { useLayoutEffect, useRef } from "react";
import type { Language } from "./locale";

const sourceWidth = 1440;
const sourceHeight = 900;

export function HeroWorkbenchVisual({ language, title }: { language: Language; title: string }) {
  const surface = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

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

  const source = `${import.meta.env.BASE_URL}generated/${language === "en" ? "workbench-en.html" : "workbench.html"}`;
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
    />
  </div>;
}
