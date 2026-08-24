export function conversationToMarkdown(conv) {
  const date = new Date(conv.createdAt).toLocaleString('fr-FR');
  const head = [`# ${conv.title}`, '', `_${date}_`, ''];
  if (conv.systemPrompt?.trim()) {
    head.push('## System prompt', '', '```', conv.systemPrompt.trim(), '```', '');
  }
  const body = conv.messages
    .filter((m) => m.content?.trim())
    .map((m) => `## ${m.role === 'user' ? 'Moi' : 'Assistant'}\n\n${m.content.trim()}`);
  return [...head, ...body].join('\n') + '\n';
}

export function downloadMarkdown(conv) {
  const blob = new Blob([conversationToMarkdown(conv)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(conv.title)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return (s || 'conversation')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 60) || 'conversation';
}
