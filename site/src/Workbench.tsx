import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./components";
import { getChapters, type ChapterId, type WorkbenchChapterId } from "./storyboard";
import { useLanguage } from "./i18n";
import "./stage.css";

const FRAME_WIDTH = 1280;
const FRAME_HEIGHT = 760;
type Camera = {
  x: number;
  y: number;
  width: number;
  height: number;
  overview?: boolean;
};
const overview: Camera = {
  x: 0,
  y: 0,
  width: FRAME_WIDTH,
  height: FRAME_HEIGHT,
  overview: true,
};
const CAMERA_DURATION = 850;
const CAMERA_EASING = "cubic-bezier(0.22, 0.68, 0, 1)";

type CameraPose = { x: number; y: number; scale: number };

function applyCameraPose(node: HTMLDivElement, pose: CameraPose) {
  node.style.transition = "none";
  node.style.zoom = String(pose.scale);
  node.style.transform = `translate(${pose.x / pose.scale}px,${pose.y / pose.scale}px) scale(1)`;
}

export type TourPlayback = {
  from: number;
  to: number;
  active: boolean;
  playing: boolean;
  resume: boolean;
  onComplete: () => void;
  onPause: () => void;
  onStep: (step: number) => void;
  onPrepared?: (ready: boolean) => void;
  onLoadError?: (message: string) => void;
};

