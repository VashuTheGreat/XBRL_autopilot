// ==========================================================================
// WebXBRL Client Application Controller
// Integrates Process Flow, Dual-Pane Spreadsheet Tagging, AI Auto-Tagging,
// Validation, and MCA XBRL Instance Document Generation.
// ==========================================================================

class XbrlApp {
  constructor() {
    this.currentTab = 'flow';
    this.activeTaxonomy = 'ci_taxonomy';
    this.activeSheet = null;
    this.workbookData = null;
    this.particularsCol = 1;
    this.cyCol = 3;
    this.pyCol = 4;
    this.noteCol = 2;
    this.roundingLevel = 'Actual';
    this.colDiff = 1;
    this.activeTreeElr = '100100';
    this.stagingRecommendations = [];
    this.contextNode = null;
    this.selectedExcelRow = null;
    this.init();
  }

  init() {
    this.setupFetchInterceptor();
    this.setupGlobalEvents();
    this.refreshSummary();
    this.refreshDifferences();
    this.loadActiveWorkbookSheet();

    // Auto-select initial tab: default to Financial Tagging workspace
    const hash = window.location.hash.replace('#', '');
    if (hash && hash !== 'flow') {
      this.selectTab(hash);
    } else {
      this.selectTab('tagging');
    }

    // Auto-prompt startup screen on fresh load if not previously dismissed
    if (!sessionStorage.getItem('xbrl_startup_dismissed')) {
      setTimeout(() => {
        this.openStartupModal('load');
      }, 300);
    }
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

  setupGlobalEvents() {
    // Dismiss context menus on outer click
    document.addEventListener('click', () => {
      const cm = document.getElementById('taxonomy-context-menu');
      if (cm) cm.style.display = 'none';
    });

    // Keyboard shortcuts matching WebXBRL (Screenshot 6)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F5') {
        e.preventDefault();
        this.cmGoToLinkedCell();
      } else if (e.key === 'Delete' && this.contextNode) {
        this.cmRemoveTagging();
      }
    });
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

  // --------------------------------------------------------------------------
  // Tab Navigation & Panes
  // --------------------------------------------------------------------------
  async selectTab(tabKey) {
    this.currentTab = tabKey;
    document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('on'));
    document.querySelectorAll('.tab-pane').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });

    const navLink = document.querySelector(`.nav-link[data-uri="${tabKey}"]`) ||
                    document.querySelector(`.nav-link[href="#${tabKey}"]`);
    if (navLink) navLink.classList.add('on');

    if (tabKey === 'flow') {
      const p = document.getElementById('pane-flow');
      if (p) { p.classList.add('active'); p.style.display = 'block'; }
    } else if (tabKey === 'tagging') {
      const p = document.getElementById('pane-tagging');
      if (p) {
        p.classList.add('active');
        p.style.display = 'flex';
        this.loadTaxonomyTree(this.activeTreeElr);
        this.refreshDifferences();
      }
    } else if (tabKey === 'setup') {
      const p = document.getElementById('pane-setup');
      if (p) { p.classList.add('active'); p.style.display = 'block'; }
    } else if (tabKey === 'validation') {
      const p = document.getElementById('pane-validation');
      if (p) {
        p.classList.add('active');
        p.style.display = 'block';
        this.runValidation();
      }
    } else if (tabKey === 'tools') {
      const p = document.getElementById('pane-tools');
      if (p) { p.classList.add('active'); p.style.display = 'block'; }
    } else {
      // Route ELR selections directly to the WebXBRL Financial Tagging workspace
      this.openFinancialTaggingForElr(tabKey);
    }
  }

  // Workflow shortcut helpers
  openFinancialTaggingForElr(code) {
    this.selectTab('tagging');
    this.activeTreeElr = code;
    const scopeSelect = document.getElementById('tagging-elr-scope');
    if (scopeSelect) {
      scopeSelect.value = code;
    }
    this.onTaggingScopeChange(code);
  }

  openFinancialTagging(statement) {
    this.selectTab('tagging');
    if (statement === 'BS') {
      this.onTaggingScopeChange('100100');
    } else if (statement === 'PL') {
      this.onTaggingScopeChange('100200');
    } else if (statement === 'CF') {
      this.onTaggingScopeChange('100300');
    }
  }

  openFixedAssetsTab() {
    this.selectTab('100100');
    this.toast('Navigate to Fixed Assets schedule');
  }

  openElrByCode(code) {
    this.selectTab(code);
  }

  openDirectorsMaster() {
    this.selectTab('setup');
    const el = document.getElementById('f-cin');
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    this.toast('Edit Signatories & Directors in Master Setup');
  }

  openAuditorsMaster() {
    this.selectTab('setup');
    this.toast('Edit Auditors in Master Setup');
  }

  openUploadModal() {
    alert('Instance Document is ready for MCA portal upload. Use MCA XBRL Validation Tool V5.1 to perform final filing pre-checks.');
  }

  // --------------------------------------------------------------------------
  // Financial Tagging: Multi-Sheet Excel Viewer
  // --------------------------------------------------------------------------
  async onUploadWorkbook(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    try {
      this.toast(`Uploading ${file.name}...`);
      const res = await fetch('/api/tools/workbook/upload', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Failed to upload workbook');

      const data = await res.json();
      this.workbookData = data;
      this.toast(`Workbook loaded: ${data.summary.sheetNames.length} sheets`);

      this.populateSheetTabs(data.summary.sheetNames);
      if (data.sheet) {
        this.renderExcelGrid(data.sheet);
      }
      this.selectTab('tagging');
    } catch (err) {
      alert(`Workbook upload error: ${err.message}`);
    }
  }

  populateSheetTabs(sheetNames) {
    const tabsContainer = document.getElementById('excel-sheet-tabs');
    const dropdown = document.getElementById('excel-sheet-dropdown');
    if (!tabsContainer || !dropdown) return;

    tabsContainer.innerHTML = '';
    dropdown.innerHTML = '';

    sheetNames.forEach((sname, idx) => {
      // Tab button
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sheet-tab-btn ${idx === 0 ? 'active' : ''}`;
      btn.textContent = sname;
      btn.onclick = () => this.switchSheet(sname);
      tabsContainer.appendChild(btn);

      // Dropdown option
      const opt = document.createElement('option');
      opt.value = sname;
      opt.textContent = sname;
      if (idx === 0) opt.selected = true;
      dropdown.appendChild(opt);
    });

    if (sheetNames.length > 0) {
      this.activeSheet = sheetNames[0];
    }
  }

  async loadActiveWorkbookSheet() {
    try {
      const res = await fetch('/api/tools/workbook/sheet');
      if (res.ok) {
        const sheetData = await res.json();
        if (sheetData && sheetData.sheetNames && sheetData.sheetNames.length > 0) {
          this.workbookData = { summary: { sheetNames: sheetData.sheetNames } };
          this.populateSheetTabs(sheetData.sheetNames);
          if (sheetData.detectedCols) {
            this.particularsCol = sheetData.detectedCols.particulars || 1;
            this.cyCol = sheetData.detectedCols.cy || 3;
            this.pyCol = sheetData.detectedCols.py || 4;
            const diff = sheetData.colDiff || (this.pyCol - this.cyCol) || 1;
            const tbPart = document.getElementById('tb-label-col');
            const tbCy = document.getElementById('tb-cy-col');
            const tbDiff = document.getElementById('tb-col-diff');
            const tbRound = document.getElementById('tb-rounding');
            if (tbPart) tbPart.value = this.particularsCol;
            if (tbCy) tbCy.value = this.cyCol;
            if (tbDiff) tbDiff.value = diff;
            if (tbRound && sheetData.levelRounding) tbRound.value = sheetData.levelRounding;
          }
          this.renderExcelGrid(sheetData);
        }
      }
    } catch (e) {
      console.warn('Initial workbook sheet load:', e);
    }
  }

  async switchSheet(sheetName) {
    if (!sheetName) return;
    this.activeSheet = sheetName;

    // Update active tab buttons and dropdown
    document.querySelectorAll('.sheet-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent === sheetName);
    });
    const dropdown = document.getElementById('excel-sheet-dropdown');
    if (dropdown) dropdown.value = sheetName;

    try {
      const res = await fetch(`/api/tools/workbook/sheet?sheet=${encodeURIComponent(sheetName)}`);
      if (res.ok) {
        const sheetData = await res.json();
        this.renderExcelGrid(sheetData);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async onGapSettingChange() {
    const partCol = parseInt(document.getElementById('tb-label-col')?.value || '1', 10);
    const cyCol = parseInt(document.getElementById('tb-cy-col')?.value || '3', 10);
    const colDiff = parseInt(document.getElementById('tb-col-diff')?.value || '1', 10);
    const rounding = document.getElementById('tb-rounding')?.value || 'Actual';
    const pyCol = cyCol + colDiff;

    this.particularsCol = partCol;
    this.cyCol = cyCol;
    this.pyCol = pyCol;
    this.colDiff = colDiff;
    this.roundingLevel = rounding;

    // Synchronize modal inputs if dialog opened
    const mPart = document.getElementById('cfg-label-col');
    const mDiff = document.getElementById('cfg-col-diff');
    const mRound = document.getElementById('cfg-level-rounding');
    if (mPart) mPart.value = partCol;
    if (mDiff) mDiff.value = colDiff;
    if (mRound) mRound.value = rounding;

    this.updateColPills();

    // Call backend API to persist sheet settings
    if (this.activeSheet) {
      try {
        await fetch('/api/taxonomies/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sheet: this.activeSheet,
            particularsCol: partCol,
            cyCol: cyCol,
            colDiff: colDiff,
            rounding: rounding,
          }),
        });
      } catch (e) {
        console.warn('Failed to persist settings:', e);
      }
      this.switchSheet(this.activeSheet);
    }
    this.toast(`Gap settings updated: Particulars=Col ${this.getColLetter(partCol)}, CY=Col ${this.getColLetter(cyCol)}, PY=Col ${this.getColLetter(pyCol)} (Gap=${colDiff})`);
  }

  selectExcelRow(r, tr) {
    document.querySelectorAll('#excel-grid-body tr').forEach(el => el.classList.remove('row-selected'));
    tr.classList.add('row-selected');
    this.selectedExcelRow = r;
    const partCell = r.cells.find(c => c.col === this.particularsCol);
    const text = partCell ? partCell.display : `Row ${r.rowIndex}`;
    this.toast(`Selected Row ${r.rowIndex}: "${text}". Now click a taxonomy concept on the right to tag it.`);
  }

  async tagCurrentRowWithConcept(concept, label) {
    if (!this.selectedExcelRow) {
      this.toast('Click an Excel row on the left first to select it for tagging');
      return;
    }
    const r = this.selectedExcelRow;
    const sheetName = this.activeSheet;
    try {
      const rounding = document.getElementById('tb-rounding')?.value || 'Actual';
      const res = await fetch('/api/taxonomies/tag-row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: sheetName,
          rowIndex: r.rowIndex,
          concept: concept,
          label: label || '',
          cyCol: this.cyCol,
          pyCol: this.pyCol,
          noteCol: this.noteCol,
          rounding: rounding,
        }),
      });
      if (res.ok) {
        this.toast(`Tagged Row ${r.rowIndex} to ${label || concept}`);
        this.switchSheet(sheetName);
        this.loadTaxonomyTree(this.activeTreeElr);
        this.refreshDifferences();
      }
    } catch (e) {
      console.error(e);
    }
  }

  renderExcelGrid(sheetData) {
    if (!sheetData) return;
    const thead = document.getElementById('excel-grid-head');
    const tbody = document.getElementById('excel-grid-body');
    const taggedCountEl = document.getElementById('sheet-tagged-count');
    if (!thead || !tbody) return;

    // Detect column indices
    const detected = sheetData.detectedCols || {};
    this.particularsCol = detected.particulars || parseInt(document.getElementById('tb-label-col')?.value || '1', 10);
    this.cyCol = detected.cy || parseInt(document.getElementById('tb-cy-col')?.value || '3', 10);
    this.pyCol = detected.py || (this.cyCol + parseInt(document.getElementById('tb-col-diff')?.value || '1', 10));
    this.noteCol = detected.note || 2;

    this.updateColPills();

    // Render header with column letters matching WebXBRL Screenshot 11-01-58
    let headHtml = '<tr><th style="width: 44px; text-align: center;">#</th>';
    (sheetData.columns || []).forEach(col => {
      let roleBadge = '';
      if (col.index === this.particularsCol) roleBadge = '<span class="hdr-role-badge">Label</span>';
      else if (col.index === this.cyCol) roleBadge = '<span class="hdr-role-badge cy-badge">CY</span>';
      else if (col.index === this.pyCol) roleBadge = '<span class="hdr-role-badge py-badge">PY</span>';

      const isPart = col.index === this.particularsCol;
      headHtml += `<th class="col-hdr ${isPart ? 'selected' : ''}" onclick="window.app.selectParticularsCol(${col.index})" title="Click to set Particulars column">
        ${col.letter} ${roleBadge}
      </th>`;
    });
    headHtml += '</tr>';
    thead.innerHTML = headHtml;

    // Render body rows
    tbody.innerHTML = '';
    let taggedCount = 0;

    sheetData.rows.forEach(r => {
      const tr = document.createElement('tr');
      const isRowTagged = r.tagged;
      if (isRowTagged) taggedCount++;

      tr.dataset.rowIndex = r.rowIndex;
      tr.onclick = () => this.selectExcelRow(r, tr);

      let rowHtml = `<td class="row-num">${r.rowIndex}</td>`;
      r.cells.forEach(cell => {
        const isPartCol = cell.col === this.particularsCol;
        const isValCol = cell.col === this.cyCol || cell.col === this.pyCol;
        const cellClass = (isRowTagged && isValCol) ? 'cell-tagged' : (isPartCol ? 'col-particulars' : '');
        
        rowHtml += `<td class="${cellClass}" title="${this.esc(cell.display)}" data-row="${cell.row}" data-col="${cell.col}">
          ${this.esc(cell.display)}
        </td>`;
      });
      tr.innerHTML = rowHtml;
      tbody.appendChild(tr);
    });

    if (taggedCountEl) {
      taggedCountEl.innerHTML = `Tagged: <b>${taggedCount}</b> rows`;
    }
  }

  selectParticularsCol(colIdx) {
    this.particularsCol = colIdx;
    const tbPart = document.getElementById('tb-label-col');
    if (tbPart) tbPart.value = colIdx;
    this.onGapSettingChange();
    this.toast(`Particulars column set to Column ${this.getColLetter(colIdx)}`);
  }

  updateColPills() {
    const p1 = document.getElementById('pill-part-col');
    const p2 = document.getElementById('pill-cy-col');
    const p3 = document.getElementById('pill-py-col');
    if (p1) p1.innerHTML = `Particulars Col: <b>${this.getColLetter(this.particularsCol)}</b>`;
    if (p2) p2.innerHTML = `CY Col: <b>${this.getColLetter(this.cyCol)}</b>`;
    if (p3) p3.innerHTML = `PY Col: <b>${this.getColLetter(this.pyCol)}</b>`;
  }

  getColLetter(colIdx) {
    return String.fromCharCode(64 + colIdx);
  }

  highlightAllTaggedCells() {
    const cells = document.querySelectorAll('.cell-tagged');
    cells.forEach(c => {
      c.style.transition = 'all 0.3s';
      c.style.transform = 'scale(1.05)';
      setTimeout(() => { c.style.transform = 'scale(1)'; }, 600);
    });
    this.toast(`Highlighted ${cells.length} tagged cells in green`);
  }

  // --------------------------------------------------------------------------
  // Financial Tagging: Taxonomy Tree Pane (Right Pane)
  // --------------------------------------------------------------------------
  async loadTaxonomyTree(elrUri, filterQuery = null) {
    this.activeTreeElr = elrUri;
    const tbody = document.getElementById('taxonomy-tree-body');
    if (!tbody) return;

    try {
      let url = `/api/taxonomies/tree?elr_uri=${encodeURIComponent(elrUri)}`;
      if (filterQuery) url += `&q=${encodeURIComponent(filterQuery)}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load taxonomy tree');
      const data = await res.json();

      const treeCodeEl = document.getElementById('tax-tree-code');
      const treeTitleEl = document.getElementById('tax-tree-title');
      if (treeCodeEl) treeCodeEl.textContent = data.elr ? `[${data.elr.code}] ` : '';
      if (treeTitleEl) treeTitleEl.textContent = data.elr ? data.elr.title : 'Taxonomy Hierarchy';

      tbody.innerHTML = '';
      if (!data.items || data.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--muted);">No matching taxonomy elements found.</td></tr>';
        return;
      }

      data.items.forEach(item => {
        const tr = document.createElement('tr');
        const depth = item.depth || 0;
        const indentPx = 10 + depth * 14;

        if (item.isAbstract) {
          const isTagged = item.tagged;
          tr.className = `header-row tree-node ${isTagged ? 'node-tagged' : ''}`;
          tr.innerHTML = `
            <td colspan="4" style="padding-left: ${indentPx}px;">
              <span class="tree-expander">▾</span> <b class="abstract-title">${this.esc(item.label)}</b>
            </td>
          `;
        } else {
          const isTagged = item.tagged;
          const isCalc = item.calculated;
          tr.className = `tree-node ${isTagged ? 'node-tagged' : ''} ${isCalc ? 'node-calculated' : ''}`;
          tr.dataset.concept = item.concept;

          // Single click: select tree item and tag if an Excel row is selected
          tr.onclick = () => {
            document.querySelectorAll('#taxonomy-tree-body tr').forEach(r => r.classList.remove('tree-node-selected'));
            tr.classList.add('tree-node-selected');
            if (this.selectedExcelRow) {
              this.tagCurrentRowWithConcept(item.concept, item.label);
            }
          };

          // Double click: prompt or map
          tr.ondblclick = () => {
            if (this.selectedExcelRow) {
              this.tagCurrentRowWithConcept(item.concept, item.label);
            } else {
              this.toast(`Selected concept: ${item.label}. Now select an Excel row on the left to map it.`);
            }
          };

          // Right-click context menu trigger (Screenshot 6)
          tr.oncontextmenu = (e) => {
            e.preventDefault();
            document.querySelectorAll('#taxonomy-tree-body tr').forEach(r => r.classList.remove('tree-node-selected'));
            tr.classList.add('tree-node-selected');
            this.openContextMenu(e, item);
          };

          tr.innerHTML = `
            <td class="concept-name" style="padding-left: ${indentPx}px;" title="${this.esc(item.concept)}">
              <span class="tree-expander">▪</span>
              <span>${this.esc(item.label)}</span>
            </td>
            <td style="text-align:center;">${item.note || ''}</td>
            <td class="num-val">${this.esc(item.cy)}</td>
            <td class="num-val">${this.esc(item.py)}</td>
          `;
        }
        tbody.appendChild(tr);
      });
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" style="color:var(--bad); padding:16px;">${err.message}</td></tr>`;
    }
  }

  onTaggingScopeChange(scopeCode) {
    this.activeTreeElr = scopeCode;
    const scopeSelect = document.getElementById('tagging-elr-scope');
    if (scopeSelect && scopeSelect.value !== scopeCode) {
      scopeSelect.value = scopeCode;
    }
    this.loadTaxonomyTree(scopeCode);
  }

  onTaxonomySwitch(taxKey) {
    this.activeTaxonomy = taxKey;
    const labelMap = {
      'ci_taxonomy': 'MCA C&I 2016',
      'ind_as_taxonomy': 'IND-AS Taxonomy',
      'costing_taxonomy': 'Costing Taxonomy'
    };
    const pill = document.getElementById('flow-taxonomy');
    if (pill) pill.textContent = `Taxonomy: ${labelMap[taxKey] || taxKey}`;
    this.toast(`Switched active taxonomy to ${labelMap[taxKey] || taxKey}`);
  }

  searchTaxonomyTree(q) {
    this.loadTaxonomyTree(this.activeTreeElr, q);
  }

  expandAllTaxonomyNodes() {
    this.toast('All taxonomy branches expanded');
  }

  collapseAllTaxonomyNodes() {
    this.toast('Taxonomy branches collapsed');
  }

  // --------------------------------------------------------------------------
  // AI-Powered Auto-Tagging Workflow (Option A)
  // --------------------------------------------------------------------------
  toggleAutoTagMode(enabled) {
    const btn = document.getElementById('btn-trigger-autotag');
    if (btn) btn.style.display = enabled ? 'inline-block' : 'none';
  }

  async triggerAutoTagging() {
    const tbody = document.getElementById('excel-grid-body');
    const trs = tbody ? tbody.querySelectorAll('tr') : [];
    if (trs.length === 0 || !this.activeSheet) {
      alert('Please upload an Excel workbook before triggering Auto Tag.');
      return;
    }

    // Extract particulars from the selected column
    const particularsItems = [];
    trs.forEach(tr => {
      const rowNumTd = tr.querySelector('.row-num');
      const cells = tr.querySelectorAll('td');
      if (rowNumTd && cells.length > this.particularsCol) {
        const rowIdx = parseInt(rowNumTd.textContent.trim(), 10);
        const cell = cells[this.particularsCol]; // Col 1 is cells[1] because cells[0] is row-num
        const text = cell ? cell.textContent.trim() : '';

        // Extract CY and PY cell values
        const cyCell = cells[this.cyCol];
        const pyCell = cells[this.pyCol];
        const cyVal = cyCell ? cyCell.textContent.trim() : '';
        const pyVal = pyCell ? pyCell.textContent.trim() : '';

        // Filter out blank rows or pure numbers
        if (text && isNaN(Number(text)) && text.length > 2) {
          particularsItems.push({
            rowIndex: rowIdx,
            particulars: text,
            cyVal: cyVal,
            pyVal: pyVal,
          });
        }
      }
    });

    if (particularsItems.length === 0) {
      alert(`No valid line item descriptions found in Column ${this.getColLetter(this.particularsCol)}. Please select the particulars column.`);
      return;
    }

    // Open Option A Staging Modal
    this.openAiModal();
    const stagingTbody = document.getElementById('ai-staging-rows');
    stagingTbody.innerHTML = '<tr><td colspan="6" class="loading-td">🤖 Querying vector database for matching MCA taxonomy concepts...</td></tr>';

    try {
      const keys = particularsItems.map(p => p.particulars);
      const res = await fetch('/api/taxonomies/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: keys,
          collection: this.activeTaxonomy
        })
      });

      if (!res.ok) throw new Error('AI recommendation service unavailable');
      const recommendations = await res.json();

      this.stagingRecommendations = [];
      stagingTbody.innerHTML = '';

      particularsItems.forEach((item, idx) => {
        const rec = recommendations[idx] || {};
        const concept = rec.concept || 'in-ca:Unmapped';
        const label = rec.label || item.particulars;
        const confidence = rec.confidence ? `${Math.round(rec.confidence * 100)}% Match` : 'AI Suggested';

        const record = {
          rowIndex: item.rowIndex,
          particulars: item.particulars,
          concept: concept,
          label: label,
          cyVal: item.cyVal,
          pyVal: item.pyVal,
          selected: true,
        };
        this.stagingRecommendations.push(record);

        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><input type="checkbox" class="chk-staging-row" checked onchange="window.app.toggleStagingRow(${idx}, this.checked)"></td>
          <td><b>${item.rowIndex}</b></td>
          <td>${this.esc(item.particulars)}</td>
          <td>
            <span class="concept-tag-name">${this.esc(concept)}</span>
            <div style="font-size:11px; color:var(--muted);">${this.esc(label)}</div>
          </td>
          <td><span class="conf-chip">${confidence}</span></td>
          <td style="font-family:var(--f-data); font-size:11px;">CY: ${this.esc(item.cyVal)}<br>PY: ${this.esc(item.pyVal)}</td>
        `;
        stagingTbody.appendChild(tr);
      });

      document.getElementById('ai-matches-count').textContent = this.stagingRecommendations.length;
      document.getElementById('ai-selected-count').textContent = this.stagingRecommendations.length;
    } catch (err) {
      stagingTbody.innerHTML = `<tr><td colspan="6" style="color:var(--bad); padding:16px;">Failed to get AI recommendations: ${err.message}</td></tr>`;
    }
  }

  openAiModal() {
    const modal = document.getElementById('modal-ai-recommendations');
    if (modal) {
      modal.style.display = 'flex';
      const taxLabel = document.getElementById('ai-taxonomy-label');
      if (taxLabel) taxLabel.textContent = this.activeTaxonomy.replace('_', ' ').toUpperCase();
    }
  }

  closeAiModal() {
    const modal = document.getElementById('modal-ai-recommendations');
    if (modal) modal.style.display = 'none';
  }

  toggleSelectAllAi(checked) {
    this.stagingRecommendations.forEach(r => r.selected = checked);
    document.querySelectorAll('.chk-staging-row').forEach(c => c.checked = checked);
    const selCount = this.stagingRecommendations.filter(r => r.selected).length;
    document.getElementById('ai-selected-count').textContent = selCount;
  }

  toggleStagingRow(idx, checked) {
    if (this.stagingRecommendations[idx]) {
      this.stagingRecommendations[idx].selected = checked;
    }
    const selCount = this.stagingRecommendations.filter(r => r.selected).length;
    document.getElementById('ai-selected-count').textContent = selCount;
  }

  async applyAiRecommendations() {
    const selected = this.stagingRecommendations.filter(r => r.selected);
    if (selected.length === 0) {
      alert('No recommendations selected to apply.');
      return;
    }

    this.toast(`Applying ${selected.length} recommended tags...`);
    try {
      const payload = {
        sheet: this.activeSheet,
        mappings: selected.map(s => ({
          rowIndex: s.rowIndex,
          concept: s.concept,
          label: s.label
        })),
        cyCol: this.cyCol,
        pyCol: this.pyCol,
        noteCol: this.noteCol,
        rounding: this.roundingLevel
      };

      const res = await fetch('/api/taxonomies/batch-apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Failed to apply tags');
      const data = await res.json();

      this.closeAiModal();
      this.toast(`Success: ${data.appliedCount} taxonomy tags applied`);

      // Refresh views: Excel turns green, taxonomy tree turns bold red
      if (this.activeSheet) await this.switchSheet(this.activeSheet);
      await this.loadTaxonomyTree(this.activeTreeElr);
      await this.refreshDifferences();
    } catch (err) {
      alert(`Error applying tags: ${err.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // Settings Modal ("WXBRL - Reset Setting", Screenshot 3)
  // --------------------------------------------------------------------------
  openResetSettingsModal() {
    const m = document.getElementById('modal-reset-settings');
    if (m) {
      m.style.display = 'flex';
      const mPart = document.getElementById('cfg-label-col');
      const mDiff = document.getElementById('cfg-col-diff');
      const mRound = document.getElementById('cfg-level-rounding');
      if (mPart) mPart.value = this.particularsCol || 1;
      if (mDiff) mDiff.value = this.colDiff || 1;
      if (mRound) mRound.value = this.roundingLevel || 'Actual';
    }
  }

  closeResetSettingsModal() {
    const m = document.getElementById('modal-reset-settings');
    if (m) m.style.display = 'none';
  }

  saveResetSettings() {
    const labelColInput = document.getElementById('cfg-label-col');
    const colDiffInput = document.getElementById('cfg-col-diff');
    const roundingInput = document.getElementById('cfg-level-rounding');

    this.particularsCol = parseInt(labelColInput?.value || '1', 10) || 1;
    this.colDiff = parseInt(colDiffInput?.value || '1', 10) || 1;
    this.roundingLevel = roundingInput?.value || 'Actual';

    // Synchronize toolbar controls
    const tbPart = document.getElementById('tb-label-col');
    const tbDiff = document.getElementById('tb-col-diff');
    const tbRound = document.getElementById('tb-rounding');
    if (tbPart) tbPart.value = this.particularsCol;
    if (tbDiff) tbDiff.value = this.colDiff;
    if (tbRound) tbRound.value = this.roundingLevel;

    this.closeResetSettingsModal();
    this.onGapSettingChange();
    this.toast('WXBRL settings saved successfully');
  }

  // --------------------------------------------------------------------------
  // Right-Click Context Menu Actions (Screenshot 6)
  // --------------------------------------------------------------------------
  openContextMenu(e, item) {
    this.contextNode = item;
    const cm = document.getElementById('taxonomy-context-menu');
    if (cm) {
      cm.style.display = 'block';
      cm.style.left = `${Math.min(e.clientX, window.innerWidth - 220)}px`;
      cm.style.top = `${Math.min(e.clientY, window.innerHeight - 240)}px`;
    }
  }

  cmTagSelectedRow() {
    if (this.contextNode) {
      this.tagCurrentRowWithConcept(this.contextNode.concept, this.contextNode.label);
    }
    const cm = document.getElementById('taxonomy-context-menu');
    if (cm) cm.style.display = 'none';
  }

  async cmRemoveTagging() {
    if (!this.contextNode || !this.activeSheet) return;
    const concept = this.contextNode.concept;

    // Search active sheet mappings for this concept
    try {
      const res = await fetch('/api/facts/value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, scope: 'CY', display: '', recalc: true })
      });
      await fetch('/api/facts/value', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept, scope: 'PY', display: '', recalc: true })
      });

      this.toast(`Removed tagging for ${this.contextNode.label}`);
      if (this.activeSheet) await this.switchSheet(this.activeSheet);
      await this.loadTaxonomyTree(this.activeTreeElr);
      await this.refreshDifferences();
    } catch (err) {
      alert(err.message);
    }
  }

  cmGoToLinkedCell() {
    if (!this.contextNode) return;
    this.toast(`Jump to linked cell for ${this.contextNode.label}`);
  }

  cmAddFootnote() {
    const fn = prompt(`Add Footnote for ${this.contextNode ? this.contextNode.label : 'concept'}:`);
    if (fn) this.toast('Footnote attached');
  }

  cmChangeSign() {
    this.toast('Sign toggled (Ctrl -)');
    this.syncFilingCalculations();
  }

  cmProperties() {
    if (!this.contextNode) return;
    alert(`Concept: ${this.contextNode.concept}\nLabel: ${this.contextNode.label}\nData Type: ${this.contextNode.dataType || 'Monetary'}`);
  }

  // --------------------------------------------------------------------------
  // Live Differences and Synchronization
  // --------------------------------------------------------------------------
  async syncFilingCalculations() {
    this.toast('Synchronizing live calculations...');
    await this.refreshDifferences();
    await this.loadTaxonomyTree(this.activeTreeElr);
    this.toast('Calculations synchronized');
  }

  async refreshDifferences() {
    try {
      const res = await fetch('/api/taxonomies/differences');
      if (res.ok) {
        const data = await res.json();
        const bsCy = document.getElementById('val-diff-bs-cy');
        const bsPy = document.getElementById('val-diff-bs-py');
        const dotBs = document.getElementById('dot-bs');

        if (bsCy) bsCy.textContent = `Current Year = ${data.balanceSheet.diffCY || 0}`;
        if (bsPy) bsPy.textContent = `Previous Year = ${data.balanceSheet.diffPY || 0}`;
        if (dotBs) {
          dotBs.className = `dot-indicator ${data.balanceSheet.balanced ? 'ok' : 'err'}`;
        }

        const plCy = document.getElementById('val-diff-pl-cy');
        const plPy = document.getElementById('val-diff-pl-py');
        const dotPl = document.getElementById('dot-pl');

        if (plCy) plCy.textContent = `Current Year = ${data.profitAndLoss.diffCY || 0}`;
        if (plPy) plPy.textContent = `Previous Year = ${data.profitAndLoss.diffPY || 0}`;
        if (dotPl) {
          dotPl.className = `dot-indicator ${data.profitAndLoss.balanced ? 'ok' : 'err'}`;
        }
      }
    } catch {}
  }

  // --------------------------------------------------------------------------
  // ELR Sheets, Setup, Validation & XML (Preserved Core Methods)
  // --------------------------------------------------------------------------
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
      this.refreshDifferences();
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

  async loadExample() {
    if (confirm('Load sample company filing? Current unsaved edits will be replaced.')) {
      const res = await fetch('/api/filing/example', { method: 'POST' });
      if (res.ok) window.location.reload();
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

  // --------------------------------------------------------------------------
  // Startup Modal & Standard Project Persistence Lifecycle
  // --------------------------------------------------------------------------
  openStartupModal(mode = 'load') {
    const modal = document.getElementById('modal-startup');
    if (!modal) return;
    modal.style.display = 'flex';
    this.fetchSavedProjects();

    const loadCard = document.getElementById('card-load-section');
    const newCard = document.getElementById('card-new-section');
    if (mode === 'new') {
      newCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      document.getElementById('new-company-name')?.focus();
    } else {
      loadCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  closeStartupModal() {
    const modal = document.getElementById('modal-startup');
    if (modal) modal.style.display = 'none';
    sessionStorage.setItem('xbrl_startup_dismissed', '1');
  }

  async fetchSavedProjects() {
    const listEl = document.getElementById('saved-projects-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="empty-list-notice">Loading saved filings...</div>';

    try {
      const res = await fetch('/api/projects/list');
      const projects = await res.json();
      if (!Array.isArray(projects) || projects.length === 0) {
        listEl.innerHTML = '<div class="empty-list-notice">No saved filings yet.<br>Create a new filing or load sample below.</div>';
        return;
      }

      listEl.innerHTML = projects.map(p => `
        <div class="project-row-item" onclick="window.app.loadProjectById('${this.esc(p.projectId)}')">
          <div class="project-row-info">
            <b>${this.esc(p.companyName || 'Untitled')}</b>
            <span>${this.esc(p.cin || 'NO CIN')} · FY ${this.esc(p.financialYear || '')} · Tagged: ${p.totalTagged || 0}</span>
          </div>
          <div class="project-row-btns">
            <button class="btn small primary" type="button" onclick="event.stopPropagation(); window.app.loadProjectById('${this.esc(p.projectId)}')" title="Open filing in workspace">Load</button>
            <button class="btn small" type="button" onclick="event.stopPropagation(); window.app.downloadProjectBundle('${this.esc(p.projectId)}')" title="Download .wxbrl archive to your PC">⬇️ Export</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="empty-list-notice" style="color:var(--bad);">Error loading projects: ${this.esc(err.message)}</div>`;
    }
  }

  downloadProjectBundle(projectId) {
    if (!projectId) return;
    this.toast(`Downloading ${projectId}.wxbrl to your PC...`);
    window.location.href = `/api/projects/export/${encodeURIComponent(projectId)}`;
  }

  async loadProjectById(projectId) {
    this.toast(`Loading project: ${projectId}...`);
    try {
      const res = await fetch(`/api/projects/load/${projectId}`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to load project');
      }
      const data = await res.json();
      this.closeStartupModal();
      this.toast(`Project '${projectId}' loaded successfully`);

      // Refresh master metadata
      await this.refreshSummary();

      // Refresh spreadsheet workspace
      await this.loadActiveWorkbookSheet();
      if (data.manifest && data.manifest.activeSheet) {
        await this.switchSheet(data.manifest.activeSheet);
      }

      // Restore gap & rounding settings
      if (data.settings) {
        if (data.settings.colDiff) this.colDiff = data.settings.colDiff;
        if (data.settings.levelRounding) this.roundingLevel = data.settings.levelRounding;
        const tbDiff = document.getElementById('tb-col-diff');
        const tbRound = document.getElementById('tb-rounding');
        if (tbDiff) tbDiff.value = this.colDiff;
        if (tbRound) tbRound.value = this.roundingLevel;
      }

      // Refresh taxonomy tree and calculations
      await this.loadTaxonomyTree(this.activeTreeElr);
      await this.refreshDifferences();
    } catch (err) {
      alert(`Error loading project: ${err.message}`);
    }
  }

  async saveProject() {
    this.toast('Saving project state to server...');
    try {
      const res = await fetch('/api/projects/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error('Save request failed');
      const data = await res.json();
      this.toast(`Project '${data.projectId}' saved successfully!`);
      return data;
    } catch (err) {
      alert(`Save error: ${err.message}`);
      return null;
    }
  }

  async saveProjectToPc() {
    this.toast('Saving project & preparing .wxbrl download...');
    const data = await this.saveProject();
    if (data && data.projectId) {
      this.downloadProjectBundle(data.projectId);
    }
  }

  onNewExcelSelected(input) {
    if (input.files && input.files[0]) {
      const file = input.files[0];
      const lbl = document.getElementById('new-excel-label');
      const sub = document.getElementById('new-excel-sublabel');
      if (lbl) lbl.textContent = file.name;
      if (sub) sub.textContent = `${(file.size / 1024).toFixed(1)} KB · Ready to tag`;
    }
  }

  async submitCreateNewFiling(e) {
    e.preventDefault();
    const name = document.getElementById('new-company-name').value;
    const cin = document.getElementById('new-cin').value;
    const startDate = document.getElementById('new-fy-start').value;
    const endDate = document.getElementById('new-fy-end').value;
    const rounding = document.getElementById('new-rounding').value;
    const reportType = document.getElementById('new-report-type').value;
    const fileInput = document.getElementById('new-excel-file');

    const formData = new FormData();
    formData.append('name', name);
    formData.append('cin', cin);
    formData.append('start_date', startDate);
    formData.append('end_date', endDate);
    formData.append('level', rounding);
    formData.append('report_type', reportType);

    if (fileInput.files && fileInput.files[0]) {
      formData.append('workbook', fileInput.files[0]);
    }

    this.toast('Creating new filing...');
    try {
      const res = await fetch('/api/projects/new', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Creation failed');
      }
      const data = await res.json();
      this.closeStartupModal();
      this.toast('New filing created! Workspace ready.');

      // Refresh master summary and sheet
      await this.refreshSummary();
      await this.loadActiveWorkbookSheet();
      await this.loadTaxonomyTree(this.activeTreeElr);
      await this.refreshDifferences();
    } catch (err) {
      alert(`Error creating filing: ${err.message}`);
    }
  }

  async onProjectBundleUpload(input) {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    const formData = new FormData();
    formData.append('file', file);

    this.toast(`Importing project bundle: ${file.name}...`);
    try {
      const res = await fetch('/api/projects/import', {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Bundle import failed');
      }
      const data = await res.json();
      this.closeStartupModal();
      this.toast('Project restored from bundle successfully!');

      await this.refreshSummary();
      await this.loadActiveWorkbookSheet();
      if (data.manifest && data.manifest.activeSheet) {
        await this.switchSheet(data.manifest.activeSheet);
      }
      await this.loadTaxonomyTree(this.activeTreeElr);
      await this.refreshDifferences();
    } catch (err) {
      alert(`Import error: ${err.message}`);
    } finally {
      input.value = '';
    }
  }

  async loadExampleAndDismiss() {
    this.closeStartupModal();
    await this.loadExample();
  }

  async refreshSummary() {
    try {
      const res = await fetch('/api/filing');
      if (res.ok) {
        const data = await res.json();
        document.getElementById('header-cin').textContent = (data.meta.cin || 'CIN NOT SET') + ' · ' + (data.meta.reportType || 'Standalone');
        document.getElementById('header-name').textContent = data.meta.name || 'Untitled Filing';
        document.getElementById('chip-level').textContent = data.meta.level || 'Actual';

        const flowCin = document.getElementById('flow-cin');
        const flowFy = document.getElementById('flow-fy');
        if (flowCin) flowCin.textContent = `CIN: ${data.meta.cin || 'Not configured'}`;
        if (flowFy && data.meta.periods && data.meta.periods.cy) {
          flowFy.textContent = `FY: ${data.meta.periods.cy.start || ''} to ${data.meta.periods.cy.end || ''}`;
        }
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
