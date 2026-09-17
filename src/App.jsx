import React, { useMemo, useState } from 'react';
import PasswordGate from './PasswordGate.jsx';
import { CENSUS, TERMS, VR_SEPARATIONS_LIST } from './lib/loadData.js';
import { cleanDepartment } from './lib/department.js';
import { exemptStatus } from './lib/exempt.js';
import Headcount from './views/Headcount.jsx';
import Tenure from './views/Tenure.jsx';
import Attrition from './views/Attrition.jsx';
import Turnover from './views/Turnover.jsx';
import VolReg from './views/VolReg.jsx';
import CostOfAttrition from './views/CostOfAttrition.jsx';
import TalentLocations from './views/TalentLocations.jsx';
import SpanOfControl from './views/SpanOfControl.jsx';
import PeopleAssistant from './views/PeopleAssistant.jsx';

// Grouped nav: a top-level entry either opens its own page directly
// (no `children`) or shows a hover dropdown of sub-pages. `tab` state
// always holds a leaf id, so the active leaf's own top-level group is
// found by searching `children` too (see `activeGroupId` below).
const NAV = [
  { id: 'chat', label: 'People Assistant', view: PeopleAssistant },
  {
    id: 'hc', label: 'Headcount', view: Headcount,
    children: [
      { id: 'hc', label: 'Headcount', view: Headcount },
      { id: 'ten', label: 'Tenure', view: Tenure },
    ],
  },
  {
    id: 'at', label: 'Attrition', view: Attrition,
    children: [
      { id: 'at', label: 'Attrition', view: Attrition },
      { id: 'to', label: 'Turnover', view: Turnover },
      { id: 'vr', label: 'Voluntary & Regrettable', view: VolReg },
      { id: 'coa', label: 'Cost of Attrition', view: CostOfAttrition },
    ],
  },
  { id: 'loc', label: 'Employee Locations', view: TalentLocations },
  { id: 'soc', label: 'Span of Control', view: SpanOfControl },
];

function findLeaf(id) {
  for (const item of NAV) {
    if (item.id === id) return item;
    if (item.children) {
      const child = item.children.find((c) => c.id === id);
      if (child) return child;
    }
  }
  return NAV[0];
}

function clearPassword() {
  sessionStorage.removeItem('lantern-hr-static-unlocked');
  window.location.reload();
}

export default function App() {
  const [tab, setTab] = useState('hc');
  const [dept, setDept] = useState('All');
  const [exempt, setExempt] = useState('All');

  const Active = findLeaf(tab).view;

  const departments = useMemo(
    () => [...new Set(CENSUS.map((r) => r.department).filter(Boolean))].sort((a, b) => cleanDepartment(a).localeCompare(cleanDepartment(b))),
    []
  );

  const matches = (r) =>
    (dept === 'All' || r.department === dept) &&
    (exempt === 'All' || exemptStatus(r.worker_category) === exempt);

  const filteredCensus = useMemo(() => CENSUS.filter(matches), [dept, exempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const filteredTerms = useMemo(() => TERMS.filter(matches), [dept, exempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const props = { census: filteredCensus, terms: filteredTerms, vrSeparations: VR_SEPARATIONS_LIST };
  const filtersActive = dept !== 'All' || exempt !== 'All';

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
            {NAV.map((item) => {
              const isActiveGroup = item.id === tab || (item.children || []).some((c) => c.id === tab);
              return (
                <div className={'nav-item' + (item.children ? ' nav-item--has-children' : '')} key={item.id}>
                  <button
                    className={'tab-btn' + (isActiveGroup ? ' tab-btn--active' : '')}
                    onClick={() => setTab(item.children ? item.children[0].id : item.id)}
                  >
                    {item.label}
                  </button>
                  {item.children && (
                    <div className="nav-dropdown">
                      {item.children.map((c) => (
                        <button
                          key={c.id}
                          className={'nav-dropdown-item' + (tab === c.id ? ' nav-dropdown-item--active' : '')}
                          onClick={() => setTab(c.id)}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <button className="btn-signout" onClick={clearPassword}>Sign out</button>
        </header>

        <div className="filter-bar">
          <span className="filter-bar-label">Filter every page by:</span>
          <label className="filter-bar-field">
            Department
            <select value={dept} onChange={(e) => setDept(e.target.value)}>
              <option value="All">All departments</option>
              {departments.map((d) => <option key={d} value={d}>{cleanDepartment(d)}</option>)}
            </select>
          </label>
          <label className="filter-bar-field">
            Exempt status
            <select value={exempt} onChange={(e) => setExempt(e.target.value)}>
              <option value="All">All</option>
              <option value="Exempt">Exempt</option>
              <option value="Non-Exempt">Non-Exempt</option>
              <option value="Other">Other (contractor/intern)</option>
            </select>
          </label>
          {filtersActive && (
            <button className="filter-bar-clear" onClick={() => { setDept('All'); setExempt('All'); }}>
              Clear filters
            </button>
          )}
        </div>

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