export function TourStage({
  chapter,
  steps,
  captions,
  label,
  reduced,
  restartToken = 0,
  playback,
}: {
  chapter: ChapterId | "first-use";
  steps: readonly string[];
  captions: readonly string[];
  label: string;
  reduced: boolean;
  restartToken?: number;
  playback?: TourPlayback;
}) {
  const { language, t } = useLanguage();
  const frame = useRef<HTMLIFrameElement>(null);
  const surface = useRef<HTMLDivElement>(null);
  const section = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const cameraTimer = useRef(0);
  const bakedScale = useRef(1);
  const cameraReady = useRef(false);
  const lastScene = useRef("");
  const bootReady = useRef(false);
  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const completedScene = useRef("");
  const phoneMode = useRef(window.matchMedia("(max-width: 820px)").matches).current;
  const [ready, setReady] = useState(false);
  const [scenePrepared, setScenePrepared] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [visible, setVisible] = useState(false);
  const [width, setWidth] = useState(1100);
  const [camera, setCamera] = useState<Camera>(overview);
  const [step, setStep] = useState(0);
  const [scene, setScene] = useState({ chapter, restartToken, start: 0, revision: 0 });
  const [playing, setPlaying] = useState(!reduced);
  const [manual, setManual] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const send = useCallback((message: object) =>
    frame.current?.contentWindow?.postMessage(
      { source: "cg-promotion", scene: lastScene.current, ...message },
      "*",
    ), []);

  useEffect(() => {
    const size = new ResizeObserver((entries) =>
      setWidth(entries[0].contentRect.width),
    );
    if (surface.current) size.observe(surface.current);
    const observer = new IntersectionObserver(
      ([entry]) =>
        setVisible(entry.isIntersecting && entry.intersectionRatio > 0.18),
      { threshold: [0, 0.18, 0.35] },
    );
    if (section.current) observer.observe(section.current);
    return () => {
      size.disconnect();
      observer.disconnect();
    };
  }, []);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== "null" ||
        event.data?.source !== "cg-workbench-tour"
      )
        return;
      const message = event.data;
      if (message.type === "loaded") {
        if (message.protocol !== 4) {
          setLoadError("演示资源版本不一致，请重新载入。");
          return;
        }
        if (!bootReady.current) {
          bootReady.current = true;
          lastScene.current = "";
          setLoadError("");
          setReady(true);
        }
        return;
      }
      if (message.type === "error" && message.phase === "load") {
        setLoadError(message.message);
        return;
      }
      // iframe 的旧章节消息可能排在新章节之后到达，不能覆盖当前镜头与步骤。
      if (!lastScene.current || message.scene !== lastScene.current) return;
      if (message.type === "prepared") {
        setScenePrepared(true);
        playbackRef.current?.onPrepared?.(true);
      }
      if (message.type === "camera")
        setCamera(message.overview ? overview : message);
      if (message.type === "step") {
        setStep(message.step);
        setComplete(message.complete);
        setError("");
        playbackRef.current?.onStep(message.step);
        const controlled = playbackRef.current;
        if (message.complete && completedScene.current !== message.scene && (!controlled || controlled.playing || (reducedRef.current && controlled.active))) {
          completedScene.current = message.scene;
          playbackRef.current?.onComplete();
        }
      }
      if (message.type === "interaction") {
        setPlaying(false);
        setManual(true);
        playbackRef.current?.onPause();
      }
      if (message.type === "error") {
        setError(message.message);
        setPlaying(false);
        playbackRef.current?.onPause();
      }
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  useEffect(() => {
    playbackRef.current?.onLoadError?.(loadError);
  }, [loadError]);
  useEffect(() => {
    // 切端瞬间收到完成消息时先保留结果，回到该端再接续，不能在后台跳章。
    if (complete && (playback?.playing || (reduced && playback?.active)) && lastScene.current && completedScene.current !== lastScene.current) {
      completedScene.current = lastScene.current;
      playbackRef.current?.onComplete();
    }
  }, [complete, playback?.playing, playback?.active, reduced]);
  useEffect(() => {
    if (ready || !visible || loadError) return;
    send({ type: "hello" });
    const probe = window.setInterval(() => send({ type: "hello" }), 400);
    const timeout = window.setTimeout(() => setLoadError("工作台载入超时，请重新载入。"), 10000);
    return () => { clearInterval(probe); clearTimeout(timeout); };
  }, [ready, visible, loadAttempt, loadError, send]);
  useEffect(() => {
    if (!playback || !ready || !visible || scenePrepared || loadError) return;
    const timer = window.setTimeout(() => setLoadError("工作台准备超时，请重新载入。"), 10000);
    return () => clearTimeout(timer);
  }, [Boolean(playback), ready, visible, scenePrepared, loadError, scene]);
  useLayoutEffect(() => {
    lastScene.current = "";
    setScenePrepared(false);
    playbackRef.current?.onPrepared?.(false);
    setScene((value) => value.chapter === chapter && value.restartToken === restartToken
      ? value : { chapter, restartToken, start: playbackRef.current?.from ?? 0, revision: value.revision + 1 });
    setStep(0);
    setComplete(false);
    setManual(false);
    setExploring(false);
    setPlaying(!reduced);
    if (!playbackRef.current?.resume) setCamera(overview);
    setError("");
  }, [chapter, restartToken]);
  useEffect(() => {
    if (!ready || !visible || scene.chapter !== chapter || scene.restartToken !== restartToken) return;
    const key = chapter + ":" + scene.revision;
    if (lastScene.current === key) return;
    lastScene.current = key;
    const controlled = playbackRef.current;
    send({ type: "scene", chapter, step: controlled?.from ?? scene.start,
      playing: (controlled?.playing ?? playing) && !manual && !reduced, reduced,
      once: Boolean(controlled), stopAt: controlled?.to, resume: controlled?.resume });
  }, [ready, visible, chapter, restartToken, scene, playing, manual, reduced, send]);
  useEffect(() => {
    if (ready && scene.chapter === chapter && scene.restartToken === restartToken)
      send({ type: "play", playing: (playback?.playing ?? playing) && visible && !manual && !reduced });
  }, [ready, playing, playback?.playing, visible, manual, scene, chapter, restartToken, reduced, send]);
  useEffect(() => {
    if (ready) send({ type: "motion", reduced });
    if (reduced) setPlaying(false);
  }, [ready, reduced]);
  useEffect(() => {
    if (ready) send({ type: "page-wheel", enabled: !manual && !exploring });
  }, [ready, manual, exploring, send]);

  function jump(next: number, play = false) {
    if (!ready) return;
    lastScene.current = "";
    setScene((value) => ({ chapter, restartToken, start: Math.max(0, Math.min(steps.length - 1, next)), revision: value.revision + 1 }));
    setPlaying(play);
    setManual(false);
    setExploring(false);
    setComplete(false);
    setError("");
  }
  function toggle() {
    if (reduced) return;
    if (manual || error || (complete && !playing)) {
      jump(0, true);
      return;
    }
    setPlaying((value) => !value);
  }
  function reload() {
    bootReady.current = false;
    lastScene.current = "";
    playbackRef.current?.onPrepared?.(false);
    setReady(false);
    setScenePrepared(false);
    setLoadError("");
    setError("");
    setCamera(overview);
    setStep(0);
    setManual(false);
    setExploring(false);
    setComplete(false);
    setPlaying(!reduced);
    setScene((value) => ({ chapter, restartToken, start: 0, revision: value.revision + 1 }));
    setLoadAttempt((value) => value + 1);
  }
  const minimumHeight = width < 600 ? 220 : playback ? 350 : 370;
  const height = playback ? Math.min(620, Math.max(minimumHeight, width * 0.625))
    : Math.max(minimumHeight, (width * FRAME_HEIGHT) / FRAME_WIDTH);
  const base = Math.min(width / FRAME_WIDTH, height / FRAME_HEIGHT);
  let scale = base;
  let x = (width - FRAME_WIDTH * scale) / 2;
  let y = (height - FRAME_HEIGHT * scale) / 2;
  if (!camera.overview && !exploring) {
    scale = Math.max(
      base,
      Math.min(
        width < 600 ? 1 : 1.12,
        width / (camera.width + (width < 600 ? 40 : 180)),
        height / (camera.height + 160),
      ),
    );
    x = Math.min(
      0,
      Math.max(
        width - FRAME_WIDTH * scale,
        width / 2 - (camera.x + camera.width / 2) * scale,
      ),
    );
    y = Math.min(
      0,
      Math.max(
        height - FRAME_HEIGHT * scale,
        height / 2 - (camera.y + camera.height / 2) * scale,
      ),
    );
  }
  // 整个 iframe 在镜头移动时会被合成。把最终位移落在设备像素上，
  // 避免停稳后仍因半像素采样让文字和边框一起发虚。
  const deviceScale = window.devicePixelRatio || 1;
  x = Math.round(x * deviceScale) / deviceScale;
  y = Math.round(y * deviceScale) / deviceScale;
  useLayoutEffect(() => {
    const node = plane.current;
    if (!node) return;
    window.clearTimeout(cameraTimer.current);
    const target = exploring ? { x: 0, y: 0, scale: 1 } : { x, y, scale };
    if (!cameraReady.current || reduced || exploring) {
      cameraReady.current = true;
      bakedScale.current = target.scale;
      applyCameraPose(node, target);
      return;
    }
    const rasterScale = bakedScale.current;
    node.style.transition = `transform ${CAMERA_DURATION}ms ${CAMERA_EASING}`;
    node.style.zoom = String(rasterScale);
    node.style.transform = `translate(${target.x / rasterScale}px,${target.y / rasterScale}px) scale(${target.scale / rasterScale})`;
    cameraTimer.current = window.setTimeout(() => {
      bakedScale.current = target.scale;
      applyCameraPose(node, target);
    }, CAMERA_DURATION);
    return () => window.clearTimeout(cameraTimer.current);
  }, [x, y, scale, reduced, exploring]);
  return (
    <div
      className={"tour-shell" + (exploring ? " exploring" : "")}
      ref={section}
    >
      <div
        className="tour-stage"
        ref={surface}
        style={{ height: exploring ? Math.min(680, height + 140) : height }}
      >
        <div
          className="tour-plane"
          ref={plane}
          style={{
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT,
          }}
        >
          <iframe
            key={loadAttempt}
            ref={frame}
            title={label + ": " + t("真实 Context Guard 工作台")}
            src={import.meta.env.BASE_URL + `generated/workbench${language === "en" ? "-en" : ""}.html?protocol=4&embedded=1&phone=${phoneMode ? 1 : 0}&attempt=` + loadAttempt}
            sandbox="allow-scripts"
            referrerPolicy="same-origin"
            loading="lazy"
            onLoad={() => send({ type: "hello" })}
            onError={() => setLoadError("工作台资源加载失败，请重新载入。")}
          />
        </div>
        {(!ready || loadError) && (
          <div className={"tour-loading" + (loadError ? " has-error" : "")} role={loadError ? "alert" : "status"}>
            {loadError ? <><p>{t(loadError)}</p><button type="button" onClick={reload}>{t("重新载入")}</button></> : <><span />{t("载入工作台")}</>}
          </div>
        )}
      </div>
      {!playback && <div
        className="tour-transport"
        onMouseDown={(event) => event.preventDefault()}
      >
        <button
          className="tour-play"
          onClick={toggle}
          disabled={!ready || reduced}
          aria-label={t(playing && !manual ? "暂停" : "播放") + " " + label}
        >
          <Icon name={playing && !manual ? "pause" : "play"} size={15} />
        </button>
        <div className="tour-caption" aria-live={playing ? "off" : "polite"}>
          <span>{manual ? t("已暂停导览，可以直接操作。") : steps[step]}</span>
        </div>
        <button
          className="tour-replay"
          disabled={!ready}
          onClick={() => jump(0, !reduced)}
          aria-label={t("重播") + " " + label}
        >
          <Icon name="reset" size={15} />
        </button>
        <button
          className="tour-explore"
          disabled={!ready}
          aria-pressed={exploring}
          onClick={() => {
            if (exploring) jump(0, !reduced);
            else {
              setPlaying(false);
              setManual(true);
              setExploring(true);
              setCamera(overview);
            }
          }}
        >
          {t(exploring ? "返回演示" : "亲自试试")}
          <Icon name="arrow" size={13} />
        </button>
      </div>}
      {!playback && <div
        className="tour-progress"
        aria-label={label + " " + t("步骤")}
        onMouseDown={(event) => event.preventDefault()}
      >
        {steps.map((name, index) => (
          <button
            key={name}
            className={
              index === step ? "current" : index < step ? "passed" : ""
            }
            aria-label={label + "：" + name}
            aria-description={captions[index]}
            aria-current={index === step ? "step" : undefined}
            disabled={!ready}
            title={name}
            onClick={() => jump(index)}
          >
            <span />
          </button>
        ))}
      </div>}
      {error && (
        <div className="tour-error" role="alert">
          {t("演示已暂停：")}{t(error)}
          <button onClick={() => jump(0, !reduced)}>{t("重新开始")}</button>
        </div>
      )}
    </div>
  );
}

export function Workbench({ reduced = false, selected, onSelect, restartToken = 0 }: {
  reduced?: boolean;
  selected: WorkbenchChapterId;
  onSelect: (chapter: WorkbenchChapterId) => void;
  restartToken?: number;
}) {
  const { language, t } = useLanguage();
  const chapters = getChapters(language);
  const scene = chapters.find((item) => item.id === selected)!;
  return (
    <section
      id="workbench"
      className="feature-workbench"
      aria-label={t("工作台交互演示")}
    >
      <select
        className="tour-chapter-select"
        aria-label={t("演示功能")}
        value={selected}
        onChange={(event) => onSelect(event.target.value as WorkbenchChapterId)}
      >
        {chapters.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select>
      <div className="workbench-demo-layout">
        <div className="tour-chapters" role="tablist" aria-label={t("演示功能")}>
          {chapters.map((item) => (
            <button
              role="tab"
              key={item.id}
              aria-selected={selected === item.id}
              onClick={() => onSelect(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <TourStage
          chapter={selected}
          steps={scene.steps}
          captions={scene.captions}
          label={t("工作台")}
          reduced={reduced}
          restartToken={restartToken}
        />
      </div>
    </section>
  );
}
