import { useState } from "react";
import { Icon } from "./components";
import { repository } from "./storyboard";
import { clients, installCommand, type ClientId } from "./clients";
import { useLanguage } from "./i18n";

export function Install({
  clientId,
  onClientChange,
}: {
  clientId: ClientId;
  onClientChange: (id: ClientId) => void;
}) {
  const { language, t } = useLanguage();
  const [copyState, setCopyState] = useState({ command: "", message: "" });
  const command = installCommand(clientId);
  const copied = copyState.command === command ? copyState.message : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopyState({ command, message: "已复制" });
    } catch {
      setCopyState({ command, message: "请选中命令，手动复制。" });
    }
  }

  return (
    <section
      className="install-section"
      id="install"
      aria-labelledby="install-title"
    >
      <div className="install-copy">
        <h2 id="install-title">{t("从下一次会话开始。")}</h2>
        <a
          className="text-link"
          href={`${repository}/blob/main/${language === "en" ? "README.md#install" : "README.zh-CN.md#安装"}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("安装文档")} <Icon name="arrow" size={16} />
        </a>
      </div>
      <div className="install-panel">
        <div className="client-tabs" aria-label={t("安装客户端")}>
          {clients.map((item) => (
            <button
              key={item.id}
              className={clientId === item.id ? "active" : ""}
              onClick={() => {
                onClientChange(item.id);
                setCopyState({ command: "", message: "" });
              }}
              aria-pressed={clientId === item.id}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="install-command">
          <code>{command}</code>
          <button
            onClick={copy}
            className="copy-command"
            aria-label={t("复制安装命令")}
          >
            <Icon name={copied === "已复制" ? "check" : "copy"} size={17} />
          </button>
        </div>
        <p className="copy-status" role="status">{t(copied)}</p>
      </div>
    </section>
  );
}
