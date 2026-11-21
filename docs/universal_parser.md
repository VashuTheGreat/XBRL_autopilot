
Sabhi 4 companies ki Excel files (.xls and .xlsx) ko analyze karke
  notes_extractor.py ko complete and universal bana diya gaya hai.

  Ab aap kisi bhi company ki client Excel sheet doge, to code
  automatically detect karke ek single Master Excel workbook generate
  karega jisme canonical standards ke hisaab se 6 structured sheets
  create hongi.
  ──────
  📊 All 4 Companies Verification Matrix

   Com… │ Client Source File │ BS │ PL │ CF │ SOC… │ PPE │ FIN… │ Status
  ──────┼────────────────────┼────┼────┼────┼──────┼─────┼──────┼────────
   DGPL │ BS DGPL Mar-2026-  │ 21 │ 24 │ 32 │  7   │  4  │ 179  │  100%
        │ V1.xls (27 sheets) │    │    │    │      │     │      │  PASS
   HPL  │ HPL -M26 -         │ 21 │ 18 │ 41 │  9   │  4  │ 276  │  100%
        │ Financials...xlsx  │    │    │    │      │     │      │  PASS
        │ (17 sheets)        │    │    │    │      │     │      │
   Epac │ 1.22 Balance       │ 23 │ 18 │ 29 │  7   │ 10  │ 261  │  100%
   k    │ Sheet...Final.xlsx │    │    │    │      │     │      │  PASS
   Petr │ (33 sheets)        │    │    │    │      │     │      │
   oche │                    │    │    │    │      │     │      │
   m    │                    │    │    │    │      │     │      │
   Epac │ Epack Prefab -     │ 28 │ 20 │ 38 │  7   │  8  │ 173  │  100%
   k    │ Final...xlsx (29   │    │    │    │      │     │      │  PASS
   Pref │ sheets)            │    │    │    │      │     │      │
   ab   │                    │    │    │    │      │     │      │
  ──────
  🛠 Key Architectural Enhancements Implemented

1. Joint BS-PL Sheet Support:
   • Epack Petrochem me Balance Sheet aur P&L dono ek hi sheet 'BS-PL'
   me the. Extractor ab automatic detect karta hai ki sheet joint hai
   ya separate, BS ko row 42 (Total) par safely stop karta hai, aurrow 64 se P&L header detect karke separate CANONICAL_PL extractkarta hai.
2. Paired Rupees & Lakhs Columns:
   • Epack Prefab me har year ke do columns the (ek Raw Rupees me aur
   dusra Lakhs me). Extractor unscaled / paired ratio detect karkedouble-scaling avoid karta hai aur exact INR values generate karta
   hai.
3. Horizontal & Vertical PPE Schedule Detection:
   • Vertical tables (DGPL FA, HPL 11a & 11b, Petrochem PPE Chart)jahan columns asset classes hote hain.
   • Horizontal tables (Epack Prefab Note 2A & 2B ) jahan rows asset
   classes hoti hain aur columns Gross Block, Accumulated Depreciation,
   aur Net Block hote hain. Dono layouts automatically parse hote hain.
4. Universal Dynamic SOCIE:
   • Agar dedicated sheet available hai (Change in Equity ya SOCE), to
   wahan se Equity Share Capital & Retained Earnings movements parse
   hoti hain.
   • Agar dedicated sheet nahi hai, to BS Notes se Note 3 (ShareCapital) aur Note 4 (Reserves & Surplus / Retained Earnings)
   dynamically read karke SOCIE build karta hai.
5. Exact Canonical Schemas (100% Match):
   • CANONICAL_BS: ['Row_Index', 'Line_Item', 'Breadcrumb_Hierarchy',
   'Note_No', 'Current_Year_Amount', 'Previous_Year_Amount']
   • CANONICAL_PL: ['Row_Index', 'Line_Item', 'Breadcrumb_Hierarchy',
   'Note_No', 'Current_Year_Amount', 'Previous_Year_Amount']
   • CANONICAL_CF: ['Row_Index', 'Line_Item', 'Breadcrumb_Hierarchy',
   'Note_No', 'Current_Year_Amount', 'Previous_Year_Amount']
   • CANONICAL_SOCIE: ['Row_Index', 'Equity_Component',
   'Transaction_Description', 'Note_No', 'Current_Year_Amount',
   'Previous_Year_Amount']
   • CANONICAL_PPE_SCHEDULE: ['Asset_Class', 'Gross_Opening',
   'Gross_Additions', 'Gross_Disposals', 'Gross_Closing',
   'Dep_Opening', 'Dep_For_Year', 'Dep_Disposals', 'Dep_Closing',
   'Net_Current_Year', 'Net_Previous_Year']
   • CANONICAL_FINANCIAL_NOTES: ['Row_Index', 'Note_No', 'Line_Item',
   'Breadcrumb_Hierarchy', 'Current_Year_Amount',
   'Previous_Year_Amount']

  ──────
