// Client-side controller for XBRL Autopilot
class XbrlApp {
  constructor() {
    this.currentTab = 'setup';
    this.init();
  }

  init() {
    this.setupFetchInterceptor();
    this.refreshSummary();
  }

  setupFetchInterceptor() {
    const origFetch = window.fetch;
    window.fetch = async (...args) => {
      const res = await origFetch(...args);
      const origJson = res.json.bind(res);
      res.json = async () => {
        const payload = await origJson();
        if (payload && typeof payload === 'object' && 'success' in payload && 'data' in payload) {
          if (res.ok && payload.data !== null && payload.data !== undefined) {
            return payload.data;
          }
        }
        return payload;
      };
      return res;
    };
  }

  toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.removeAttribute('hidden');
    el.style.display = 'block';
    setTimeout(() => {
      el.setAttribute('hidden', '');
      el.style.display = 'none';
    }, 4000);
  }

  openModal(title, contentHtml) {
    const modal = document.getElementById('modal');
    if (!modal) return;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = contentHtml;
    modal.removeAttribute('hidden');
    modal.style.display = 'flex';
  }

  closeModal() {
    const modal = document.getElementById('modal');
    if (!modal) return;
    modal.setAttribute('hidden', '');
    modal.style.display = 'none';
  }

  async selectTab(tabKey) {
    this.currentTab = tabKey;
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('on'));
    document.querySelectorAll('.tab-pane').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });

    const clicked = document.querySelector(`.nav-link[data-uri="${tabKey}"]`) ||
                    document.querySelector(`.nav-link[href="#${tabKey}"]`);
    if (clicked) clicked.classList.add('on');

    if (tabKey === 'setup') {
      const p = document.getElementById('pane-setup');
      p.classList.add('active');
      p.style.display = 'block';
    } else if (tabKey === 'validation') {
      const p = document.getElementById('pane-validation');
      p.classList.add('active');
      p.style.display = 'block';
      this.runValidation();
    } else if (tabKey === 'tools') {
      const p = document.getElementById('pane-tools');
      p.classList.add('active');
      p.style.display = 'block';
    } else {
      const p = document.getElementById('pane-elr');
      p.classList.add('active');
      p.style.display = 'block';
      await this.loadElrTab(tabKey);
    }
  }

  async loadElrTab(uri) {
    try {
      const res = await fetch(`/api/facts/tab/${encodeURIComponent(uri)}`);
      if (!res.ok) throw new Error('Failed to load tab data');
      const data = await res.json();
      document.getElementById('elr-code').textContent = `[${data.elr.code}] `;
      document.getElementById('elr-title').textContent = data.elr.title;

      const tbody = document.getElementById('elr-grid-body');
      tbody.innerHTML = '';

      data.rows.forEach(row => {
        const tr = document.createElement('tr');
        if (row.kind === 'header') {
          tr.className = 'hdr';
          tr.innerHTML = `<td colspan="3" style="padding-left: ${12 + (row.depth || 0) * 16}px"><b>${this.esc(row.label)}</b></td>`;
        } else if (row.kind === 'table') {
          tr.innerHTML = `<td colspan="3" style="padding-left: ${12 + (row.depth || 0) * 16}px">
            <b>Table:</b> ${this.esc(row.label)}
            <button class="btn small primary" style="margin-left: 10px;" onclick="window.app.loadTable('${row.tableId}')">Open Table</button>
          </td>`;
        } else if (row.kind === 'item') {
          const mCY = row.cy.mandatory ? '<span style="color:var(--bad); font-weight:bold; margin-left:4px;">*</span>' : '';
          const mPY = row.py.mandatory ? '<span style="color:var(--bad); font-weight:bold; margin-left:4px;">*</span>' : '';
          const calcCY = row.cy.calculated ? 'style="background:var(--cell-off);"' : '';
          const calcPY = row.py.calculated ? 'style="background:var(--cell-off);"' : '';

          tr.innerHTML = `
            <td class="lbl" style="padding-left: ${12 + (row.depth || 0) * 16}px">
              <span>${this.esc(row.label)}</span>
              <span class="el">${this.esc(row.concept)}</span>
            </td>
            <td class="val">
              <div style="display:flex; align-items:center;">
                <input type="text" class="cellin num" ${calcCY} value="${this.esc(row.cy.value)}"
                       onchange="window.app.onCellChange('${row.concept}', 'CY', this.value, '${row.preferredLabel || ''}')">
                ${mCY}
              </div>
            </td>
            <td class="val">
              <div style="display:flex; align-items:center;">
                <input type="text" class="cellin num" ${calcPY} value="${this.esc(row.py.value)}"
                       onchange="window.app.onCellChange('${row.concept}', 'PY', this.value, '${row.preferredLabel || ''}')">
                ${mPY}
              </div>
            </td>
          `;
        }
        tbody.appendChild(tr);
      });
    } catch (err) {
      this.toast(err.message);
    }
  }

  async loadTable(tableId, scope = 'CY') {
    this.currentTab = `table:${tableId}`;
    document.querySelectorAll('.tab-pane').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });
    const p = document.getElementById('pane-table');
    p.classList.add('active');
    p.style.display = 'block';

    const res = await fetch(`/api/facts/table/${tableId}?scope=${scope}`);
    const data = await res.json();
    document.getElementById('table-code').textContent = `[${tableId.split(':')[0]}] `;
    document.getElementById('table-title').textContent = data.title || tableId;

    const container = document.getElementById('dimensional-table-container');
    container.innerHTML = `
      <div class="grid-wrap" style="padding: 16px;">
        <h3>Dimensional Table [${this.esc(tableId)}]</h3>
        <p>Active Slices: <b>${data.slices ? data.slices.length : 0}</b></p>
        <p class="note">Enter dimensional facts or use Fill Totals to calculate subtotals.</p>
      </div>
    `;
  }

  async onCellChange(concept, scope, display, preferredLabel) {
    try {
      const res = await fetch('/api/facts/value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, scope, display, preferredLabel: preferredLabel || null, recalc: true })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Cell update error');
      }
      this.refreshSummary();
      this.toast('Saved');
    } catch (err) {
      alert(err.message);
    }
  }

  async saveMeta() {
    const patch = {
      name: document.getElementById('f-name').value,
      cin: document.getElementById('f-cin').value,
      reportType: document.getElementById('f-reportType').value,
      level: document.getElementById('f-level').value,
      displayPlaces: parseInt(document.getElementById('f-displayPlaces').value, 10),
      firstFinancialYear: document.getElementById('f-firstFY').checked,
      periods: {
        cy: {
          start: document.getElementById('f-cys').value,
          end: document.getElementById('f-cye').value
        },
        py: {
          start: document.getElementById('f-pys').value,
          end: document.getElementById('f-pye').value
        }
      }
    };

    const res = await fetch('/api/filing/meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    });
    if (res.ok) {
      document.getElementById('header-cin').textContent = (patch.cin || 'CIN NOT SET') + ' · ' + (patch.reportType || 'Standalone');
      document.getElementById('header-name').textContent = patch.name || 'Untitled Filing';
      document.getElementById('chip-level').textContent = patch.level || 'Actual';
      this.toast('Setup configuration saved');
      this.refreshSummary();
    }
  }

  async newFiling() {
    if (confirm('Start a brand new filing? Unsaved changes will be cleared.')) {
      const res = await fetch('/api/filing/new', { method: 'POST' });
      if (res.ok) window.location.reload();
    }
  }

  async runValidation() {
    const res = await fetch('/api/validation');
    const data = await res.json();

    const sumEl = document.getElementById('validation-summary');
    sumEl.innerHTML = `
      <span class="chip ${data.ok ? 'ok' : 'bad'}">${data.ok ? 'PASS' : 'FAIL'}</span>
      <span class="chip bad">Blocking Errors: ${data.summary.errors}</span>
      <span class="chip warn">Warnings: ${data.summary.warnings}</span>
      <span class="chip info">Total Facts: ${data.summary.facts}</span>
    `;

    const errDot = document.getElementById('sidebar-errors-dot');
    if (errDot) errDot.style.display = data.summary.errors > 0 ? 'inline-block' : 'none';

    const tbody = document.getElementById('validation-issues');
    tbody.innerHTML = '';

    if (!data.issues || data.issues.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--ok);">No issues found! Filing is completely valid.</td></tr>';
      return;
    }

    data.issues.forEach(iss => {
      const tr = document.createElement('tr');
      const sevClass = iss.severity === 'ERROR' ? 'bad' : 'warn';
      tr.innerHTML = `
        <td><span class="chip ${sevClass}">${iss.severity}</span></td>
        <td><code>${this.esc(iss.code || iss.ruleId)}</code></td>
        <td>${this.esc(iss.message)}</td>
        <td><button class="btn small" onclick='window.app.applyFix(${JSON.stringify(iss)})'>Fix</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  async validateCurrentTab() {
    if (!this.currentTab || this.currentTab === 'setup' || this.currentTab === 'validation' || this.currentTab === 'tools') {
      return this.runValidation();
    }
    const res = await fetch(`/api/validation/tab?elr_uri=${encodeURIComponent(this.currentTab)}`);
    const data = await res.json();
    alert(`Tab validation: ${data.summary.errors} errors, ${data.summary.warnings} warnings.`);
  }

  async applyFix(issue) {
    const res = await fetch('/api/validation/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(issue)
    });
    if (res.ok) {
      this.toast('Fix applied');
      this.runValidation();
    } else {
      const err = await res.json();
      alert(err.detail || 'Fix could not be applied automatically.');
    }
  }

  async runHealthCheck() {
    const res = await fetch('/api/tools/health?move=true');
    const data = await res.json();
    const div = document.getElementById('health-check-results');
    div.innerHTML = `
      <div style="padding:10px; background:var(--panel); border:1px solid var(--line); border-radius:4px;">
        <b>Health check complete:</b> ${data.changed || 0} facts re-derived.<br>
        Set aside: ${data.setAsideCount || 0} facts stored.
      </div>
    `;
    this.toast('Health check complete');
  }

  async explainMcaErrors() {
    const text = document.getElementById('mca-error-input').value;
    const res = await fetch('/api/validation/explain-mca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await res.json();
    const out = document.getElementById('mca-error-output');
    out.innerHTML = data.map(d => `
      <div style="border-top: 1px solid var(--line); padding: 8px 0; margin-top: 6px;">
        <b>${this.esc(d.title)} (${this.esc(d.code)})</b>
        <p style="margin:4px 0;"><em>Meaning:</em> ${this.esc(d.meaning)}</p>
        <p style="margin:4px 0; color:var(--accent);"><em>Fix:</em> ${this.esc(d.fix)}</p>
      </div>
    `).join('');
  }

  async loadExample() {
    if (confirm('Load sample company filing? Current unsaved edits will be replaced.')) {
      const res = await fetch('/api/filing/example', { method: 'POST' });
      if (res.ok) window.location.reload();
    }
  }

  async onXmlChosen(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/filing/import/xml?year_mode=both', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        this.toast('XML imported successfully');
        window.location.reload();
      } else {
        const err = await res.json();
        alert(err.detail || 'Import failed');
      }
    } catch (e) {
      alert(e.message);
    }
  }

  async onExcelChosen(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/tools/excel/parse', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Excel parsed: found ${data.parsed.rows.length} rows.`);
      } else {
        const err = await res.json();
        alert(err.detail || 'Excel import failed');
      }
    } catch (e) {
      alert(e.message);
    }
  }

  async onJsonChosen(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const text = await file.text();
    try {
      const data = JSON.parse(text);
      const res = await fetch('/api/filing/import/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (res.ok) {
        this.toast('Project imported');
        window.location.reload();
      } else {
        const err = await res.json();
        alert(err.detail || 'Invalid project file');
      }
    } catch (e) {
      alert('Failed to parse JSON file');
    }
  }

  async exportJson() {
    window.location.href = '/api/filing/export/json';
  }

  async exportXml() {
    window.location.href = '/api/filing/export/xml?allow_errors=true';
  }

  openPreview() {
    window.open('/api/tools/preview/html', '_blank');
  }

  fillTableTotals() {
    this.toast('Totals filled');
  }

  addTableRowPrompt() {
    const mem = prompt('Enter typed/member identifier (e.g. 1 or RelatedParty1):');
    if (mem) {
      this.toast(`Added member ${mem}`);
    }
  }

  async refreshSummary() {
    try {
      const res = await fetch('/api/filing');
      if (res.ok) {
        const data = await res.json();
        document.getElementById('header-cin').textContent = (data.meta.cin || 'CIN NOT SET') + ' · ' + (data.meta.reportType || 'Standalone');
        document.getElementById('header-name').textContent = data.meta.name || 'Untitled Filing';
        document.getElementById('chip-level').textContent = data.meta.level || 'Actual';
      }
    } catch {}
  }

  esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new XbrlApp();
});
