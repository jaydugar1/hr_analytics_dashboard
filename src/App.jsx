import React, { useState } from 'react';
import PasswordGate from './PasswordGate.jsx';
import { CENSUS, TERMS } from './lib/loadData.js';
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

  const props = { census: CENSUS, terms: TERMS };

  return (
    <PasswordGate>
      <div>
        <header className="app-header">
          <div className="brand-block">LANTERN HR</div>
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
