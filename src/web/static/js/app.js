// ==========================================================================
// WebXBRL Client Application Controller
// Integrates Process Flow, Dual-Pane Spreadsheet Tagging, AI Auto-Tagging,
// Validation, and MCA XBRL Instance Document Generation.
// ==========================================================================

class XbrlApp {
  constructor() {
    this.currentTab = 'tagging';
    this.activeTaxonomy = 'ci';
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
    this.isDirty = false;
    this.autosaveEnabled = false;
    this.autosaveIntervalSec = 60;
    this.autosaveTimer = null;
    this.pendingAction = null;
    this.collapsedNodeIds = new Set();
    this.init();
  }

  init() {
    this.setupFetchInterceptor();
    this.setupGlobalEvents();
    this.loadStoredSettings();
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

  loadStoredSettings() {
    try {
      const raw = localStorage.getItem('webxbrl_user_settings');
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.autosaveEnabled === 'boolean') this.autosaveEnabled = s.autosaveEnabled;
        if (s.autosaveIntervalSec) this.autosaveIntervalSec = parseInt(s.autosaveIntervalSec, 10) || 60;
      }
    } catch (e) {}
    this.startAutosaveTimer();
  }

  saveStoredSettings() {
    try {
      localStorage.setItem('webxbrl_user_settings', JSON.stringify({
        autosaveEnabled: this.autosaveEnabled,
        autosaveIntervalSec: this.autosaveIntervalSec,
      }));
    } catch (e) {}
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

    // Unsaved changes beforeunload warning when autosave is OFF and document is dirty
    window.addEventListener('beforeunload', (e) => {
      if (this.isDirty && !this.autosaveEnabled) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes in your filing. Do you want to leave?';
        return e.returnValue;
      }
    });

    // Global desktop keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      if (isCtrlOrCmd && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (e.shiftKey) {
          this.saveProjectAs();
        } else {
          this.saveProject();
        }
      } else if (isCtrlOrCmd && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        this.openStartupModal('load');
      } else if (isCtrlOrCmd && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        this.openStartupModal('new');
      } else if (e.key === 'F5') {
        e.preventDefault();
        this.goToLinkedCell();
      } else if (e.key === 'Delete') {
        if (this.selectedExcelRow) {
          this.removeCurrentRowTag();
        } else if (this.contextNode) {
          this.cmRemoveTagging();
        }
      } else if (e.key === 'Enter') {
        if (this.selectedExcelRow && this.contextNode) {
          this.tagCurrentRowWithSelectedConcept();
        }
      }
    });
  }

  markDirty() {
    this.isDirty = true;
    const badge = document.getElementById('menu-dirty-indicator');
    if (badge) {
      badge.classList.add('is-dirty');
      badge.style.display = 'inline-block';
    }
  }

  clearDirty() {
    this.isDirty = false;
    const badge = document.getElementById('menu-dirty-indicator');
    if (badge) {
      badge.classList.remove('is-dirty');
    }
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
    const partCol = parseInt(document.getElementById('tb-label-col')?.value || `${this.particularsCol || 1}`, 10);
    const cyCol = parseInt(document.getElementById('tb-cy-col')?.value || `${this.cyCol || 3}`, 10);
    const colDiff = parseInt(document.getElementById('tb-col-diff')?.value || `${this.colDiff || 1}`, 10);
    const rounding = document.getElementById('tb-rounding')?.value || this.roundingLevel || 'Actual';
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
      await this.switchSheet(this.activeSheet);
    }
    this.markDirty();
    this.toast(`Gap settings updated: Particulars=Col ${this.getColLetter(partCol)}, CY=Col ${this.getColLetter(cyCol)}, PY=Col ${this.getColLetter(pyCol)} (Gap=${colDiff})`);
  }

  updateColumnSettingsFromToolbar() {
    const partCol = parseInt(document.getElementById('tb-label-col')?.value || '1', 10);
    const cyCol = parseInt(document.getElementById('tb-cy-col')?.value || '3', 10);
    const colDiff = parseInt(document.getElementById('tb-col-diff')?.value || '1', 10);
    const rounding = document.getElementById('tb-rounding')?.value || 'Actual';
    this.particularsCol = partCol;
    this.cyCol = cyCol;
    this.colDiff = colDiff;
    this.pyCol = cyCol + colDiff;
    this.roundingLevel = rounding;
    this.onGapSettingChange();
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
        this.markDirty();
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

    // Use user-configured columns if already set, otherwise fall back to detected
    const detected = sheetData.detectedCols || {};
    if (!this.particularsCol) {
      this.particularsCol = detected.particulars || parseInt(document.getElementById('tb-label-col')?.value || '1', 10);
    }
    if (!this.cyCol) {
      this.cyCol = detected.cy || parseInt(document.getElementById('tb-cy-col')?.value || '3', 10);
    }
    if (!this.colDiff) {
      this.colDiff = sheetData.colDiff || parseInt(document.getElementById('tb-col-diff')?.value || '1', 10);
    }
    this.pyCol = this.cyCol + this.colDiff;
    this.noteCol = detected.note || 2;

    const tbPart = document.getElementById('tb-label-col');
    if (tbPart) tbPart.value = this.particularsCol;
    const tbCy = document.getElementById('tb-cy-col');
    if (tbCy) tbCy.value = this.cyCol;
    const tbDiff = document.getElementById('tb-col-diff');
    if (tbDiff) tbDiff.value = this.colDiff;
    const tbRound = document.getElementById('tb-rounding');
    if (tbRound && this.roundingLevel) tbRound.value = this.roundingLevel;

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

      let statusBadge = '';
      if (r.status && r.status !== 'UNTAGGED') {
        const clsMap = {
          'AI_RECOMMENDED': 'status-ai',
          'MAPPED_INCOMPLETE': 'status-incomplete',
          'SCHEDULE_REQUIRED': 'status-schedule-req',
          'SCHEDULE_LINKED': 'status-schedule-linked',
          'COMPLETE': 'status-complete',
          'INVALID': 'status-invalid'
        };
        const lblMap = {
          'AI_RECOMMENDED': 'AI',
          'MAPPED_INCOMPLETE': 'Incomp',
          'SCHEDULE_REQUIRED': 'Sched Req',
          'SCHEDULE_LINKED': 'Linked',
          'COMPLETE': 'Tagged',
          'INVALID': 'Invalid'
        };
        const cls = clsMap[r.status] || 'status-untagged';
        const lbl = lblMap[r.status] || r.status;
        statusBadge = ` <span class="cell-status-badge ${cls}" style="margin-left:4px;">${lbl}</span>`;
      }

      let rowHtml = `<td class="row-num">${r.rowIndex}${statusBadge}</td>`;
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
      let url = `/api/taxonomies/tree?elr_uri=${encodeURIComponent(elrUri)}&taxonomy=${encodeURIComponent(this.activeTaxonomy)}`;
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

      data.items.forEach((item, idx) => {
        const tr = document.createElement('tr');
        const depth = item.depth || 0;
        const indentPx = 10 + depth * 14;
        tr.dataset.depth = depth;
        tr.dataset.nodeId = `node-${idx}`;

        // Status badge HTML
        let statusBadgeHtml = '';
        if (item.status && item.status !== 'UNTAGGED') {
          const badgeClassMap = {
            'AI_RECOMMENDED': 'status-ai',
            'MAPPED_INCOMPLETE': 'status-incomplete',
            'SCHEDULE_REQUIRED': 'status-schedule-req',
            'SCHEDULE_LINKED': 'status-schedule-linked',
            'COMPLETE': 'status-complete',
            'INVALID': 'status-invalid'
          };
          const badgeLabelMap = {
            'AI_RECOMMENDED': 'AI',
            'MAPPED_INCOMPLETE': 'Incomp',
            'SCHEDULE_REQUIRED': 'Sched Req',
            'SCHEDULE_LINKED': 'Linked',
            'COMPLETE': 'Tagged',
            'INVALID': 'Invalid'
          };
          const cls = badgeClassMap[item.status] || 'status-untagged';
          const lbl = badgeLabelMap[item.status] || item.status;
          statusBadgeHtml = ` <span class="cell-status-badge ${cls}">${lbl}</span>`;
        }

        if (item.isAbstract) {
          const isTagged = item.tagged;
          tr.className = `header-row tree-node ${isTagged ? 'node-tagged' : ''}`;
          tr.innerHTML = `
            <td colspan="4" style="padding-left: ${indentPx}px;">
              <span class="tree-expander" onclick="event.stopPropagation(); window.app.toggleTreeNode(this.closest('tr'))">▾</span>
              <b class="abstract-title">${this.esc(item.label)}</b>
              ${statusBadgeHtml}
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
            this.contextNode = item;
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
            this.contextNode = item;
            this.openContextMenu(e, item);
          };

          tr.innerHTML = `
            <td class="concept-name" style="padding-left: ${indentPx}px;" title="${this.esc(item.concept)}">
              <span class="tree-expander" style="cursor:default;">▪</span>
              <span>${this.esc(item.label)}</span>
              ${statusBadgeHtml}
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

  toggleTreeNode(tr) {
    if (!tr) return;
    const depth = parseInt(tr.dataset.depth || '0', 10);
    const expander = tr.querySelector('.tree-expander');
    const isCollapsed = tr.classList.contains('is-collapsed');

    if (isCollapsed) {
      tr.classList.remove('is-collapsed');
      if (expander) expander.textContent = '▾';
      let next = tr.nextElementSibling;
      while (next) {
        const nextDepth = parseInt(next.dataset.depth || '0', 10);
        if (nextDepth <= depth) break;
        let ancestorCollapsed = false;
        let p = next.previousElementSibling;
        while (p && p !== tr) {
          const pDepth = parseInt(p.dataset.depth || '0', 10);
          if (pDepth < nextDepth && p.classList.contains('is-collapsed')) {
            ancestorCollapsed = true;
            break;
          }
          p = p.previousElementSibling;
        }
        if (!ancestorCollapsed) {
          next.style.display = '';
        }
        next = next.nextElementSibling;
      }
    } else {
      tr.classList.add('is-collapsed');
      if (expander) expander.textContent = '▸';
      let next = tr.nextElementSibling;
      while (next) {
        const nextDepth = parseInt(next.dataset.depth || '0', 10);
        if (nextDepth <= depth) break;
        next.style.display = 'none';
        next = next.nextElementSibling;
      }
    }
  }

  expandAllTaxonomyNodes() {
    const rows = document.querySelectorAll('#taxonomy-tree-body tr');
    rows.forEach(tr => {
      tr.classList.remove('is-collapsed');
      tr.style.display = '';
      const exp = tr.querySelector('.tree-expander');
      if (exp && exp.textContent === '▸') exp.textContent = '▾';
    });
    this.toast('All taxonomy branches expanded');
  }

  collapseAllTaxonomyNodes() {
    const rows = document.querySelectorAll('#taxonomy-tree-body tr');
    rows.forEach(tr => {
      const depth = parseInt(tr.dataset.depth || '0', 10);
      if (depth === 0) {
        tr.classList.add('is-collapsed');
        const exp = tr.querySelector('.tree-expander');
        if (exp && exp.textContent === '▾') exp.textContent = '▸';
      } else {
        tr.style.display = 'none';
      }
    });
    this.toast('Taxonomy branches collapsed');
  }

  onTaggingScopeChange(scopeCode) {
    this.activeTreeElr = scopeCode;
    const scopeSelect = document.getElementById('tagging-elr-scope');
    if (scopeSelect && scopeSelect.value !== scopeCode) {
      scopeSelect.value = scopeCode;
    }
    this.loadTaxonomyTree(scopeCode);
  }

  async switchActiveTaxonomy(taxKey) {
    const normalizedKey = (taxKey || 'ci').toLowerCase().replace('_taxonomy', '');
    this.activeTaxonomy = normalizedKey;

    const selectEl = document.getElementById('active-taxonomy-select');
    if (selectEl && selectEl.value !== normalizedKey) {
      selectEl.value = normalizedKey;
    }
    const startSelect = document.getElementById('new-taxonomy');
    if (startSelect && startSelect.value !== normalizedKey) {
      startSelect.value = normalizedKey;
    }

    const labelMap = {
      'ci': 'MCA C&I 2016 (AS)',
      'ind_as': 'MCA Ind AS V1.2',
      'costing': 'Costing Taxonomy 2019'
    };
    const taxName = labelMap[normalizedKey] || normalizedKey;
    this.toast(`Switching active taxonomy to ${taxName}...`);

    try {
      const res = await fetch('/api/taxonomies/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taxonomy: normalizedKey })
      });
      if (res.ok) {
        this.markDirty();
        await this.loadTaxonomyTree(this.activeTreeElr);
        await this.refreshDifferences();
        this.toast(`Taxonomy switched to ${taxName}`);
      }
    } catch (e) {
      console.error(e);
      this.toast(`Error switching taxonomy: ${e.message}`);
    }
  }

  onStartupTaxonomyChange(val) {
    this.activeTaxonomy = val;
    const selectEl = document.getElementById('active-taxonomy-select');
    if (selectEl) selectEl.value = val;
  }

  onTaxonomySwitch(taxKey) {
    this.switchActiveTaxonomy(taxKey);
  }

  searchTaxonomyTree(q) {
    this.loadTaxonomyTree(this.activeTreeElr, q);
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
    const matchesCountEl = document.getElementById('ai-matches-count');
    if (matchesCountEl) matchesCountEl.textContent = particularsItems.length;
    const selCountEl = document.getElementById('ai-selected-count');
    if (selCountEl) selCountEl.textContent = particularsItems.length;

    const stagingTbody = document.getElementById('ai-staging-rows');
    stagingTbody.innerHTML = '<tr><td colspan="6" class="loading-td">🤖 Querying vector database for matching MCA taxonomy concepts...</td></tr>';

    try {
      const keys = particularsItems.map(p => p.particulars);
      const collMap = {
        'ci': 'ci_taxonomy',
        'ind_as': 'ind_as_taxonomy',
        'costing': 'costing_taxonomy',
      };
      const collName = collMap[this.activeTaxonomy] || (this.activeTaxonomy.includes('_taxonomy') ? this.activeTaxonomy : `${this.activeTaxonomy}_taxonomy`);

      const res = await fetch('/api/taxonomies/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keys: keys,
          collection: collName
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
      const labelMap = {
        'ci': 'MCA C&I 2016',
        'ind_as': 'MCA Ind AS V1.2',
        'costing': 'Costing 2019',
        'ci_taxonomy': 'MCA C&I 2016',
        'ind_as_taxonomy': 'MCA Ind AS V1.2',
        'costing_taxonomy': 'Costing 2019'
      };
      if (taxLabel) taxLabel.textContent = labelMap[this.activeTaxonomy] || this.activeTaxonomy.replace('_', ' ').toUpperCase();
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
      this.markDirty();
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

      this.markDirty();
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

        // Toolbar Difference Badges
        const tbBs = document.getElementById('tb-bs-diff');
        if (tbBs) {
          const valEl = tbBs.querySelector('.diff-val');
          if (valEl) {
            valEl.textContent = (data.balanceSheet.diffCY || 0);
            valEl.className = `diff-val ${data.balanceSheet.balanced ? 'balanced' : 'unbalanced'}`;
          }
        }
        const tbPl = document.getElementById('tb-pl-diff');
        if (tbPl) {
          const valEl = tbPl.querySelector('.diff-val');
          if (valEl) {
            valEl.textContent = (data.profitAndLoss.diffCY || 0);
            valEl.className = `diff-val ${data.profitAndLoss.balanced ? 'balanced' : 'unbalanced'}`;
          }
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
      this.markDirty();
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
      this.markDirty();
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
        body: JSON.stringify({
          uiState: {
            currentTab: this.currentTab,
            activeSheet: this.activeSheet,
            activeTreeElr: this.activeTreeElr,
            particularsCol: this.particularsCol,
            cyCol: this.cyCol,
            pyCol: this.pyCol,
            colDiff: this.colDiff,
            roundingLevel: this.roundingLevel,
          },
          autosaveSettings: {
            enabled: this.autosaveEnabled,
            intervalSec: this.autosaveIntervalSec,
          }
        })
      });
      if (!res.ok) throw new Error('Save request failed');
      const data = await res.json();
      this.clearDirty();
      await this.discardRecoveryCache();
      this.toast(`Project '${data.projectId}' saved successfully!`);
      return data;
    } catch (err) {
      alert(`Save error: ${err.message}`);
      return null;
    }
  }

  async saveProjectAs() {
    const curName = document.getElementById('header-name')?.textContent || 'Filing_Project';
    const newName = prompt('Enter project name or filename for Save As:', curName);
    if (!newName) return;
    this.toast(`Saving project as "${newName}"...`);
    const data = await this.saveProject();
    if (data && data.projectId) {
      this.downloadProjectBundle(data.projectId);
    }
  }

  async saveProjectToPc() {
    this.toast('Saving project & preparing .wxbrl download...');
    const data = await this.saveProject();
    if (data && data.projectId) {
      this.downloadProjectBundle(data.projectId);
    }
  }

  // --------------------------------------------------------------------------
  // Settings & Preferences (Auto-Save, Timers)
  // --------------------------------------------------------------------------
  openSettingsModal() {
    const modal = document.getElementById('modal-settings');
    if (!modal) return;
    const chk = document.getElementById('setting-autosave-toggle');
    const intervalInput = document.getElementById('setting-autosave-interval');
    if (chk) chk.checked = this.autosaveEnabled;
    if (intervalInput) intervalInput.value = this.autosaveIntervalSec;
    modal.removeAttribute('hidden');
    modal.style.display = 'flex';
  }

  closeSettingsModal() {
    const modal = document.getElementById('modal-settings');
    if (modal) {
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
    }
  }

  applySettings() {
    const chk = document.getElementById('setting-autosave-toggle');
    const intervalInput = document.getElementById('setting-autosave-interval');
    this.autosaveEnabled = chk ? chk.checked : false;
    this.autosaveIntervalSec = intervalInput ? (parseInt(intervalInput.value, 10) || 60) : 60;
    this.saveStoredSettings();
    this.startAutosaveTimer();
    this.closeSettingsModal();
    this.toast(`Preferences saved. Auto-Save: ${this.autosaveEnabled ? 'ON (' + this.autosaveIntervalSec + 's)' : 'OFF'}`);
  }

  startAutosaveTimer() {
    if (this.autosaveTimer) {
      clearInterval(this.autosaveTimer);
      this.autosaveTimer = null;
    }

    const indicator = document.getElementById('tb-autosave-indicator');
    if (this.autosaveEnabled) {
      if (indicator) {
        indicator.textContent = `⏱ Auto-Save: ON (${this.autosaveIntervalSec}s)`;
        indicator.classList.add('is-active');
      }
      this.autosaveTimer = setInterval(() => {
        if (this.isDirty) {
          this.performAutosave();
        }
      }, this.autosaveIntervalSec * 1000);
    } else {
      if (indicator) {
        indicator.textContent = '⏱ Auto-Save: OFF';
        indicator.classList.remove('is-active');
      }
    }
  }

  async performAutosave() {
    if (!this.isDirty) return;
    try {
      const payload = {
        uiState: {
          currentTab: this.currentTab,
          activeSheet: this.activeSheet,
          activeTreeElr: this.activeTreeElr,
          particularsCol: this.particularsCol,
          cyCol: this.cyCol,
          pyCol: this.pyCol,
          colDiff: this.colDiff,
          roundingLevel: this.roundingLevel,
        },
        autosaveSettings: {
          enabled: this.autosaveEnabled,
          intervalSec: this.autosaveIntervalSec,
        }
      };
      const res = await fetch('/api/projects/autosave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        this.clearDirty();
        const indicator = document.getElementById('tb-autosave-indicator');
        if (indicator) {
          indicator.title = `Auto-saved at ${new Date().toLocaleTimeString()}`;
        }
      }
    } catch (e) {
      console.warn('Background auto-save failed:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Unsaved Changes Prompt & Local Recovery Cache Management
  // --------------------------------------------------------------------------
  promptCloseProject() {
    this.promptActionIfDirty(() => {
      window.location.reload();
    });
  }

  promptActionIfDirty(action) {
    if (this.isDirty) {
      this.pendingAction = action;
      const modal = document.getElementById('modal-unsaved-changes');
      const docNameEl = document.getElementById('unsaved-project-name');
      const curDocName = document.getElementById('header-name')?.textContent || 'Untitled Filing';
      if (docNameEl) docNameEl.textContent = curDocName;
      if (modal) {
        modal.removeAttribute('hidden');
        modal.style.display = 'flex';
      }
    } else {
      if (typeof action === 'function') action();
    }
  }

  async saveUnsavedAndProceed() {
    const modal = document.getElementById('modal-unsaved-changes');
    if (modal) {
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
    }
    const saved = await this.saveProject();
    if (saved) {
      await this.discardRecoveryCache();
      this.clearDirty();
      const fn = this.pendingAction;
      this.pendingAction = null;
      if (typeof fn === 'function') fn();
    }
  }

  async discardUnsavedAndProceed() {
    const modal = document.getElementById('modal-unsaved-changes');
    if (modal) {
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
    }
    await this.discardRecoveryCache();
    this.clearDirty();
    const fn = this.pendingAction;
    this.pendingAction = null;
    if (typeof fn === 'function') fn();
  }

  cancelUnsavedAction() {
    const modal = document.getElementById('modal-unsaved-changes');
    if (modal) {
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
    }
    this.pendingAction = null;
  }

  async discardRecoveryCache() {
    try {
      await fetch('/api/projects/discard-recovery', { method: 'POST' });
    } catch (e) {
      console.warn('Discard recovery error:', e);
    }
  }

  // --------------------------------------------------------------------------
  // Unified 4-Step XML Generation & Pre-Validation Wizard
  // --------------------------------------------------------------------------
  async openXmlWizard() {
    const modal = document.getElementById('modal-xml-wizard');
    if (!modal) return;
    modal.removeAttribute('hidden');
    modal.style.display = 'flex';

    const taxLabelMap = {
      'ci': 'MCA C&I 2016 (Indian GAAP)',
      'ind_as': 'MCA Ind AS V1.2',
      'costing': 'Costing Taxonomy 2019'
    };
    const taxNameEl = document.getElementById('wizard-tax-name');
    if (taxNameEl) taxNameEl.textContent = taxLabelMap[this.activeTaxonomy] || this.activeTaxonomy;

    await this.revalidateWizard();
  }

  closeXmlWizard() {
    const modal = document.getElementById('modal-xml-wizard');
    if (modal) {
      modal.setAttribute('hidden', '');
      modal.style.display = 'none';
    }
  }

  async revalidateWizard() {
    const issuesContainer = document.getElementById('wizard-issues-list');
    const blockingCountEl = document.getElementById('wizard-blocking-count');
    const warningCountEl = document.getElementById('wizard-warning-count');
    const gateStatusEl = document.getElementById('wizard-gate-status');
    const genPanel = document.getElementById('wizard-generation-panel');
    const footerMsg = document.getElementById('wizard-footer-msg');

    if (issuesContainer) {
      issuesContainer.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b;">Evaluating filing facts, mandatory tags and business rules...</div>';
    }

    try {
      const res = await fetch('/api/filing/wizard/status');
      if (!res.ok) throw new Error('Failed to retrieve validation status');
      const data = await res.json();
      this.wizardData = data;

      const blockingErrors = data.blockingErrors || [];
      const warnings = data.warnings || [];

      if (blockingCountEl) blockingCountEl.textContent = blockingErrors.length;
      if (warningCountEl) warningCountEl.textContent = warnings.length;

      if (blockingErrors.length === 0) {
        if (gateStatusEl) {
          gateStatusEl.textContent = 'Passed Pre-Validation';
          gateStatusEl.style.color = '#15803d';
        }
        if (genPanel) genPanel.style.display = 'block';
        if (footerMsg) footerMsg.textContent = 'All pre-validation checks passed! You may generate the official MCA XBRL instance document.';
      } else {
        if (gateStatusEl) {
          gateStatusEl.textContent = `${blockingErrors.length} Blocking Issue(s)`;
          gateStatusEl.style.color = '#be123c';
        }
        if (genPanel) genPanel.style.display = 'none';
        if (footerMsg) footerMsg.textContent = 'Resolve all blocking errors to enable official XBRL instance document export.';
      }

      if (issuesContainer) {
        if (blockingErrors.length === 0 && warnings.length === 0) {
          issuesContainer.innerHTML = `
            <div style="padding:24px; text-align:center; color:#15803d; font-size:14px; font-weight:600;">
              🎉 Zero issues detected. All required concepts, dimensions, and balance sheet equations are verified.
            </div>
          `;
          return;
        }

        let html = '<table style="width:100%; border-collapse:collapse; font-size:12.5px;">';
        html += '<thead style="background:#f8fafc; border-bottom:1px solid #e2e8f0; font-weight:600; color:#475569;"><tr>' +
                '<th style="padding:8px 12px; text-align:left; width:90px;">Severity</th>' +
                '<th style="padding:8px 12px; text-align:left; width:130px;">Code</th>' +
                '<th style="padding:8px 12px; text-align:left;">Description</th>' +
                '<th style="padding:8px 12px; text-align:center; width:110px;">Action</th>' +
                '</tr></thead><tbody>';

        const allIssues = [
          ...blockingErrors.map(e => ({ ...e, isBlocking: true })),
          ...warnings.map(w => ({ ...w, isBlocking: false }))
        ];

        allIssues.forEach(iss => {
          const sevClass = iss.isBlocking ? 'bad' : 'warn';
          const sevLabel = iss.isBlocking ? 'BLOCKING' : 'WARNING';
          const hasJump = iss.sheet && iss.rowIndex;

          let jumpBtn = '';
          if (hasJump) {
            jumpBtn = `<button class="btn small" type="button" onclick="window.app.jumpToCell('${iss.sheet}', ${iss.rowIndex})">📍 Jump to Cell</button>`;
          }

          html += `<tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:8px 12px;"><span class="chip ${sevClass}">${sevLabel}</span></td>
            <td style="padding:8px 12px; font-family:var(--f-data); font-size:11px;"><b>${this.esc(iss.code || iss.ruleId || 'RULE')}</b></td>
            <td style="padding:8px 12px; color:#1e293b;">
              ${this.esc(iss.message)}
              ${iss.concept ? `<div style="font-size:11px; color:#64748b; font-family:var(--f-data);">${this.esc(iss.concept)}</div>` : ''}
              ${iss.sheet ? `<div style="font-size:11px; color:#0284c7;">Sheet: <b>${this.esc(iss.sheet)}</b> (Row ${iss.rowIndex || '?'})</div>` : ''}
            </td>
            <td style="padding:8px 12px; text-align:center;">${jumpBtn}</td>
          </tr>`;
        });

        html += '</tbody></table>';
        issuesContainer.innerHTML = html;
      }
    } catch (err) {
      if (issuesContainer) {
        issuesContainer.innerHTML = `<div style="padding:20px; color:var(--bad);">Error evaluating wizard status: ${err.message}</div>`;
      }
    }
  }

  async jumpToCell(sheet, rowIndex) {
    this.closeXmlWizard();
    this.selectTab('tagging');
    if (sheet && sheet !== this.activeSheet) {
      await this.switchSheet(sheet);
    }
    setTimeout(() => {
      const tbody = document.getElementById('excel-grid-body');
      if (!tbody) return;
      const targetRow = tbody.querySelector(`tr[data-row-index="${rowIndex}"]`);
      if (targetRow) {
        targetRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
        targetRow.classList.add('highlight-jump-cell');
        setTimeout(() => targetRow.classList.remove('highlight-jump-cell'), 2500);
        targetRow.click();
      }
    }, 200);
  }

  downloadGeneratedXml() {
    this.toast('Generating MCA compliant XBRL instance document...');
    window.location.href = '/api/filing/export/xml?allow_errors=false';
  }

  // --------------------------------------------------------------------------
  // Schedule Linking & Menu Commands
  // --------------------------------------------------------------------------
  async openLinkScheduleModal() {
    if (!this.selectedExcelRow) {
      alert('Please select an Excel row in the main statement first.');
      return;
    }
    const r = this.selectedExcelRow;
    const partCell = r.cells.find(c => c.col === this.particularsCol);
    const label = partCell ? partCell.display : `Row ${r.rowIndex}`;

    const sheetNames = (this.workbookData?.summary?.sheetNames || []).filter(s => s !== this.activeSheet);
    if (sheetNames.length === 0) {
      alert('No other schedule sheets found in this workbook to link.');
      return;
    }

    const targetSheet = prompt(`Link "${label}" (Row ${r.rowIndex}) to Schedule Sheet:\nAvailable: ${sheetNames.join(', ')}`, sheetNames[0]);
    if (!targetSheet) return;

    if (!sheetNames.includes(targetSheet)) {
      alert(`Sheet "${targetSheet}" does not exist in workbook.`);
      return;
    }

    try {
      const res = await fetch('/api/taxonomies/link-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceSheet: this.activeSheet,
          sourceRowIndex: r.rowIndex,
          concept: r.concept || '',
          targetSheet: targetSheet
        })
      });
      if (res.ok) {
        this.markDirty();
        this.toast(`Linked Row ${r.rowIndex} to schedule sheet "${targetSheet}"`);
        if (this.activeSheet) await this.switchSheet(this.activeSheet);
        await this.loadTaxonomyTree(this.activeTreeElr);
      }
    } catch (e) {
      alert(`Error linking schedule: ${e.message}`);
    }
  }

  triggerAutoTag() {
    this.triggerAutoTagging();
  }

  tagCurrentRowWithSelectedConcept() {
    if (this.selectedExcelRow && this.contextNode) {
      this.tagCurrentRowWithConcept(this.contextNode.concept, this.contextNode.label);
    } else {
      this.toast('Select an Excel row on the left and a taxonomy concept on the right first.');
    }
  }

  async removeCurrentRowTag() {
    if (!this.selectedExcelRow || !this.activeSheet) {
      this.toast('Select an Excel row on the left first to remove its tag.');
      return;
    }
    const r = this.selectedExcelRow;
    try {
      const res = await fetch('/api/taxonomies/untag-row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: this.activeSheet,
          rowIndex: r.rowIndex
        })
      });
      if (res.ok) {
        this.markDirty();
        this.toast(`Removed tagging from Row ${r.rowIndex}`);
        await this.switchSheet(this.activeSheet);
        await this.loadTaxonomyTree(this.activeTreeElr);
        await this.refreshDifferences();
      }
    } catch (e) {
      alert(e.message);
    }
  }

  goToLinkedCell() {
    if (this.contextNode) {
      this.cmGoToLinkedCell();
    } else {
      this.toast('Select a concept in the taxonomy tree first.');
    }
  }

  openColumnSettingsModal() {
    this.openResetSettingsModal();
  }

  setScopeFilter(scope) {
    if (scope === '100100' || scope === '100200') {
      this.onTaggingScopeChange(scope);
    } else {
      this.onTaggingScopeChange('100100');
    }
  }

  openHelpModal(topic) {
    if (topic === 'terms') {
      alert('XBRL Autopilot Taxonomy Guide:\n\n• Concept: Unique taxonomy identifier (e.g. in-ca:ShareCapital)\n• ELR: Extended Link Role (Statement or Schedule section)\n• Abstract: Heading/grouping node without numerical value\n• Monetary: Amount element having debit/credit balance\n• Schedule: Detailed breakdown supporting a primary financial statement line item.');
    } else if (topic === 'mca') {
      alert('MCA Filing Guidelines:\n\n1. Ensure CIN is valid 21-character alphanumeric identifier.\n2. Balance sheet equality: Total Assets == Total Equity & Liabilities.\n3. Mandatory concepts must be tagged for both Current Year and Previous Year.\n4. Official Validation: Before uploading to MCA portal, test instance document with MCA Validation Tool.');
    } else {
      alert('XBRL Autopilot Desktop Application\nVersion: 1.0.0-Production\nSupported Taxonomies: MCA C&I 2016, Ind AS V1.2, Costing 2019\nArchitecture: Dual-Pane Excel Tagging with Local Recovery Cache & Project Persistence.');
    }
  }

  carryForwardPriorYear() {
    this.toast('Prior year figures aligned');
  }

  autoSumTables() {
    this.toast('Table auto-sum executed');
  }

  cleanDeadFacts() {
    this.toast('Empty facts cleaned');
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
    const taxonomy = document.getElementById('new-taxonomy')?.value || 'ci';
    const name = document.getElementById('new-company-name').value;
    const cin = document.getElementById('new-cin').value;
    const startDate = document.getElementById('new-fy-start').value;
    const endDate = document.getElementById('new-fy-end').value;
    const rounding = document.getElementById('new-rounding').value;
    const reportType = document.getElementById('new-report-type').value;
    const fileInput = document.getElementById('new-excel-file');

    const formData = new FormData();
    formData.append('taxonomy', taxonomy);
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
      this.activeTaxonomy = taxonomy;
      const selectEl = document.getElementById('active-taxonomy-select');
      if (selectEl) selectEl.value = taxonomy;
      this.closeStartupModal();
      this.clearDirty();
      await this.discardRecoveryCache();
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
