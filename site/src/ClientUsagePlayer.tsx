import { useCallback, useMemo, useState } from "react";
import { motion, useTransform } from "motion/react";
import { Icon } from "./components";
import { clientViewport, invocationPrompt, type Client } from "./clients";
import { conversationTiming, getUsages, type Usage } from "./app-usage";
import { useLanguage } from "./i18n";
import type { ChapterId } from "./storyboard";
import { NativeClientFrame } from "./NativeClientFrame";
import { AnimatedNativeConversation } from "./NativeConversation";
import { NativeViewport } from "./NativeViewport";
import { useUsagePlayer } from "./useUsagePlayer";
import { FirstUseJourney } from "./FirstUseJourney";
import { UsageNavigation } from "./UsageNavigation";


function CopyPrompt({ prompt, onCopy }: { prompt: string; onCopy: () => void }) {
  const { t } = useLanguage();
  const [status, setStatus] = useState("");
  return <button type="button" className="lesson-copy" onClick={async () => {
    onCopy();
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus("已复制");
    } catch {
      setStatus("复制失败，请手动选择文本");
    }
  }}><Icon name={status === "已复制" ? "check" : "copy"} size={14} /><span aria-live="polite">{t(status || "复制请求")}</span></button>;
}

type ClientUsagePlayerProps = {
  client: Client;
  usageId: Usage["id"];
  initialChapter?: number;
  onUsageChange: (id: Usage["id"], chapter?: number) => void;
  reduced: boolean;
  active: boolean;
  onOpenDemo: (chapter: ChapterId) => void;
};

export function ClientUsagePlayer(props: ClientUsagePlayerProps) {
  return props.usageId === "first"
    ? <FirstUseJourney client={props.client} active={props.active} reduced={props.reduced} initialChapter={props.initialChapter} onUsageChange={props.onUsageChange} />
    : <StandaloneUsagePlayer {...props} />;
}

function StandaloneUsagePlayer({ client, usageId, onUsageChange, reduced, active, onOpenDemo }: ClientUsagePlayerProps) {
  const { language, t } = useLanguage();
  const usages = getUsages(language);
  const usage = usages.find((item) => item.id === usageId)!;
  const timing = useMemo(() => conversationTiming(usage, client), [usage, client]);
  const player = useUsagePlayer(reduced, { selected: active, enabled: usageId !== "first", duration: timing.end,
    milestones: [timing.command, timing.sent, timing.result] });
  const [replay, setReplay] = useState(0);
  const [fullWindow, setFullWindow] = useState(false);
  const ready = player.elapsed >= timing.result;
  const prompt = invocationPrompt(client, usage.request);
  const progress = useTransform(player.clock, (value) => value / timing.end);
  function restart() {
    setReplay((value) => value + 1);
    setFullWindow(false);
    player.seek(0);
  }
  const openDemo = useCallback(() => {
    player.pause();
    onOpenDemo(usage.chapter ?? "debug");
  }, [player.pause, onOpenDemo, usage.chapter]);
  const clientWindow = useMemo(() => <NativeClientFrame client={client} title={usage.title}>
    <AnimatedNativeConversation client={client} usage={usage} clock={player.clock} reduced={reduced} resetToken={replay}
      onSeek={player.seek} onOpen={openDemo} />
  </NativeClientFrame>, [client, usage, player.clock, player.seek, openDemo, reduced, replay]);

  return <div className={"client-usage-state " + (usageId === "first" || player.active ? "" : "is-paused ") + (reduced ? "is-reduced" : "")}>
    <div className="client-demo-body">
      <UsageNavigation client={client} usageId={usageId} onPause={player.pause}
        onChapterSelect={(index) => usageId === "first" ? restart() : onUsageChange("first", index)}
        onUsageChange={(id) => id === usageId ? restart() : onUsageChange(id)} />
      <div className="client-reference-stage" ref={player.region}>
        <>
          <NativeViewport clock={player.clock} full={fullWindow} reduced={reduced} timing={timing} turnKey={usage.title} {...clientViewport(client)}>
            {clientWindow}
          </NativeViewport>
          <div className="client-demo-controls">
            <button type="button" disabled={reduced} aria-label={t(player.playing ? "暂停客户端演示" : "播放客户端演示")}
              onClick={() => player.elapsed >= timing.end ? restart() : player.toggle()}><Icon name={player.playing ? "pause" : "play"} size={15} /></button>
            <span className="journey-caption"><strong>{usage.title}</strong></span>
            <button type="button" className="lesson-view-toggle" aria-pressed={fullWindow} onClick={() => setFullWindow((value) => !value)}>{t(fullWindow ? "聚焦操作" : "查看全窗")}</button>
            <button type="button" aria-label={t("重播当前场景")} onClick={restart}><Icon name="reset" size={16} /></button>
          </div>
          <div className="client-demo-progress" role="progressbar" aria-label={t("演示进度")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(player.elapsed / timing.end * 100)}><motion.span style={{ width: "100%", scaleX: progress, transformOrigin: "0 50%" }} /></div>
          <div className="lesson-result">
            <div className="lesson-exercise" data-shown={ready}>
              <a href={usage.target} onClick={openDemo}>{usage.linkLabel}<Icon name="arrow" size={15} /></a>
            </div>
            <CopyPrompt key={replay} prompt={prompt} onCopy={player.pause} />
          </div>
        </>
      </div>
    </div>
  </div>;
}
