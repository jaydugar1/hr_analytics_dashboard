/**
 * People Assistant — Vercel serverless function (Node runtime, default
 * export handler convention: https://vercel.com/docs/functions).
 *
 * Adapted from the main HR Dashboard Tool repo's server/chatRelay.mjs +
 * src/lib/chatTools.js + src/lib/chatSchema.js, collapsed into ONE
 * stateless per-request function since Vercel has no persistent server
 * process to hold a browser-driven tool loop across HTTP round trips like
 * the main repo does. Differences from the main repo, all deliberate:
 *
 * - The entire tool-calling loop (ask Claude -> run tool -> ask again) runs
 *   IN THIS FUNCTION, server-side, against the same anonymized dataset
 *   baked into src/data.js. The client only ever sends/receives plain text.
 * - No self-improving eval loop, no operator-guidance admin page, no
 *   conversation logging or judge model — all of that needs persistent
 *   storage this serverless function doesn't have. This is Q&A only.
 * - No get_applicants tool — Applicants/New Hires are out of scope for this
 *   static build (there is no offer-report dataset baked in at all).
 * - No "manager" grouping dimension anywhere — this build's data has no
 *   manager field (stripped at build-data time), so it's not offered as a
 *   thing to group by, consistent with the main repo never letting a chat
 *   tool return a name.
 *
 * PRIVACY BOUNDARY (same rule as the main repo's chatTools.js): every tool
 * below returns COUNTS, RATES, AND DATES ONLY. The dataset in src/data.js
 * itself never contains a name, employee id, or manager field, so there is
 * nothing to leak even by construction — but the tools are additionally
 * written to only ever return aggregates, matching the main repo's contract.
 */
import Anthropic from '@anthropic-ai/sdk';
import { CENSUS, TERMS } from '../src/lib/loadData.js';
import { isPresentAt, isVoluntaryReason, periodAttrition, periodBounds, shiftPeriod } from '../src/lib/metrics.js';
import { classifyEmployee, modeBreakdown, placeRollup } from '../src/lib/talent.js';
import { cleanDepartment } from '../src/lib/department.js';

// ------------------------------------------------------------- model choice
// claude-sonnet-5: chosen over claude-opus-5 for this lightweight, per-request
// Q&A tool-use loop -- Sonnet is materially cheaper/faster and is more than
// capable of routing a handful of well-described tools; Opus would be
// reasonable if answer quality on more ambiguous phrasing became an issue.
// (The main repo instead uses claude-haiku-4-5 for the same job; see the
// final report for why this build uses Sonnet instead.)
const CHAT_MODEL = 'claude-sonnet-5';
const CHAT_MAX_TOKENS = 1024;
const MAX_TOOL_ROUNDS = 4;
const MAX_QUESTION_CHARS = 800;
const MAX_MESSAGES = 40;

const validDate = (d) => d instanceof Date && !isNaN(d);
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const iso = (d) => (validDate(d) ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : null);
const MAX_GROUPS = 25;

function parseArgDate(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d) ? null : d;
}

function population(includeContractors) {
  return CENSUS.filter((r) => includeContractors || r.is_contractor !== true);
}
const termPool = (includeContractors) => TERMS.filter((r) => includeContractors || r.is_contractor !== true);
const popLabel = (ic) => (ic ? 'all workers (contractors included)' : 'employees only (contractors excluded)');

function maxTermDate(records) {
  let max = null;
  for (const r of records) {
    const d = r.termination_date;
    if (validDate(d) && (!max || d > max)) max = d;
  }
  return max;
}

function topGroups(counts, limit = MAX_GROUPS) {
  const rows = [...counts.entries()].map(([name, v]) => (typeof v === 'number' ? { name, count: v } : { name, ...v }))
    .sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name)));
  if (rows.length <= limit) return { groups: rows, truncated: false };
  const head = rows.slice(0, limit);
  const tail = rows.slice(limit);
  return { groups: head, truncated: true, note: `${tail.length} smaller groups (${tail.reduce((a, r) => a + r.count, 0)} people) were omitted.` };
}

const DEPT = (r) => cleanDepartment(r.department) || '(Unassigned)';
const HEADCOUNT_FIELD = {
  department: DEPT,
  state: (r) => r.location_state || '(Not recorded)',
  job_title: (r) => r.role || '(Not recorded)',
  worker_category: (r) => r.worker_category || '(Not recorded)',
  work_location: (r) => r.work_location || '(Not recorded)',
};
const TERM_FIELD = {
  reason: (r) => r.termination_reason || '(Not recorded)',
  department: DEPT,
  job_title: (r) => r.role || '(Not recorded)',
  month: (r) => (validDate(r.termination_date) ? `${r.termination_date.getFullYear()}-${String(r.termination_date.getMonth() + 1).padStart(2, '0')}` : '(No date)'),
  voluntary: (r) => (isVoluntaryReason(r.termination_reason) ? 'Voluntary' : 'Involuntary'),
};

