import React, { useState } from 'react';
import PasswordGate from './PasswordGate.jsx';
import { CENSUS, TERMS, VR_SEPARATIONS_LIST } from './lib/loadData.js';
import Headcount from './views/Headcount.jsx';
import Tenure from './views/Tenure.jsx';
import Attrition from './views/Attrition.jsx';
import Turnover from './views/Turnover.jsx';
import VolReg from './views/VolReg.jsx';
import CostOfAttrition from './views/CostOfAttrition.jsx';
import TalentLocations from './views/TalentLocations.jsx';
import PeopleAssistant from './views/PeopleAssistant.jsx';

// Simplified single-row tab nav (no dropdown needed — the main repo's
// nested dashboard/tab dropdown structure is overkill for 5 pages), adapted
// from the main repo's src/App.jsx + src/styles/app.css header pattern.
const TABS = [
  ['hc', 'Headcount', Headcount],
  ['ten', 'Tenure', Tenure],
  ['at', 'Attrition', Attrition],
  ['to', 'Turnover', Turnover],
  ['vr', 'Voluntary & Regrettable', VolReg],
  ['coa', 'Cost of Attrition', CostOfAttrition],
  ['loc', 'Employee Locations', TalentLocations],
  ['chat', 'People Assistant', PeopleAssistant],
];

function clearPassword() {
  sessionStorage.removeItem('lantern-hr-static-unlocked');
  window.location.reload();
}

export default function App() {
  const [tab, setTab] = useState('hc');
  const Active = TABS.find(([id]) => id === tab)[2];

  const props = { census: CENSUS, terms: TERMS, vrSeparations: VR_SEPARATIONS_LIST };

  return (
    <PasswordGate>
      <div>
        <header className="app-header">
          <div className="brand-block">
            <span className="brand-icon">
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  fill="var(--green-dark)"
                  d="M12.5 2.2c-1.1 2.7-3.6 4.3-3.6 7.8a4.6 4.6 0 109.2 0c0-1.1-.4-2-1-2.7.1 1.7-.8 2.9-2.2 2.9a2.1 2.1 0 01-2.1-2.1c0-1.9 1.4-2.9-.3-5.9z"
                />
              </svg>
            </span>
            <span className="brand-text">PEOPLE<br />ANALYTICS</span>
          </div>
          <nav className="tab-row">
            {TABS.map(([id, label]) => (
              <button key={id} className={'tab-btn' + (tab === id ? ' tab-btn--active' : '')} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </nav>
          <button className="btn-signout" onClick={clearPassword}>Sign out</button>
        </header>
        <main className="app-main">
          <Active {...props} />
          <footer className="footer">
            Aggregate workforce data only — no names, employee ids, or manager fields are present in this app's data.
          </footer>
        </main>
      </div>
    </PasswordGate>
  );
}
