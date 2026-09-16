import { useState } from 'react';

// A simple client-side speed bump, not real security: this is a static
// site, so the password check happens in the browser and the app code (and
// the anonymized data baked into it, see src/data.js) is always visible in
// the bundle to anyone who looks. It just stops a link from being casually
// opened by someone who wasn't given the password. Ported from the same
// pattern used in the heat-map-dashboard sibling project.
const PASSWORD = 'lantern2026';
const STORAGE_KEY = 'lantern-hr-static-unlocked';

export default function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(STORAGE_KEY) === '1');
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);

  if (unlocked) return children;

  function submit(e) {
    e.preventDefault();
    if (value.trim().toLowerCase() === PASSWORD.toLowerCase()) {
      sessionStorage.setItem(STORAGE_KEY, '1');
      setUnlocked(true);
    } else {
      setError(true);
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <h1>Lantern HR Dashboard</h1>
        <p>This link is for internal use only. Enter the password to continue.</p>
        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          placeholder="Password"
        />
        {error && <div className="gate-error">That password isn't right.</div>}
        <button type="submit">Enter</button>
      </form>
    </div>
  );
}
