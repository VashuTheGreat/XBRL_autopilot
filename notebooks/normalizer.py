"""
Deep Workbook Normalizer Module
Parses unstructured client Excel workbooks (using python-calamine) into Standard Canonical Sheets.
"""
import os
import re
from typing import Dict, Any, List, Tuple, Optional
from python_calamine import CalamineWorkbook

class DeepWorkbookNormalizer:
    """
    Production-grade Normalizer that transforms messy client workbooks into
    Standard Canonical Sheets ready for downstream XBRL vector search and tagging.
    """
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.filename = os.path.basename(filepath)
        self.wb = CalamineWorkbook.from_path(filepath)
        self.sheet_names = self.wb.sheet_names

    def classify_sheets(self) -> Dict[str, str]:
        """
        Classifies sheets into Canonical Statements, Notes, Schedules, or Scratchpads.
        """
        classifications = {}
        for s in self.sheet_names:
            s_clean = s.strip()
            s_lower = s_clean.lower()
            
            # Rule 1: Notes & Schedules
            if any(k in s_lower for k in ['notes of', 'notes to', 'note ', 'note-', 'notes', 'rpt', 'polic']):
                classifications[s] = 'CANONICAL_NOTES'
            # Rule 2: Fixed Assets / PPE Table Schedule
            elif any(fa in s_lower for fa in ['fa', 'fixed asset', 'ppe']):
                classifications[s] = 'CANONICAL_PPE_SCHEDULE'
            # Rule 3: Balance Sheet
            elif re.search(r'\b(balance\s*sheet|ind\s*as\s*bs)\b', s_lower) or s_lower == 'bs' or s_lower.startswith('bs '):
                classifications[s] = 'CANONICAL_BS'
            # Rule 4: Profit & Loss Statement
            elif re.search(r'\b(p&l|profit|loss)\b', s_lower):
                classifications[s] = 'CANONICAL_PL'
            # Rule 5: Cash Flow Statement
            elif re.search(r'\b(cash\s*flow|cashflow)\b', s_lower) and not 'working' in s_lower:
                classifications[s] = 'CANONICAL_CF'
            # Rule 6: Statement of Changes in Equity
            elif re.search(r'\b(change\s*in\s*equity|socie)\b', s_lower):
                classifications[s] = 'CANONICAL_SOCIE'
            # Rule 7: Explicit Scratchpads
            elif len(s_clean) == 1 or re.match(r'^sheet\d+$', s_lower) or any(junk in s_lower for junk in [
                'tb', 'adv tax', 'cogs', 'payable', 'working', 'computation', 
                'dep chart', 'dep it', 'debtor', 'creditor', 'employee', 'trial'
            ]):
                classifications[s] = 'IGNORE_SCRATCHPAD'
            else:
                classifications[s] = 'IGNORE_SCRATCHPAD'
                
        return classifications

    def extract_metadata(self, sheet_data: List[List[Any]]) -> Dict[str, str]:
        """
        Extracts Company Name, CIN, Reporting Period, and Reporting Unit from header rows.
        """
        cin = None
        company_name = None
        unit = 'INR'
        
        cin_regex = re.compile(r'[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}', re.I)
        
        for row in sheet_data[:12]:
            for cell in row:
                if cell is None:
                    continue
                s = str(cell).strip()
                match = cin_regex.search(s)
                if match:
                    cin = match.group(0).upper()
                if any(kw in s.upper() for kw in ['PRIVATE LIMITED', 'LTD', 'LIMITED', 'CORP', 'CORPORATION']) and not company_name:
                    if not s.upper().startswith('CIN'):
                        company_name = s.split('\n')[0].strip()
                if 'lakh' in s.lower():
                    unit = 'INR Lakhs'
                elif 'crore' in s.lower():
                    unit = 'INR Crores'
                    
        return {
            'company_name': company_name or 'UNKNOWN',
            'cin': cin or 'NOT_FOUND',
            'unit': unit
        }

    def detect_header_and_columns(self, sheet_data: List[List[Any]]) -> Tuple[Optional[int], Optional[int], Optional[int], Optional[int], Optional[int]]:
        """
        Dynamically detects the header row and locates:
        - Particulars / Line Item description column
        - Note / Schedule number column
        - Current Year (CY) value column
        - Previous Year (PY) value column
        """
        header_idx = None
        particulars_col = None
        note_col = None
        cy_col = None
        py_col = None
        
        for r_idx, row in enumerate(sheet_data[:20]):
            for c_idx, cell in enumerate(row):
                if cell is not None and any(p in str(cell).lower() for p in ['particular', 'description', 'line item', 'item']):
                    header_idx = r_idx
                    particulars_col = c_idx
                    break
            if header_idx is not None:
                break
                
        if header_idx is None:
            return None, None, None, None, None
            
        header_row = sheet_data[header_idx]
        for c_idx, cell in enumerate(header_row):
            if cell is None:
                continue
            cn = str(cell).strip().lower().replace('\n', ' ')
            if any(n in cn for n in ['note', 'schedule', 'sch']) and note_col is None:
                note_col = c_idx
            elif ('2026' in cn or 'current year' in cn or '31st march, 2026' in cn or '31 march 2026' in cn) and cy_col is None:
                cy_col = c_idx
            elif ('2025' in cn or 'previous year' in cn or '31st march, 2025' in cn or '31 march 2025' in cn) and py_col is None:
                py_col = c_idx
                
        return header_idx, particulars_col, note_col, cy_col, py_col

    def _clean_numeric(self, val: Any) -> Optional[float]:
        if val is None:
            return None
        if isinstance(val, (int, float)):
            return float(val)
        s = str(val).strip().replace(',', '')
        if s in ['', '-', '—', 'nil', 'null', 'None']:
            return 0.0
        try:
            return float(s)
        except ValueError:
            return None

    def _clean_note(self, val: Any) -> Optional[str]:
        if val is None:
            return None
        s = str(val).strip()
        if s.endswith('.0'):
            s = s[:-2]
        return s if s and s != '0' else None

    def parse_statement(self, sheet_name: str, statement_type: str) -> Dict[str, Any]:
        """
        Extracts canonical rows with upward breadcrumb hierarchy and normalized note references.
        """
        sheet_data = self.wb.get_sheet_by_name(sheet_name).to_python()
        h_idx, p_col, n_col, cy_col, py_col = self.detect_header_and_columns(sheet_data)
        
        if h_idx is None:
            return {'error': f'Header row not found in {sheet_name}', 'line_items': []}
            
        metadata = self.extract_metadata(sheet_data)
        
        breadcrumbs: List[str] = []
        line_items: List[Dict[str, Any]] = []
        
        for r_idx in range(h_idx + 1, len(sheet_data)):
            row = sheet_data[r_idx]
            if p_col >= len(row) or row[p_col] is None:
                continue
                
            label = str(row[p_col]).strip()
            # Skip empty labels, single letters (scratch subtotals 'A', 'B'), or pure numbers
            if not label or len(label) <= 1 or re.match(r'^[0-9\.\,\-]+$', label):
                continue
                
            note_val = self._clean_note(row[n_col]) if n_col is not None and n_col < len(row) else None
            cy_val = self._clean_numeric(row[cy_col]) if cy_col is not None and cy_col < len(row) else None
            py_val = self._clean_numeric(row[py_col]) if py_col is not None and py_col < len(row) else None
            
            # Determine if this row is an abstract category heading
            is_zero_or_none = (cy_val is None or (cy_val == 0.0 and py_val == 0.0))
            is_abstract = is_zero_or_none and note_val is None and not label.lower().startswith('total')
            
            if is_abstract:
                # Top-level sections
                if any(m in label.upper() for m in ['EQUITY AND LIABILITIES', 'ASSETS', 'INCOME', 'REVENUE', 'EXPENSES']):
                    breadcrumbs = [label]
                elif any(sub in label.upper() for sub in ['CURRENT', 'NON-CURRENT', 'FINANCIAL', 'PROVISIONS', 'SHAREHOLDER', 'TAX']):
                    breadcrumbs = [breadcrumbs[0]] if breadcrumbs else []
                    breadcrumbs.append(label)
                continue
                
            # Construct upward hierarchical breadcrumb path
            full_breadcrumb = ' > '.join(breadcrumbs + [label]) if breadcrumbs else label
            
            line_items.append({
                'row_index': r_idx,
                'label': label,
                'breadcrumb_path': full_breadcrumb,
                'note_no': note_val,
                'cy_value': cy_val,
                'py_value': py_val
            })
            
        return {
            'statement_type': statement_type,
            'source_sheet': sheet_name,
            'detected_columns': {
                'header_row': h_idx,
                'particulars_col': p_col,
                'note_col': n_col,
                'cy_col': cy_col,
                'py_col': py_col
            },
            'metadata': metadata,
            'total_rows_extracted': len(line_items),
            'line_items': line_items
        }

    def parse_full_canonical_workbook(self) -> Dict[str, Any]:
        """
        Runs end-to-end normalization across all sheets in the client workbook.
        """
        sheet_classes = self.classify_sheets()
        canonical_statements = {}
        schedules = []
        notes = []
        ignored = []
        
        metadata = {}
        
        for sheet_name, c_type in sheet_classes.items():
            if c_type in ['CANONICAL_BS', 'CANONICAL_PL', 'CANONICAL_CF', 'CANONICAL_SOCIE']:
                parsed = self.parse_statement(sheet_name, c_type)
                canonical_statements[c_type] = parsed
                if not metadata and 'metadata' in parsed:
                    metadata = parsed['metadata']
            elif c_type == 'CANONICAL_PPE_SCHEDULE':
                schedules.append({'sheet_name': sheet_name, 'type': c_type})
            elif c_type == 'CANONICAL_NOTES':
                notes.append({'sheet_name': sheet_name, 'type': c_type})
            else:
                ignored.append(sheet_name)
                
        return {
            'file_name': self.filename,
            'metadata': metadata,
            'sheets_summary': {
                'total_sheets': len(self.sheet_names),
                'statements_count': len(canonical_statements),
                'schedules_count': len(schedules),
                'notes_sheets_count': len(notes),
                'ignored_scratchpads_count': len(ignored),
                'ignored_sheets': ignored
            },
            'canonical_statements': canonical_statements,
            'canonical_schedules': schedules,
            'canonical_notes': notes
        }
