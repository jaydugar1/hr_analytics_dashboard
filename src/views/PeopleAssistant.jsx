import React, { useRef, useState } from 'react';

/**
 * People Assistant — a scoped-down "Ask Lantern" for this static build.
 *
 * Unlike the main repo (src/views/PeopleAssistant.jsx, src/lib/chatTools.js,
 * server/chatRelay.mjs), this version:
 * - Has NO self-improving eval loop / operator guidance admin page (that
 *   needs persistent server storage, unavailable on Vercel serverless).
 * - Runs the entire tool-calling loop inside a single Vercel serverless
 *   function (api/assistant.mjs) per request — no conversation logging.
 * - The client only ever sends/receives plain text; it never sees tool
 *   calls or tool results (those all happen server-side against the data
 *   baked into the function's own bundle).
 *
 * The privacy boundary (aggregates only, never names/salaries) is enforced
 * in api/assistant.mjs exactly the way the main repo's chatTools.js does it.
 */
export default function PeopleAssistant() {
  const [messages, setMessages] = useState([]); // [{role: 'user'|'assistant'|'error', text}]
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef(null);

  async function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const history = [...messages, { role: 'user', text }];
    setMessages(history);
    setInput('');
    setBusy(true);
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.map((m) => ({ role: m.role, text: m.text })) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setMessages((cur) => [...cur, { role: 'error', text: data.error || `The assistant returned an error (${res.status}).` }]);
      } else {
        setMessages((cur) => [...cur, { role: 'assistant', text: data.reply || '(no answer)' }]);
      }
    } catch (err) {
      setMessages((cur) => [...cur, { role: 'error', text: "Couldn't reach the assistant. Check your connection and try again." }]);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; });
    }
  }

  return (
    <div className="chat-wrap">
      <div className="callout" style={{ flexShrink: 0 }}>
        <div className="callout-title">People Assistant</div>
        Ask about headcount, attrition, terminations, or work locations. Every figure comes from a server-side lookup
        against this dashboard's own aggregate data — the assistant cannot see names, employee ids, managers, or pay,
        and it never stores this conversation.
      </div>
      <div className="chat-log" ref={logRef}>
        {messages.length === 0 && (
          <div style={{ fontSize: 13, color: '#8a8070', padding: '8px 4px' }}>
            Try: "What's our headcount by department?" or "What was attrition last quarter?" or "How many people work remote?"
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={'chat-bubble ' + (m.role === 'user' ? 'chat-bubble--user' : m.role === 'error' ? 'chat-bubble--error' : 'chat-bubble--assistant')}>
            {m.text}
          </div>
        ))}
        {busy && <div className="chat-bubble chat-bubble--assistant">Thinking…</div>}
      </div>
      <form className="chat-input-row" onSubmit={send}>
        <input
          type="text"
          placeholder="Ask a question about the workforce data…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>Ask</button>
      </form>
    </div>
  );
}
