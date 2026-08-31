import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useTransform } from "motion/react";
import { clientViewport, type Client } from "./clients";
import { conversationTiming, type Usage } from "./app-usage";
import { getFirstUseStory } from "./first-use-story";
import { useLanguage } from "./i18n";
import { NativeClientFrame } from "./NativeClientFrame";
import { AnimatedNativeConversation } from "./NativeConversation";
import { NativeViewport } from "./NativeViewport";
import { TourStage } from "./Workbench";
import { useUsagePlayer } from "./useUsagePlayer";
import { usePaneTransition } from "./usePaneTransition";
import { Icon } from "./components";
import { UsageNavigation } from "./UsageNavigation";

export function FirstUseJourney({ client, reduced, active = true, initialChapter = 0, onUsageChange }: {
  client: Client;
  reduced: boolean;
  active?: boolean;
  initialChapter?: number;
  onUsageChange: (id: Usage["id"]) => void;
}) {
  const { language, t } = useLanguage();
  const { chapters, turns, steps: firstUseSteps, captions: firstUseCaptions } = getFirstUseStory(language);
  const initial = chapters[initialChapter] ?? chapters[0];
  const [position, setPosition] = useState({ index: chapters.indexOf(initial), revision: 0 });
  const [mode, setMode] = useState<"all" | "chapter">("all");
  const [finished, setFinished] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [full, setFull] = useState(false);
  const [closing, setClosing] = useState(false);
  const [workbench, setWorkbench] = useState({ from: initial.kind === "workbench" ? initial.from : 0,
    to: initial.kind === "workbench" ? initial.to : 0, revision: 0, resume: false });
  const [workbenchStep, setWorkbenchStep] = useState<number>(initial.kind === "workbench" ? initial.from : 0);
  const [preparedRevision, setPreparedRevision] = useState(-1);
  const [workbenchError, setWorkbenchError] = useState("");
  const [appScene, setAppScene] = useState<{ turn: number; revision: number }>({ turn: initial.kind === "app" ? initial.turn : 0, revision: 0 });
  const chapter = chapters[position.index];
  const isApp = chapter.kind === "app" || closing;
  // App 隐藏时保留上一次对话；不卸载工作台，也不把建好的图替换成演示地图。
  const turn = turns[appScene.turn];
  const timing = useMemo(() => conversationTiming(turn, client), [turn, client]);
  const history = useMemo(() => turns.slice(0, turns.indexOf(turn)), [turn]);
  const current = useRef({ position, mode, reduced, isApp, active, closing });
  current.current = { position, mode, reduced, isApp, active, closing };

  const canAdvance = useRef(true);
  const player = useUsagePlayer(reduced, {
    duration: timing.end,
    milestones: [timing.command, timing.sent, timing.result],
    enabled: isApp,
    selected: active,
    scene: String(appScene.revision),
    canAdvance,
    onComplete: () => finishChapter(),
  });
  const prepared = preparedRevision === workbench.revision;
  const transition = usePaneTransition(isApp ? 0 : 1, player.active, isApp || prepared || Boolean(workbenchError), reduced);
  canAdvance.current = transition.settled;
  // 新对话提交后才归零，旧画面不会先收到“回到第 0 帧”的通知。
  // 离开 App 时不动时钟，淡出期间仍然显示刚才的完整对话。
  useLayoutEffect(() => { player.seek(0); }, [appScene.revision, reduced]);
  const progress = useTransform(player.clock, (value) => {
    let local = isApp ? Math.min(1, value / timing.end)
      : Math.max(0, (workbenchStep - workbench.from + (finished ? 1 : 0)) / (workbench.to - workbench.from + 1));
    if (position.index === chapters.length - 1 && !reduced) local = closing ? .7 + local * .3 : local * .7;
    return mode === "all" ? (position.index + local) / chapters.length : local;
  });

  function select(index: number, resume = false) {
    const next = chapters[index];
    setFinished(false);
    setClosing(false);
    setInterrupted(false);
    if (!resume) setFull(false);
    setPosition((value) => ({ index, revision: value.revision + 1 }));
    if (next.kind === "workbench") {
      setPreparedRevision(-1);
      setWorkbench((value) => ({ from: next.from, to: next.to, revision: value.revision + 1, resume }));
      setWorkbenchStep(next.from);
    } else setAppScene((value) => ({ turn: next.turn, revision: value.revision + 1 }));
    player.setPlaying(!reduced);
  }
  function finishChapter() {
    const state = current.current;
    if (state.position.index === chapters.length - 1 && !state.closing && !state.reduced) {
      setClosing(true);
      setAppScene((value) => ({ turn: turns.length - 1, revision: value.revision + 1 }));
      return;
    }
    if (!state.reduced && state.mode === "all" && state.position.index < chapters.length - 1)
      select(state.position.index + 1, true);
    else { player.pause(); setFinished(true); }
  }
  const workbenchComplete = () => {
    if (!current.current.isApp && current.current.active) finishChapter();
  };
  const workbenchPause = () => {
    // 隐藏工作台的延迟事件不能改变当前 App 的播放状态。
    if (current.current.isApp || !current.current.active) return;
    player.pause();
    setInterrupted(true);
  };
  const previousReduced = useRef(reduced);
  useEffect(() => {
    if (previousReduced.current !== reduced) {
      previousReduced.current = reduced;
      select(position.index);
    }
  }, [reduced]);
  function restart() { select(mode === "all" ? 0 : position.index); }
  const openWorkbench = useCallback(() => select(3), [player.seek]);
  const clientWindow = useMemo(() => <NativeClientFrame client={client} title={t("一起建立项目地图")}>
    <AnimatedNativeConversation resetToken={appScene.revision} reduced={reduced} client={client} usage={turn}
      history={history} workbenchLink={turn === turns[2]} clock={player.clock}
      onSeek={player.seek} onOpen={openWorkbench} />
  </NativeClientFrame>, [client, turn, history, player.clock, player.seek, openWorkbench, appScene.revision, reduced, t]);
  const statusMessage = !isApp && workbenchError ? "工作台载入遇到问题，可在画面中重新载入。"
    : !isApp && !prepared ? "正在准备工作台。"
    : interrupted ? "导览已暂停，可以直接操作；播放将重播本章。" : "";

  return <div className={`client-demo-body first-use-journey ${!player.active ? "is-paused" : ""} ${reduced ? "is-reduced" : ""}`}>
    <UsageNavigation client={client} usageId="first" chapter={position.index} onChapterSelect={select}
      onUsageChange={onUsageChange} onPause={player.pause} playbackMode={<div className="journey-mode" role="group" aria-label={t("播放方式")}>
        <button type="button" aria-pressed={mode === "all"} onClick={() => { setMode("all"); select(0); }}>{t("完整播放")}</button>
        <button type="button" aria-pressed={mode === "chapter"} onClick={() => { setMode("chapter"); select(position.index); }}>{t("单章播放")}</button>
      </div>} />
    <div className="client-reference-stage" ref={player.region}>
    <div className="journey-stage">
      <div className="journey-screen" aria-hidden={!isApp} inert={!isApp || !transition.settled}>
        <NativeViewport clock={player.clock} full={full} reduced={reduced} timing={timing} turnKey={turn.title}
          {...clientViewport(client)}>{clientWindow}</NativeViewport>
      </div>
      <motion.div className="journey-screen journey-workbench-screen" style={{ opacity: transition.mix }} aria-hidden={isApp} inert={isApp || !transition.settled}>
        <TourStage chapter="first-use" label={t("连续首用")} steps={firstUseSteps} captions={firstUseCaptions}
          reduced={reduced} restartToken={workbench.revision} playback={{
            ...workbench, active: active && !isApp, playing: !isApp && player.active && transition.settled && prepared, onComplete: workbenchComplete,
            onPause: workbenchPause, onStep: setWorkbenchStep,
            onPrepared: (value) => setPreparedRevision(value ? workbench.revision : -1), onLoadError: setWorkbenchError,
          }} />
      </motion.div>
    </div>
    <div className="client-demo-controls journey-controls" onMouseDown={(event) => event.preventDefault()}>
      <button type="button" disabled={reduced} aria-label={t(player.playing && !finished ? "暂停完整流程" : "播放完整流程")}
        onClick={() => interrupted ? select(position.index) : finished ? restart() : player.setPlaying(!player.playing)}><Icon name={player.playing && !finished ? "pause" : "play"} size={15} /></button>
      <div className="journey-caption" aria-live="polite"><strong>{chapter.title}</strong>{statusMessage && <p>{t(statusMessage)}</p>}</div>
      {isApp && <button type="button" className="lesson-view-toggle" aria-pressed={full} onClick={() => setFull((value) => !value)}>{t(full ? "聚焦操作" : "查看全窗")}</button>}
      <button type="button" aria-label={t("重播当前章节")} onClick={() => select(position.index)}><Icon name="reset" size={16} /></button>
      <button type="button" className="journey-next" disabled={position.index === chapters.length - 1} onClick={() => select(position.index + 1)}>{t("下一章")} <Icon name="arrow" size={14} /></button>
    </div>
    <div className="client-demo-progress" aria-hidden="true"><motion.span style={{ width: "100%", scaleX: progress, transformOrigin: "0 50%" }} /></div>
    <div className="journey-footer"><button type="button" onClick={restart}>{t(mode === "all" ? "从头重播" : "重播本章")} ↺</button></div>
    </div>
  </div>;
}
