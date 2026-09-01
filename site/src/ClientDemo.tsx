import { useEffect, useState } from "react";
import { getClients, type Client, type ClientId } from "./clients";
import { useLanguage } from "./i18n";
import { ClientUsagePlayer } from "./ClientUsagePlayer";
import type { Usage } from "./app-usage";
import type { ChapterId } from "./storyboard";
import "./client-demo.css";

export function ClientDemo({
  clientId,
  onClientChange,
  reduced,
  active = true,
  onOpenDemo,
}: {
  clientId: ClientId;
  onClientChange: (id: ClientId) => void;
  reduced: boolean;
  active?: boolean;
  onOpenDemo: (chapter: ChapterId) => void;
}) {
  const { language, t } = useLanguage();
  const clients = getClients(language);
  const [visited, setVisited] = useState<ClientId[]>([clientId]);
  useEffect(() => { setVisited((value) => value.includes(clientId) ? value : [...value, clientId]); }, [clientId]);
  return (
    <section
      className="client-demo"
      id="clients"
      aria-labelledby="clients-title"
    >
      <div className="client-demo-heading">
        <h2 id="clients-title">{t("在你熟悉的工具里，接着做。")}</h2>
      </div>
      <div
        className="client-demo-tabs"
        role="tablist"
        aria-label={t("使用演示客户端")}
      >
        {clients.map((item) => (
          <button
            key={item.id}
            id={"client-tab-" + item.id}
            type="button"
            role="tab"
            aria-selected={item.id === clientId}
            aria-controls={"client-panel-" + item.id}
            tabIndex={item.id === clientId ? 0 : -1}
            onClick={() => onClientChange(item.id)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = clients.findIndex((value) => value.id === item.id);
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? clients.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        clients.length) %
                      clients.length;
              onClientChange(clients[next].id);
              document
                .getElementById("client-tab-" + clients[next].id)
                ?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      {clients.map((client) => <div key={client.id} role="tabpanel" id={"client-panel-" + client.id}
        aria-labelledby={"client-tab-" + client.id} hidden={client.id !== clientId} inert={client.id !== clientId}>
        {(visited.includes(client.id) || client.id === clientId) && <ClientSession client={client}
          active={active && client.id === clientId} reduced={reduced} onOpenDemo={onOpenDemo} />}
      </div>)}
    </section>
  );
}

// 已访问的客户端保留自己的状态；隐藏时显式冻结时钟，不靠卸载重置。
function ClientSession({ client, active, reduced, onOpenDemo }: {
  client: Client; active: boolean; reduced: boolean; onOpenDemo: (chapter: ChapterId) => void;
}) {
  const [selection, setSelection] = useState<{ usageId: Usage["id"]; chapter: number }>({ usageId: "first", chapter: 0 });
  return <ClientUsagePlayer key={selection.usageId} client={client} active={active} usageId={selection.usageId}
    initialChapter={selection.chapter} onUsageChange={(usageId, chapter = 0) => setSelection({ usageId, chapter })}
    reduced={reduced} onOpenDemo={onOpenDemo} />;
}
