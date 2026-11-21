import os
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

output_dir = 'notebooks/canonical_sheets'
os.makedirs(output_dir, exist_ok=True)

# Styling helpers for professional Excel appearance
header_fill = PatternFill(start_color="1F497D", end_color="1F497D", fill_type="solid")
header_font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
data_font = Font(name="Calibri", size=10)
thin_border = Border(
    left=Side(style='thin', color='D9D9D9'),
    right=Side(style='thin', color='D9D9D9'),
    top=Side(style='thin', color='D9D9D9'),
    bottom=Side(style='thin', color='D9D9D9')
)

def style_excel_sheet(ws):
    for col in ws.columns:
        max_len = 0
        col_letter = col[0].column_letter
        for cell in col:
            cell.font = data_font
            cell.border = thin_border
            val_str = str(cell.value or '')
            if len(val_str) > max_len:
                max_len = len(val_str)
        ws.column_dimensions[col_letter].width = min(max(max_len + 3, 12), 60)
        
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True)
    ws.row_dimensions[1].height = 28

# ==============================================================================
# 1. CANONICAL_BS (Balance Sheet)
# ==============================================================================
bs_data = [
    {"Row_Index": 1, "Line_Item": "Property, Plant & Equipment", "Breadcrumb_Hierarchy": "ASSETS > Non-current assets > Property, Plant & Equipment", "Note_No": "5", "Current_Year_Amount": 14500000.0, "Previous_Year_Amount": 12000000.0},
    {"Row_Index": 2, "Line_Item": "Capital work-in-progress", "Breadcrumb_Hierarchy": "ASSETS > Non-current assets > Capital work-in-progress", "Note_No": "5", "Current_Year_Amount": 500000.0, "Previous_Year_Amount": 0.0},
    {"Row_Index": 3, "Line_Item": "Other intangible assets", "Breadcrumb_Hierarchy": "ASSETS > Non-current assets > Other intangible assets", "Note_No": "6", "Current_Year_Amount": 1200000.0, "Previous_Year_Amount": 800000.0},
    {"Row_Index": 4, "Line_Item": "Non-current financial investments", "Breadcrumb_Hierarchy": "ASSETS > Non-current assets > Financial Assets > Investments", "Note_No": "7", "Current_Year_Amount": 3500000.0, "Previous_Year_Amount": 3500000.0},
    {"Row_Index": 5, "Line_Item": "Other non-current assets", "Breadcrumb_Hierarchy": "ASSETS > Non-current assets > Other non-current assets", "Note_No": "8", "Current_Year_Amount": 450000.0, "Previous_Year_Amount": 320000.0},
    {"Row_Index": 6, "Line_Item": "Inventories", "Breadcrumb_Hierarchy": "ASSETS > Current assets > Inventories", "Note_No": "9", "Current_Year_Amount": 8200000.0, "Previous_Year_Amount": 6500000.0},
    {"Row_Index": 7, "Line_Item": "Trade receivables", "Breadcrumb_Hierarchy": "ASSETS > Current assets > Financial Assets > Trade receivables", "Note_No": "10", "Current_Year_Amount": 12400000.0, "Previous_Year_Amount": 9800000.0},
    {"Row_Index": 8, "Line_Item": "Cash and cash equivalents", "Breadcrumb_Hierarchy": "ASSETS > Current assets > Financial Assets > Cash and cash equivalents", "Note_No": "11", "Current_Year_Amount": 4100000.0, "Previous_Year_Amount": 2300000.0},
    {"Row_Index": 9, "Line_Item": "Other current assets", "Breadcrumb_Hierarchy": "ASSETS > Current assets > Other current assets", "Note_No": "12", "Current_Year_Amount": 650000.0, "Previous_Year_Amount": 450000.0},
    {"Row_Index": 10, "Line_Item": "Total Assets", "Breadcrumb_Hierarchy": "ASSETS > Total Assets", "Note_No": "", "Current_Year_Amount": 45100000.0, "Previous_Year_Amount": 35670000.0},
    {"Row_Index": 11, "Line_Item": "Equity share capital", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Equity > Equity share capital", "Note_No": "13", "Current_Year_Amount": 10000000.0, "Previous_Year_Amount": 10000000.0},
    {"Row_Index": 12, "Line_Item": "Other equity", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Equity > Other equity", "Note_No": "14", "Current_Year_Amount": 18800000.0, "Previous_Year_Amount": 13270000.0},
    {"Row_Index": 13, "Line_Item": "Long-term borrowings", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Non-current liabilities > Financial Liabilities > Borrowings", "Note_No": "15", "Current_Year_Amount": 6000000.0, "Previous_Year_Amount": 5000000.0},
    {"Row_Index": 14, "Line_Item": "Long-term provisions", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Non-current liabilities > Provisions", "Note_No": "16", "Current_Year_Amount": 800000.0, "Previous_Year_Amount": 600000.0},
    {"Row_Index": 15, "Line_Item": "Short-term borrowings", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Current liabilities > Financial Liabilities > Borrowings", "Note_No": "17", "Current_Year_Amount": 2500000.0, "Previous_Year_Amount": 1800000.0},
    {"Row_Index": 16, "Line_Item": "Trade payables", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Current liabilities > Financial Liabilities > Trade payables", "Note_No": "18", "Current_Year_Amount": 5500000.0, "Previous_Year_Amount": 4000000.0},
    {"Row_Index": 17, "Line_Item": "Other current liabilities", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Current liabilities > Other current liabilities", "Note_No": "19", "Current_Year_Amount": 1200000.0, "Previous_Year_Amount": 800000.0},
    {"Row_Index": 18, "Line_Item": "Short-term provisions", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Current liabilities > Provisions", "Note_No": "20", "Current_Year_Amount": 300000.0, "Previous_Year_Amount": 200000.0},
    {"Row_Index": 19, "Line_Item": "Total Equity and Liabilities", "Breadcrumb_Hierarchy": "EQUITY AND LIABILITIES > Total Equity and Liabilities", "Note_No": "", "Current_Year_Amount": 45100000.0, "Previous_Year_Amount": 35670000.0}
]
df_bs = pd.DataFrame(bs_data)
df_bs.to_csv(os.path.join(output_dir, 'CANONICAL_BS.csv'), index=False)
with pd.ExcelWriter(os.path.join(output_dir, 'CANONICAL_BS.xlsx'), engine='openpyxl') as writer:
    df_bs.to_excel(writer, sheet_name='CANONICAL_BS', index=False)
    style_excel_sheet(writer.sheets['CANONICAL_BS'])
print("Saved CANONICAL_BS.xlsx & .csv")

# ==============================================================================
# 2. CANONICAL_PL (Profit & Loss Statement)
# ==============================================================================
pl_data = [
    {"Row_Index": 1, "Line_Item": "Revenue from operations", "Breadcrumb_Hierarchy": "Income > Revenue from operations", "Note_No": "21", "Current_Year_Amount": 52000000.0, "Previous_Year_Amount": 41000000.0},
    {"Row_Index": 2, "Line_Item": "Other income", "Breadcrumb_Hierarchy": "Income > Other income", "Note_No": "22", "Current_Year_Amount": 1200000.0, "Previous_Year_Amount": 850000.0},
    {"Row_Index": 3, "Line_Item": "Total Income", "Breadcrumb_Hierarchy": "Income > Total Income", "Note_No": "", "Current_Year_Amount": 53200000.0, "Previous_Year_Amount": 41850000.0},
    {"Row_Index": 4, "Line_Item": "Cost of materials consumed", "Breadcrumb_Hierarchy": "Expenses > Cost of materials consumed", "Note_No": "23", "Current_Year_Amount": 24000000.0, "Previous_Year_Amount": 19500000.0},
    {"Row_Index": 5, "Line_Item": "Changes in inventories of finished goods", "Breadcrumb_Hierarchy": "Expenses > Changes in inventories of finished goods", "Note_No": "24", "Current_Year_Amount": -1500000.0, "Previous_Year_Amount": -800000.0},
    {"Row_Index": 6, "Line_Item": "Employee benefits expense", "Breadcrumb_Hierarchy": "Expenses > Employee benefits expense", "Note_No": "25", "Current_Year_Amount": 8500000.0, "Previous_Year_Amount": 6800000.0},
    {"Row_Index": 7, "Line_Item": "Finance costs", "Breadcrumb_Hierarchy": "Expenses > Finance costs", "Note_No": "26", "Current_Year_Amount": 950000.0, "Previous_Year_Amount": 820000.0},
    {"Row_Index": 8, "Line_Item": "Depreciation and amortization expense", "Breadcrumb_Hierarchy": "Expenses > Depreciation and amortization expense", "Note_No": "27", "Current_Year_Amount": 2100000.0, "Previous_Year_Amount": 1800000.0},
    {"Row_Index": 9, "Line_Item": "Other expenses", "Breadcrumb_Hierarchy": "Expenses > Other expenses", "Note_No": "28", "Current_Year_Amount": 11450000.0, "Previous_Year_Amount": 9200000.0},
    {"Row_Index": 10, "Line_Item": "Total Expenses", "Breadcrumb_Hierarchy": "Expenses > Total Expenses", "Note_No": "", "Current_Year_Amount": 45500000.0, "Previous_Year_Amount": 37320000.0},
    {"Row_Index": 11, "Line_Item": "Profit before tax", "Breadcrumb_Hierarchy": "Expenses > Profit before tax", "Note_No": "", "Current_Year_Amount": 7700000.0, "Previous_Year_Amount": 4530000.0},
    {"Row_Index": 12, "Line_Item": "Current tax", "Breadcrumb_Hierarchy": "Tax expense > Current tax", "Note_No": "29", "Current_Year_Amount": 1950000.0, "Previous_Year_Amount": 1150000.0},
    {"Row_Index": 13, "Line_Item": "Deferred tax", "Breadcrumb_Hierarchy": "Tax expense > Deferred tax", "Note_No": "29", "Current_Year_Amount": 520000.0, "Previous_Year_Amount": 380000.0},
    {"Row_Index": 14, "Line_Item": "Profit for the period", "Breadcrumb_Hierarchy": "Profit for the period", "Note_No": "", "Current_Year_Amount": 5230000.0, "Previous_Year_Amount": 3000000.0}
]
df_pl = pd.DataFrame(pl_data)
df_pl.to_csv(os.path.join(output_dir, 'CANONICAL_PL.csv'), index=False)
with pd.ExcelWriter(os.path.join(output_dir, 'CANONICAL_PL.xlsx'), engine='openpyxl') as writer:
    df_pl.to_excel(writer, sheet_name='CANONICAL_PL', index=False)
    style_excel_sheet(writer.sheets['CANONICAL_PL'])
print("Saved CANONICAL_PL.xlsx & .csv")

# ==============================================================================
# 3. CANONICAL_CF (Cash Flow Statement - Ind AS)
# ==============================================================================
cf_data = [
    {"Row_Index": 1, "Line_Item": "Profit before tax", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Profit before tax", "Note_No": "", "Current_Year_Amount": 7700000.0, "Previous_Year_Amount": 4530000.0},
    {"Row_Index": 2, "Line_Item": "Depreciation and amortization", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Adjustments > Depreciation", "Note_No": "27", "Current_Year_Amount": 2100000.0, "Previous_Year_Amount": 1800000.0},
    {"Row_Index": 3, "Line_Item": "Finance costs", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Adjustments > Finance costs", "Note_No": "26", "Current_Year_Amount": 950000.0, "Previous_Year_Amount": 820000.0},
    {"Row_Index": 4, "Line_Item": "Interest income", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Adjustments > Interest income", "Note_No": "22", "Current_Year_Amount": -350000.0, "Previous_Year_Amount": -280000.0},
    {"Row_Index": 5, "Line_Item": "Operating profit before working capital changes", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Operating profit before working capital changes", "Note_No": "", "Current_Year_Amount": 10400000.0, "Previous_Year_Amount": 6870000.0},
    {"Row_Index": 6, "Line_Item": "Increase in inventories", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Working capital adjustments > Inventories", "Note_No": "", "Current_Year_Amount": -1700000.0, "Previous_Year_Amount": -1200000.0},
    {"Row_Index": 7, "Line_Item": "Increase in trade receivables", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Working capital adjustments > Trade receivables", "Note_No": "", "Current_Year_Amount": -2600000.0, "Previous_Year_Amount": -1800000.0},
    {"Row_Index": 8, "Line_Item": "Increase in trade payables", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Working capital adjustments > Trade payables", "Note_No": "", "Current_Year_Amount": 1500000.0, "Previous_Year_Amount": 900000.0},
    {"Row_Index": 9, "Line_Item": "Cash generated from operations", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Cash generated from operations", "Note_No": "", "Current_Year_Amount": 7600000.0, "Previous_Year_Amount": 4770000.0},
    {"Row_Index": 10, "Line_Item": "Income taxes paid", "Breadcrumb_Hierarchy": "Cash flow from operating activities > Direct taxes paid", "Note_No": "", "Current_Year_Amount": -1900000.0, "Previous_Year_Amount": -1100000.0},
    {"Row_Index": 11, "Line_Item": "Net cash generated from operating activities (A)", "Breadcrumb_Hierarchy": "Net cash generated from operating activities", "Note_No": "", "Current_Year_Amount": 5700000.0, "Previous_Year_Amount": 3670000.0},
    {"Row_Index": 12, "Line_Item": "Purchase of property, plant & equipment", "Breadcrumb_Hierarchy": "Cash flow from investing activities > Purchase of PPE", "Note_No": "5", "Current_Year_Amount": -4500000.0, "Previous_Year_Amount": -3200000.0},
    {"Row_Index": 13, "Line_Item": "Interest received", "Breadcrumb_Hierarchy": "Cash flow from investing activities > Interest received", "Note_No": "", "Current_Year_Amount": 350000.0, "Previous_Year_Amount": 280000.0},
    {"Row_Index": 14, "Line_Item": "Net cash used in investing activities (B)", "Breadcrumb_Hierarchy": "Net cash used in investing activities", "Note_No": "", "Current_Year_Amount": -4150000.0, "Previous_Year_Amount": -2920000.0},
    {"Row_Index": 15, "Line_Item": "Proceeds from long-term borrowings", "Breadcrumb_Hierarchy": "Cash flow from financing activities > Proceeds from borrowings", "Note_No": "", "Current_Year_Amount": 1000000.0, "Previous_Year_Amount": 500000.0},
    {"Row_Index": 16, "Line_Item": "Finance costs paid", "Breadcrumb_Hierarchy": "Cash flow from financing activities > Finance costs paid", "Note_No": "", "Current_Year_Amount": -750000.0, "Previous_Year_Amount": -650000.0},
    {"Row_Index": 17, "Line_Item": "Net cash generated from/(used in) financing activities (C)", "Breadcrumb_Hierarchy": "Net cash generated from/(used in) financing activities", "Note_No": "", "Current_Year_Amount": 250000.0, "Previous_Year_Amount": -150000.0},
    {"Row_Index": 18, "Line_Item": "Net increase in cash and cash equivalents (A + B + C)", "Breadcrumb_Hierarchy": "Net increase in cash and cash equivalents", "Note_No": "", "Current_Year_Amount": 1800000.0, "Previous_Year_Amount": 600000.0},
    {"Row_Index": 19, "Line_Item": "Cash and cash equivalents at the beginning of the year", "Breadcrumb_Hierarchy": "Cash and cash equivalents at beginning of year", "Note_No": "11", "Current_Year_Amount": 2300000.0, "Previous_Year_Amount": 1700000.0},
    {"Row_Index": 20, "Line_Item": "Cash and cash equivalents at the end of the year", "Breadcrumb_Hierarchy": "Cash and cash equivalents at end of year", "Note_No": "11", "Current_Year_Amount": 4100000.0, "Previous_Year_Amount": 2300000.0}
]
df_cf = pd.DataFrame(cf_data)
df_cf.to_csv(os.path.join(output_dir, 'CANONICAL_CF.csv'), index=False)
with pd.ExcelWriter(os.path.join(output_dir, 'CANONICAL_CF.xlsx'), engine='openpyxl') as writer:
    df_cf.to_excel(writer, sheet_name='CANONICAL_CF', index=False)
    style_excel_sheet(writer.sheets['CANONICAL_CF'])
print("Saved CANONICAL_CF.xlsx & .csv")

# ==============================================================================
# 4. CANONICAL_SOCIE (Statement of Changes in Equity)
# ==============================================================================
socie_data = [
    {"Row_Index": 1, "Equity_Component": "Equity Share Capital", "Transaction_Description": "Balance at beginning of the year", "Note_No": "13", "Current_Year_Amount": 10000000.0, "Previous_Year_Amount": 10000000.0},
    {"Row_Index": 2, "Equity_Component": "Equity Share Capital", "Transaction_Description": "Changes in equity share capital during the year", "Note_No": "13", "Current_Year_Amount": 0.0, "Previous_Year_Amount": 0.0},
    {"Row_Index": 3, "Equity_Component": "Equity Share Capital", "Transaction_Description": "Balance at end of the year", "Note_No": "13", "Current_Year_Amount": 10000000.0, "Previous_Year_Amount": 10000000.0},
    {"Row_Index": 4, "Equity_Component": "Retained Earnings", "Transaction_Description": "Balance at beginning of the year", "Note_No": "14", "Current_Year_Amount": 11270000.0, "Previous_Year_Amount": 8270000.0},
    {"Row_Index": 5, "Equity_Component": "Retained Earnings", "Transaction_Description": "Profit for the year", "Note_No": "", "Current_Year_Amount": 5230000.0, "Previous_Year_Amount": 3000000.0},
    {"Row_Index": 6, "Equity_Component": "Retained Earnings", "Transaction_Description": "Dividends paid", "Note_No": "", "Current_Year_Amount": 0.0, "Previous_Year_Amount": 0.0},
    {"Row_Index": 7, "Equity_Component": "Retained Earnings", "Transaction_Description": "Balance at end of the year", "Note_No": "14", "Current_Year_Amount": 16500000.0, "Previous_Year_Amount": 11270000.0},
    {"Row_Index": 8, "Equity_Component": "Securities Premium", "Transaction_Description": "Balance at beginning of the year", "Note_No": "14", "Current_Year_Amount": 2000000.0, "Previous_Year_Amount": 2000000.0},
    {"Row_Index": 9, "Equity_Component": "Securities Premium", "Transaction_Description": "Balance at end of the year", "Note_No": "14", "Current_Year_Amount": 2000000.0, "Previous_Year_Amount": 2000000.0},
    {"Row_Index": 10, "Equity_Component": "General Reserve", "Transaction_Description": "Balance at beginning of the year", "Note_No": "14", "Current_Year_Amount": 300000.0, "Previous_Year_Amount": 300000.0},
    {"Row_Index": 11, "Equity_Component": "General Reserve", "Transaction_Description": "Balance at end of the year", "Note_No": "14", "Current_Year_Amount": 300000.0, "Previous_Year_Amount": 300000.0},
    {"Row_Index": 12, "Equity_Component": "Total Other Equity", "Transaction_Description": "Balance at end of the year", "Note_No": "14", "Current_Year_Amount": 18800000.0, "Previous_Year_Amount": 13270000.0}
]
df_socie = pd.DataFrame(socie_data)
df_socie.to_csv(os.path.join(output_dir, 'CANONICAL_SOCIE.csv'), index=False)
with pd.ExcelWriter(os.path.join(output_dir, 'CANONICAL_SOCIE.xlsx'), engine='openpyxl') as writer:
    df_socie.to_excel(writer, sheet_name='CANONICAL_SOCIE', index=False)
    style_excel_sheet(writer.sheets['CANONICAL_SOCIE'])
print("Saved CANONICAL_SOCIE.xlsx & .csv")

# ==============================================================================
# 5. CANONICAL_PPE_SCHEDULE (Fixed Assets Roll-Forward Grid [T])
# ==============================================================================
ppe_data = [
    {
        "Asset_Class": "Plant and Equipment",
        "XBRL_Member": "ind-as:PlantAndEquipmentMember",
        "Gross_Opening": 10000000.0,
        "Gross_Additions": 2500000.0,
        "Gross_Disposals": 0.0,
        "Gross_Closing": 12500000.0,
        "Dep_Opening": 2000000.0,
        "Dep_For_Year": 1000000.0,
        "Dep_Disposals": 0.0,
        "Dep_Closing": 3000000.0,
        "Net_Current_Year": 9500000.0,
        "Net_Previous_Year": 8000000.0
    },
    {
        "Asset_Class": "Furniture and Fixtures",
        "XBRL_Member": "ind-as:FurnitureAndFixturesMember",
        "Gross_Opening": 2000000.0,
        "Gross_Additions": 500000.0,
        "Gross_Disposals": 0.0,
        "Gross_Closing": 2500000.0,
        "Dep_Opening": 600000.0,
        "Dep_For_Year": 250000.0,
        "Dep_Disposals": 0.0,
        "Dep_Closing": 850000.0,
        "Net_Current_Year": 1650000.0,
        "Net_Previous_Year": 1400000.0
    },
    {
        "Asset_Class": "Computer Equipment",
        "XBRL_Member": "ind-as:ComputerEquipmentMember",
        "Gross_Opening": 3000000.0,
        "Gross_Additions": 1200000.0,
        "Gross_Disposals": 200000.0,
        "Gross_Closing": 4000000.0,
        "Dep_Opening": 1500000.0,
        "Dep_For_Year": 700000.0,
        "Dep_Disposals": 150000.0,
        "Dep_Closing": 2050000.0,
        "Net_Current_Year": 1950000.0,
        "Net_Previous_Year": 1500000.0
    },
    {
        "Asset_Class": "Office Equipment",
        "XBRL_Member": "ind-as:OfficeEquipmentMember",
        "Gross_Opening": 1500000.0,
        "Gross_Additions": 300000.0,
        "Gross_Disposals": 0.0,
        "Gross_Closing": 1800000.0,
        "Dep_Opening": 400000.0,
        "Dep_For_Year": 150000.0,
        "Dep_Disposals": 0.0,
        "Dep_Closing": 550000.0,
        "Net_Current_Year": 1250000.0,
        "Net_Previous_Year": 1100000.0
    },
    {
        "Asset_Class": "Vehicles",
        "XBRL_Member": "ind-as:VehiclesMember",
        "Gross_Opening": 500000.0,
        "Gross_Additions": 0.0,
        "Gross_Disposals": 300000.0,
        "Gross_Closing": 200000.0,
        "Dep_Opening": 200000.0,
        "Dep_For_Year": 0.0,
        "Dep_Disposals": 150000.0,
        "Dep_Closing": 50000.0,
        "Net_Current_Year": 150000.0,
        "Net_Previous_Year": 300000.0
    },
    {
        "Asset_Class": "Total Property, Plant & Equipment",
        "XBRL_Member": "",
        "Gross_Opening": 17000000.0,
        "Gross_Additions": 4500000.0,
        "Gross_Disposals": 500000.0,
        "Gross_Closing": 21000000.0,
        "Dep_Opening": 4700000.0,
        "Dep_For_Year": 2100000.0,
        "Dep_Disposals": 300000.0,
        "Dep_Closing": 6500000.0,
        "Net_Current_Year": 14500000.0,
        "Net_Previous_Year": 12300000.0
    }
]
df_ppe = pd.DataFrame(ppe_data)
df_ppe.to_csv(os.path.join(output_dir, 'CANONICAL_PPE_SCHEDULE.csv'), index=False)
with pd.ExcelWriter(os.path.join(output_dir, 'CANONICAL_PPE_SCHEDULE.xlsx'), engine='openpyxl') as writer:
    df_ppe.to_excel(writer, sheet_name='CANONICAL_PPE', index=False)
    style_excel_sheet(writer.sheets['CANONICAL_PPE'])
print("Saved CANONICAL_PPE_SCHEDULE.xlsx & .csv")

# ==============================================================================
# 6. CANONICAL_NOTES (Narrative Notes & Text Blocks [E])
# ==============================================================================
notes_data = [
    {
        "Note_No": "1",
        "Note_Title": "Corporate Information and Overview",
        "Disclosure_Type": "General Information",
        "Narrative_Content": "Helmier Private Limited is a private company domiciled in India, incorporated under the provisions of the Companies Act, 2013. The company is primarily engaged in pharmaceutical manufacturing and healthcare technology services.",
        "Target_XBRL_Concept": "ind-as:CorporateAndGeneralInformationExplanatory"
    },
    {
        "Note_No": "2",
        "Note_Title": "Basis of Preparation & Significant Accounting Policies",
        "Disclosure_Type": "Accounting Policy",
        "Narrative_Content": "The financial statements of the Company have been prepared in accordance with Indian Accounting Standards (Ind AS) notified under Section 133 of the Companies Act, 2013 read with the Companies (Indian Accounting Standards) Rules, 2015 as amended from time to time. Historical cost convention is followed except for certain financial instruments measured at fair value.",
        "Target_XBRL_Concept": "ind-as:DescriptionOfAccountingPolicyForBasisOfPreparationOfFinancialStatementsTextBlock"
    },
    {
        "Note_No": "2.1",
        "Note_Title": "Property, Plant and Equipment Policy",
        "Disclosure_Type": "Accounting Policy",
        "Narrative_Content": "Property, plant and equipment are stated at cost, net of accumulated depreciation and accumulated impairment losses, if any. Depreciation is recognized using the straight-line method over estimated useful lives specified in Schedule II of the Companies Act, 2013.",
        "Target_XBRL_Concept": "ind-as:DescriptionOfAccountingPolicyForPropertyPlantAndEquipmentTextBlock"
    },
    {
        "Note_No": "2.2",
        "Note_Title": "Revenue Recognition Policy",
        "Disclosure_Type": "Accounting Policy",
        "Narrative_Content": "Revenue from contracts with customers is recognized upon transfer of control of promised goods or services to customers in an amount that reflects the consideration the Company expects to receive in exchange for those goods or services.",
        "Target_XBRL_Concept": "ind-as:DescriptionOfAccountingPolicyForRevenueRecognitionTextBlock"
    },
    {
        "Note_No": "2.3",
        "Note_Title": "Foreign Currency Transactions",
        "Disclosure_Type": "Accounting Policy",
        "Narrative_Content": "Transactions in foreign currencies are translated into the functional currency at the exchange rates prevailing on the dates of the transactions. Monetary items denominated in foreign currencies are translated at the closing rate at the reporting date.",
        "Target_XBRL_Concept": "ind-as:DescriptionOfAccountingPolicyForForeignCurrencyTransactionsTextBlock"
    },
    {
        "Note_No": "30",
        "Note_Title": "Related Party Disclosures",
        "Disclosure_Type": "Disclosures",
        "Narrative_Content": "Key Management Personnel: Directors Mr. John Doe (DIN 01234567) and Mrs. Jane Doe (DIN 07654321). Remuneration paid during the year: Rs. 36,00,000 (PY: Rs. 30,00,000). No loans or guarantees were provided to or received from related parties.",
        "Target_XBRL_Concept": "ind-as:DisclosureOfRelatedPartyExplanatory"
    },
    {
        "Note_No": "31",
        "Note_Title": "Contingent Liabilities and Commitments",
        "Disclosure_Type": "Disclosures",
        "Narrative_Content": "Contingent Liabilities: Disputed income tax demand of Rs. 4,50,000 pending before CIT(Appeals). Capital Commitments: Estimated amount of contracts remaining to be executed on capital account and not provided for: Rs. 8,00,000.",
        "Target_XBRL_Concept": "ind-as:DisclosureOfContingentLiabilitiesAndCommitmentsExplanatory"
    }
]
df_notes = pd.DataFrame(notes_data)
df_notes.to_csv(os.path.join(output_dir, 'CANONICAL_NOTES.csv'), index=False)
with pd.ExcelWriter(os.path.join(output_dir, 'CANONICAL_NOTES.xlsx'), engine='openpyxl') as writer:
    df_notes.to_excel(writer, sheet_name='CANONICAL_NOTES', index=False)
    style_excel_sheet(writer.sheets['CANONICAL_NOTES'])
print("Saved CANONICAL_NOTES.xlsx & .csv")

# ==============================================================================
# 7. COMPANY_MASTER (Company Profile, Directors, Auditors)
# ==============================================================================
with pd.ExcelWriter(os.path.join(output_dir, 'COMPANY_MASTER.xlsx'), engine='openpyxl') as writer:
    # Sheet 1: Company Profile
    comp_prof = [
        {"Field_Name": "Corporate Identity Number (CIN)", "Field_Value": "U85100MH2021PTC366828"},
        {"Field_Name": "Name of Company", "Field_Value": "HELMIER PRIVATE LIMITED"},
        {"Field_Name": "Permanent Account Number (PAN)", "Field_Value": "AAACH1234K"},
        {"Field_Name": "Registered Office Address", "Field_Value": "Plot 45, MIDC Industrial Area, Andheri East, Mumbai, Maharashtra 400093"},
        {"Field_Name": "Nature of Financial Statements", "Field_Value": "Standalone"},
        {"Field_Name": "Period Start Date (Current Year)", "Field_Value": "2025-04-01"},
        {"Field_Name": "Period End Date (Current Year)", "Field_Value": "2026-03-31"},
        {"Field_Name": "Period Start Date (Previous Year)", "Field_Value": "2024-04-01"},
        {"Field_Name": "Period End Date (Previous Year)", "Field_Value": "2025-03-31"},
        {"Field_Name": "Reporting Currency", "Field_Value": "INR"},
        {"Field_Name": "Level of Rounding", "Field_Value": "Exact (Actuals)"}
    ]
    df_cp = pd.DataFrame(comp_prof)
    df_cp.to_excel(writer, sheet_name='Company_Profile', index=False)
    style_excel_sheet(writer.sheets['Company_Profile'])
    
    # Sheet 2: Directors Master
    directors = [
        {"DIN": "01234567", "Director_Name": "John Doe", "Designation": "Managing Director", "Category": "Executive", "PAN": "ABCDE1234F", "Appointment_Date": "2021-08-15"},
        {"DIN": "07654321", "Director_Name": "Jane Doe", "Designation": "Director", "Category": "Non-Executive", "PAN": "VWXYZ5678G", "Appointment_Date": "2021-08-15"}
    ]
    df_dir = pd.DataFrame(directors)
    df_dir.to_excel(writer, sheet_name='Directors_Master', index=False)
    style_excel_sheet(writer.sheets['Directors_Master'])
    
    # Sheet 3: Auditors Master
    auditors = [
        {"Auditor_Type": "Firm", "Firm_Registration_No": "123456W", "Firm_Name": "Sharma & Associates LLP", "Signing_Partner_Name": "Rajesh Sharma", "Membership_No": "098765", "Partner_PAN": "PQRST9876H", "Audit_Report_Date": "2026-09-02", "Opinion_Type": "Unmodified"}
    ]
    df_aud = pd.DataFrame(auditors)
    df_aud.to_excel(writer, sheet_name='Auditors_Master', index=False)
    style_excel_sheet(writer.sheets['Auditors_Master'])

print("Saved COMPANY_MASTER.xlsx")
print("\nAll 6 Canonical Spreadsheets successfully generated in:", output_dir)