// --------------------------------------------------------------- tool defs

const dim = (values, description) => ({ type: 'string', enum: values, description });
const dateArg = (description) => ({ type: 'string', description: `${description} Format YYYY-MM-DD.` });
const HEADCOUNT_DIMENSIONS = Object.keys(HEADCOUNT_FIELD);
const TERMINATION_DIMENSIONS = Object.keys(TERM_FIELD);

const TOOLS = [
  {
    name: 'get_data_inventory',
    description: 'What workforce data is loaded (row counts, date ranges). Call first if unsure whether data exists for a question.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_headcount',
    description: 'Headcount at a point in time, optionally broken down by one dimension. Use for "how many people do we have", "headcount by department".',
    input_schema: {
      type: 'object',
      properties: {
        as_of: dateArg('Date to count headcount on. Defaults to today.'),
        group_by: dim(HEADCOUNT_DIMENSIONS, 'Break the total down by this dimension. Omit for a single total.'),
        include_contractors: { type: 'boolean', description: 'Defaults to false (standard headcount is employees only).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_attrition',
    description: 'Annualized attrition for a period: (terminations x annualization factor) / average headcount. Factor is 12/month, 4/quarter, 1/year. Set trailing=true for a trend series.',
    input_schema: {
      type: 'object',
      properties: {
        granularity: dim(['month', 'quarter', 'year', 'last_12_months'], 'Period type. Required.'),
        year: { type: 'integer', description: 'Calendar year. Defaults to the year of the most recent termination.' },
        period: { type: 'integer', description: 'Which period within the year: 1-12 for month, 1-4 for quarter.' },
        termination_type: dim(['overall', 'voluntary', 'involuntary'], 'Which terminations count. Defaults to overall.'),
        include_contractors: { type: 'boolean', description: 'Defaults to false.' },
        trailing: { type: 'boolean', description: 'Return the trailing series instead of one period.' },
      },
      required: ['granularity'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_terminations',
    description: 'Termination counts over a date range, grouped by reason, department, job title, month, or voluntary split.',
    input_schema: {
      type: 'object',
      properties: {
        from: dateArg('Start of the termination-date window.'),
        to: dateArg('End of the termination-date window.'),
        group_by: dim(TERMINATION_DIMENSIONS, 'How to group. Defaults to reason.'),
        include_contractors: { type: 'boolean', description: 'Defaults to false.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_work_locations',
    description: 'Remote vs in-person split for active employees, and the count of people per office or remote location.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
const TOOL_NAMES = TOOLS.map((t) => t.name);

// ---------------------------------------------------------------- executors

function getDataInventory() {
  const termDates = TERMS.map((r) => r.termination_date).filter(validDate).sort((a, b) => a - b);
  const active = CENSUS.filter((r) => r.position_status === 'active');
  return {
    census: { loaded: true, associates: CENSUS.length, active: active.length, contractors_among_active: active.filter((r) => r.is_contractor === true).length },
    terminations: termDates.length
      ? { loaded: true, rows: TERMS.length, earliest: iso(termDates[0]), latest: iso(termDates[termDates.length - 1]) }
      : { loaded: false },
    withheld_from_you: 'Individual records, employee/manager names, and pay figures are unavailable through every tool.',
  };
}

function getHeadcount(input) {
  const ic = input.include_contractors === true;
  const pop = population(ic);
  const asOf = parseArgDate(input.as_of) || new Date();
  const present = pop.filter((r) => isPresentAt(r, asOf));
  const out = { as_of: iso(asOf), total_headcount: present.length, population: popLabel(ic) };
  if (!input.group_by) return out;
  const field = HEADCOUNT_FIELD[input.group_by];
  if (!field) return { error: `Unknown breakdown "${input.group_by}".` };
  const counts = new Map();
  for (const r of present) counts.set(field(r), (counts.get(field(r)) || 0) + 1);
  return { ...out, grouped_by: input.group_by, ...topGroups(counts) };
}

function getAttrition(input) {
  const ic = input.include_contractors === true;
  const pool = termPool(ic);
  const pop = population(ic);
  if (!pool.length) return { no_data: true, message: 'No termination data is loaded.' };

  const type = input.termination_type || 'overall';
  const counted = type === 'overall' ? pool : pool.filter((r) => isVoluntaryReason(r.termination_reason) === (type === 'voluntary'));
  const through = maxTermDate(pool) || new Date();

  const describe = (b, partial) => {
    const a = periodAttrition(pop, counted, b.start, b.end, b.factor);
    const avg = round1(a.avgHC);
    return {
      period: b.name, start: iso(a.start), end: iso(a.end), start_headcount: a.startHC, end_headcount: a.endHC,
      average_headcount: avg, terminated: a.terminated, annualization_factor: a.factor, rate_pct: round2(a.rate),
      basis: a.factor === 1 ? 'actual (no annualization)' : `annualized x${a.factor}`,
      formula: a.factor === 1 ? `${a.terminated} / ${avg} = ${round2(a.rate)}%` : `(${a.terminated} x ${a.factor}) / ${avg} = ${round2(a.rate)}%`,
      partial_period: partial,
      ...(partial ? { caveat: `Data runs through ${iso(through)}, so this rate is understated.` } : {}),
    };
  };
  const meta = {
    termination_type: type, population: popLabel(ic), data_through: iso(through),
    voluntary_definition: 'reason "Voluntary Resignation" or "Personal"; involuntary = every other reason',
  };
  const gran = input.granularity;

  if (gran === 'last_12_months') {
    const end = through;
    const start = new Date(through.getFullYear() - 1, through.getMonth(), through.getDate() + 1);
    return { ...meta, periods: [describe({ start, end, factor: 1, name: 'Last 12 months' }, false)] };
  }
  const view = gran === 'quarter' ? 'quarter' : gran === 'year' ? 'year' : 'month';
  if (view === 'year') {
    const years = [...new Set(pool.map((r) => (validDate(r.termination_date) ? r.termination_date.getFullYear() : null)).filter(Boolean))].sort();
    const wanted = input.year ? [input.year] : (input.trailing ? years.slice(-8) : [years[years.length - 1] ?? through.getFullYear()]);
    return { ...meta, periods: wanted.map((y) => { const b = periodBounds('year', y, 0); return describe(b, b.end > through); }) };
  }
  const year = input.year || through.getFullYear();
  const perYear = view === 'month' ? 12 : 4;
  const idx = input.period ? Math.min(Math.max(Number(input.period), 1), perYear) - 1 : (view === 'month' ? through.getMonth() : Math.floor(through.getMonth() / 3));
  if (!input.trailing) {
    const b = periodBounds(view, year, idx);
    return { ...meta, periods: [describe(b, b.end > through)] };
  }
  const n = view === 'month' ? 12 : 8;
  const periods = [];
  for (let k = n - 1; k >= 0; k--) {
    const p = shiftPeriod(view, year, idx, -k);
    const b = periodBounds(view, p.year, p.idx);
    periods.push(describe(b, b.end > through));
  }
  return { ...meta, periods };
}

function getTerminations(input) {
  const ic = input.include_contractors === true;
  let pool = termPool(ic);
  if (!pool.length) return { no_data: true, message: 'No termination data is loaded.' };
  const from = parseArgDate(input.from);
  const to = parseArgDate(input.to);
  if (from || to) pool = pool.filter((r) => validDate(r.termination_date) && (!from || r.termination_date >= from) && (!to || r.termination_date <= to));
  const dates = pool.map((r) => r.termination_date).filter(validDate).sort((a, b) => a - b);
  const vol = pool.filter((r) => isVoluntaryReason(r.termination_reason)).length;
  const out = {
    window: { from: iso(from || dates[0]), to: iso(to || dates[dates.length - 1]) },
    population: popLabel(ic), total_terminations: pool.length, voluntary: vol, involuntary: pool.length - vol,
    regrettable: pool.filter((r) => r.regrettable_flag === true).length,
  };
  if (!pool.length) return out;
  const field = TERM_FIELD[input.group_by || 'reason'];
  if (!field) return { error: `Unknown grouping "${input.group_by}".` };
  const counts = new Map();
  for (const r of pool) {
    const k = field(r);
    if (!counts.has(k)) counts.set(k, { count: 0, voluntary: 0, involuntary: 0 });
    const e = counts.get(k);
    e.count += 1;
    if (isVoluntaryReason(r.termination_reason)) e.voluntary += 1; else e.involuntary += 1;
  }
  const grouped = topGroups(counts);
  if ((input.group_by || 'reason') === 'month') grouped.groups.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return { ...out, grouped_by: input.group_by || 'reason', ...grouped };
}

function getWorkLocations() {
  const active = CENSUS.filter((r) => r.position_status === 'active');
  if (!active.length) return { no_data: true, message: 'No active-employee data is loaded.' };
  const classified = active.map(classifyEmployee);
  const b = modeBreakdown(classified);
  return {
    population: 'active employees and contractors',
    total: b.total, classified: b.known, unspecified: b.counts.unspecified,
    in_person: { count: b.counts.onsite, pct_of_classified: round1(b.pct.onsite), by_office: placeRollup(classified, 'onsite') },
    remote: { count: b.counts.remote, pct_of_classified: round1(b.pct.remote), by_location: placeRollup(classified, 'remote').slice(0, MAX_GROUPS) },
    rules: 'Hybrid counts as in person at its city. Offices are a closed list (Dallas, New York, Vancouver, Chicago) -- anything else is "Other". Offshore counts as remote.',
  };
}

const EXECUTORS = {
  get_data_inventory: getDataInventory,
  get_headcount: getHeadcount,
  get_attrition: getAttrition,
  get_terminations: getTerminations,
  get_work_locations: getWorkLocations,
};

function runTool(name, input) {
  if (!TOOL_NAMES.includes(name) || !EXECUTORS[name]) return { error: `Unknown tool "${name}".` };
  try {
    return EXECUTORS[name](input || {});
  } catch (e) {
    return { error: `That lookup failed: ${e && e.message ? e.message : 'unexpected error'}.` };
  }
}

// ------------------------------------------------------------ system prompt

function systemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return `You are the "People Assistant" built into Lantern's internal HR analytics dashboard. Today's date is ${today}.

HOW YOU GET NUMBERS
Every number you state must come from a tool call in this conversation. Never estimate or calculate a figure yourself.
If a tool reports no data, say so plainly. If a question can't be answered by any tool, say so directly.

WHAT YOU CANNOT SEE
You only ever receive aggregated figures. There are no individual employee records, names, managers, or salaries
available to you at all -- not withheld by policy, but literally absent from every tool's output. If asked about a
specific person, pay, or compensation, say that data isn't available through this assistant.

HOW TO ANSWER
Lead with the number, then brief context. State the period and the population the figure covers (employees only vs
all workers including contractors). Be brief -- two or three sentences for most questions. Do not mention tool names
or JSON to the user.`;
}

// ------------------------------------------------------------------- relay

function sanitizeHistory(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('Expected a non-empty messages array.');
  if (raw.length > MAX_MESSAGES) throw new Error('This conversation is too long -- start a new one.');
  return raw.map((m) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) throw new Error('Each message needs role "user" or "assistant".');
    const text = String(m.text ?? '');
    if (text.length > MAX_QUESTION_CHARS) throw new Error(`Please keep questions under ${MAX_QUESTION_CHARS} characters.`);
    return { role: m.role, content: text };
  });
}

let client = null;
const getClient = () => (client ||= new Anthropic());

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.ANTHROPIC_API_KEY.trim()) {
    res.status(503).json({ error: 'The assistant is not configured -- ANTHROPIC_API_KEY is missing on the server.' });
    return;
  }

  let messages;
  try {
    messages = sanitizeHistory(req.body && req.body.messages);
  } catch (e) {
    res.status(400).json({ error: e.message });
    return;
  }

  try {
    let rounds = 0;
    let reply;
    for (;;) {
      reply = await getClient().messages.create({
        model: CHAT_MODEL,
        max_tokens: CHAT_MAX_TOKENS,
        system: systemPrompt(),
        tools: TOOLS,
        messages,
      });

      if (reply.stop_reason !== 'tool_use') break;
      rounds += 1;
      if (rounds > MAX_TOOL_ROUNDS) {
        res.status(200).json({ reply: 'That question needed too many lookups -- try asking it more specifically.' });
        return;
      }

      messages = [...messages, { role: 'assistant', content: reply.content }];
      const toolResults = reply.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(runTool(b.name, b.input)) }));
      messages = [...messages, { role: 'user', content: toolResults }];
    }

    const text = (reply.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    res.status(200).json({ reply: text || "I wasn't able to put together an answer to that." });
  } catch (err) {
    const msg =
      err instanceof Anthropic.AuthenticationError ? 'The assistant is misconfigured -- the API key was rejected.' :
      err instanceof Anthropic.RateLimitError ? 'The assistant is busy right now -- try again in a moment.' :
      err && err.status === 529 ? 'The Claude API is overloaded at the moment. Wait a few seconds and try again.' :
      err instanceof Anthropic.APIError ? `The assistant returned an error (${err.status ?? 'unknown'}).` :
      'The assistant hit an unexpected error.';
    res.status(502).json({ error: msg });
  }
}
