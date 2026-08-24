import { useEffect, useMemo, useState } from 'react';
import Composer from './components/Composer.jsx';
import MessageList from './components/MessageList.jsx';
import SettingsPanel from './components/SettingsPanel.jsx';
import Sidebar from './components/Sidebar.jsx';
import StatusBar from './components/StatusBar.jsx';
import { useChat } from './hooks/useChat.js';
import { useConversations } from './hooks/useConversations.js';
import { useServerStatus } from './hooks/useServerStatus.js';
import { contextUsage } from './lib/tokens.js';

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState('');

  const {
    conversations, current, settings,
    createConversation, deleteConversation, selectConversation,
    updateConversation, updateSettings,
  } = useConversations();

  const { status, model, refresh } = useServerStatus();

  const chat = useChat({
    conversation: current,
    updateConversation,
    settings,
    model,
    refreshStatus: refresh,
  });

  useEffect(() => setDraft(''), [current.id]);

  // The pending message counts: the whole point of the gauge is to warn
  // *before* the server silently truncates the prompt.
  const usage = useMemo(() => {
    const msgs = [];
    if (current.systemPrompt?.trim()) msgs.push({ content: current.systemPrompt });
    for (const m of current.messages) msgs.push({ content: m.content || '' });
    if (chat.live) msgs.push({ content: chat.live.content });
    if (draft.trim()) msgs.push({ content: draft });
    return contextUsage(msgs, settings.max_tokens);
  }, [current, settings.max_tokens, chat.live, draft]);

  return (
    <div className="flex h-full">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        conversations={conversations}
        currentId={current.id}
        onSelect={selectConversation}
        onCreate={createConversation}
        onDelete={deleteConversation}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        <StatusBar
          status={status}
          model={model}
          usage={usage}
          title={current.title}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
          onToggleSettings={() => setSettingsOpen(true)}
        />

        <MessageList
          conversation={current}
          live={chat.live}
          liveStats={chat.liveStats}
          canAct={!chat.isStreaming}
          onEdit={chat.editAndResend}
          onRegenerate={chat.regenerate}
          onContinue={chat.continueMessage}
        />

        <Composer
          text={draft}
          onTextChange={setDraft}
          onSend={chat.send}
          onStop={chat.stop}
          isStreaming={chat.isStreaming}
          waitingForModel={chat.waitingForModel}
          liveStats={chat.liveStats}
          usage={usage}
          status={status}
        />
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={settings}
        onChange={updateSettings}
        conversation={current}
        onSystemPromptChange={(v) => updateConversation(current.id, (c) => ({ ...c, systemPrompt: v }))}
      />
    </div>
  );
}
