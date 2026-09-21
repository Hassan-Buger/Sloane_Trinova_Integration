/**
 * Sloane Seed Data
 * Sourced from 01_product_context.md and 03_frontend_context.md
 * ("Trinova filing tracker · source workbook dated Aug 2026")
 */

export const INITIAL_BUSINESSES = [
  { id: "biz-1", name: "Trinova Accounting", type: "Accountancy & Tax", status: "Active" },
  { id: "biz-2", name: "CFI Awarding", type: "Awarding Organisation", status: "Active" },
  { id: "biz-3", name: "The Thinking Tent / Yellow Brick", type: "Consultancy & Design", status: "Active" },
  { id: "biz-4", name: "MTDflow", type: "Fintech / SaaS", status: "Active" },
  { id: "biz-5", name: "Meta Digital Accounting", type: "Digital Accounting", status: "Active" },
  { id: "biz-6", name: "Other ventures & property", type: "Holdings & Investments", status: "Active" }
];

export const ACCOUNTS_TRACKER = [
  { no: "12345678", name: "Woofington Park Limited", year: "2025-11-30", accounts: "2026-08-31", status: "Draft sent to client", dirs: "Sarah Jenkins, Mark Jenkins", fee: "£1,850", note: "Active strike-off proposal flagged on Companies House" },
  { no: "08923412", name: "R GB Elevations Ltd", year: "2025-10-31", accounts: "2026-07-31", status: "Awaiting bank statements", dirs: "Robert Brown", fee: "£2,400", note: "Accounts currently overdue" },
  { no: "11223344", name: "Alpha Delta Creative Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "In progress", dirs: "Amanda Smith", fee: "£1,500", note: "Filing due in 11 days" },
  { no: "09876543", name: "Apex Pinnacle Logistics Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "In review", dirs: "David Cole", fee: "£3,200", note: "Filing due in 11 days" },
  { no: "10554433", name: "Beacon Hill Consultancy Ltd", year: "2026-01-31", accounts: "2026-10-31", status: "Waiting records", dirs: "Elena Rostova", fee: "£1,200", note: "Standard cycle" },
  { no: "13445566", name: "Bluebird Retail Ventures Ltd", year: "2026-01-31", accounts: "2026-10-31", status: "Records received", dirs: "Gary Cooper", fee: "£2,100", note: "Drafting accounts" },
  { no: "07889900", name: "Crestview Media Solutions Ltd", year: "2026-02-28", accounts: "2026-11-30", status: "Not started", dirs: "Claire Taylor", fee: "£1,650", note: "Target start mid-Oct" },
  { no: "14556677", name: "Dalton & Forge Engineering Ltd", year: "2026-02-28", accounts: "2026-11-30", status: "Queries pending", dirs: "Ian Dalton", fee: "£4,500", note: "Complex WIP valuation" },
  { no: "06554433", name: "Elysium Wellness Clinics Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "Ready to file", dirs: "Dr. Rachel Green", fee: "£2,800", note: "Awaiting final e-sign" },
  { no: "15667788", name: "Faraday Electrical Contractors Ltd", year: "2026-03-31", accounts: "2026-12-31", status: "Not started", dirs: "Thomas Edison", fee: "£1,900", note: "Year end March" },
  { no: "05443322", name: "Greenfield Agritech Solutions Ltd", year: "2026-03-31", accounts: "2026-12-31", status: "Not started", dirs: "Fiona MacLeod", fee: "£2,200", note: "R&D claim review required" },
  { no: "16778899", name: "Halcyon Hospitality Group Ltd", year: "2025-11-30", accounts: "2026-08-31", status: "Client query", dirs: "Marcus Vance", fee: "£5,400", note: "PAST DATE · verify current filing status" },
  { no: "04332211", name: "Ironclad Security Systems Ltd", year: "2026-01-31", accounts: "2026-10-31", status: "In progress", dirs: "Sean Connery", fee: "£1,750", note: "Bank reconciliation cleared" },
  { no: "17889900", name: "Javelin Freight Transport Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "Draft prepared", dirs: "Oliver Twist", fee: "£3,100", note: "Due end of month" },
  { no: "03221100", name: "Kestrel Drone Imaging Ltd", year: "2026-02-28", accounts: "2026-11-30", status: "Not started", dirs: "Peter Parker", fee: "£1,400", note: "Asset register update needed" },
  { no: "18990011", name: "Lunar Robotics Laboratory Ltd", year: "2026-03-31", accounts: "2026-12-31", status: "Not started", dirs: "Neil Armstrong", fee: "£4,000", note: "Innovate UK grant reconciliation" },
  { no: "02110099", name: "Monarch Craft Brewers Ltd", year: "2025-10-31", accounts: "2026-07-31", status: "Overdue", dirs: "Arthur Guinness", fee: "£2,600", note: "PAST DATE · urgent follow up" },
  { no: "19001122", name: "Nexus Digital Transformations Ltd", year: "2026-01-31", accounts: "2026-10-31", status: "Records received", dirs: "Steve Jobs", fee: "£3,500", note: "VAT cross-check complete" },
  { no: "01009988", name: "Orion Space Optics Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "Ready for signature", dirs: "Carl Sagan", fee: "£2,900", note: "Sent for client sign-off" },
  { no: "20112233", name: "Palatine Architectural Design Ltd", year: "2026-02-28", accounts: "2026-11-30", status: "In progress", dirs: "Zaha Hadid", fee: "£3,800", note: "Fee quote revised" },
  { no: "09112233", name: "Quantum FinTech Analytics Ltd", year: "2026-03-31", accounts: "2026-12-31", status: "Not started", dirs: "Alan Turing", fee: "£4,200", note: "MTD connection active" },
  { no: "21223344", name: "Redwood Timber Importers Ltd", year: "2025-11-30", accounts: "2026-08-31", status: "Filing delayed", dirs: "Robin Hood", fee: "£2,500", note: "PAST DATE · verify" },
  { no: "08223344", name: "Starlight Solar Energy Ltd", year: "2026-01-31", accounts: "2026-10-31", status: "In review", dirs: "Nikola Tesla", fee: "£3,000", note: "Reviewing capital allowances" },
  { no: "22334455", name: "Triton Marine Surveyors Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "Draft with client", dirs: "Captain Cook", fee: "£2,100", note: "Due within 14 days" },
  { no: "07334455", name: "Urban Pulse Fashion Brand Ltd", year: "2026-02-28", accounts: "2026-11-30", status: "Records pending", dirs: "Vivienne Westwood", fee: "£1,950", note: "Inventory stock count awaited" },
  { no: "23445566", name: "Valiant Cybersecurity Ltd", year: "2026-03-31", accounts: "2026-12-31", status: "Not started", dirs: "Ada Lovelace", fee: "£3,600", note: "Year end Mar 26" },
  { no: "06445566", name: "Whistler Alpine Gear Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "Signed, filing today", dirs: "Edmund Hillary", fee: "£2,300", note: "Urgent filing queue" },
  { no: "24556677", name: "Xerxes Strategic Holdings Ltd", year: "2026-01-31", accounts: "2026-10-31", status: "In progress", dirs: "Cyrus Great", fee: "£5,000", note: "Consolidated group accounts" },
  { no: "05556677", name: "Yellow Brick Creative Agency Ltd", year: "2026-02-28", accounts: "2026-11-30", status: "Not started", dirs: "Kirsty Allen", fee: "£0 (Internal)", note: "Kirsty Allen entity · internal" },
  { no: "25667788", name: "Zenith Clean Energy Corp Ltd", year: "2026-03-31", accounts: "2026-12-31", status: "Not started", dirs: "Greta Thunberg", fee: "£2,700", note: "Subcontractor accounts" },
  { no: "04667788", name: "Artemis BioHealth Labs Ltd", year: "2025-10-31", accounts: "2026-07-31", status: "Overdue", dirs: "Alexander Fleming", fee: "£3,900", note: "PAST DATE · verify" },
  { no: "26778899", name: "Borealis Northern Log Homes Ltd", year: "2025-12-31", accounts: "2026-09-30", status: "Waiting approval", dirs: "Lars Larsson", fee: "£2,000", note: "Director approval pending" },
  { no: "03778899", name: "Cascade Water Utilities Ltd", year: "2026-01-31", accounts: "2026-10-31", status: "In review", dirs: "Charles Lyell", fee: "£4,800", note: "Audit exemption verification" }
];

export const ACTION_TRACKER = [
  { id: "act-1", company: "Woofington Park Limited", no: "12345678", issue: "Active proposal to strike off registered at Companies House", action: "File objection or submit overdue accounts immediately", urgency: "RED" },
  { id: "act-2", company: "R GB Elevations Ltd", no: "08923412", issue: "Accounts overdue since 31/07/2026 — penalty increasing", action: "Obtain missing statements and file electronically today", urgency: "RED" },
  { id: "act-3", company: "Monarch Craft Brewers Ltd", no: "02110099", issue: "Accounts overdue since 31/07/2026", action: "Chase director for confirmation and signature", urgency: "RED" },
  { id: "act-4", company: "Artemis BioHealth Labs Ltd", no: "04667788", issue: "Accounts overdue since 31/07/2026", action: "Confirm if trade ceased or verify draft status", urgency: "RED" },
  { id: "act-5", company: "Redwood Timber Importers Ltd", no: "21223344", issue: "Accounts past date (31/08/2026)", action: "Verify whether already submitted via portal", urgency: "AMBER" },
  { id: "act-6", company: "Sole Trader Services Ltd", no: "99887766", issue: "Sole trader — previously reported in error as Ltd", action: "NO ACTION — sole trader record closed", urgency: "CLEAR" },
  { id: "act-7", company: "Old Docklands Logistics Ltd", no: "88776655", issue: "DISSOLVED — company dissolved in May 2026", action: "NO ACTION — removed from practice filing obligations", urgency: "CLEAR" }
];

export const VAT_TRACKER = [
  { name: "Alpha Delta Creative Ltd", due: "2026-10-07", status: "Pending", period: "Aug 2026" },
  { name: "Apex Pinnacle Logistics Ltd", due: "2026-10-07", status: "Pending", period: "Aug 2026" },
  { name: "Beacon Hill Consultancy Ltd", due: "2026-11-07", status: "Not due", period: "Sep 2026" },
  { name: "Bluebird Retail Ventures Ltd", due: "2026-10-07", status: "Ready", period: "Aug 2026" },
  { name: "Crestview Media Solutions Ltd", due: "2026-11-07", status: "Not due", period: "Sep 2026" },
  { name: "Dalton & Forge Engineering Ltd", due: "2026-10-07", status: "Queries", period: "Aug 2026" },
  { name: "Elysium Wellness Clinics Ltd", due: "2026-10-07", status: "Ready to submit", period: "Aug 2026" },
  { name: "Faraday Electrical Contractors Ltd", due: "2026-12-07", status: "Not due", period: "Oct 2026" },
  { name: "Greenfield Agritech Solutions Ltd", due: "2026-12-07", status: "Not due", period: "Oct 2026" },
  { name: "Halcyon Hospitality Group Ltd", due: "2026-10-07", status: "Pending records", period: "Aug 2026" },
  { name: "Ironclad Security Systems Ltd", due: "2026-11-07", status: "In progress", period: "Sep 2026" },
  { name: "Javelin Freight Transport Ltd", due: "2026-10-07", status: "Pending", period: "Aug 2026" },
  { name: "Kestrel Drone Imaging Ltd", due: "2026-11-07", status: "Not due", period: "Sep 2026" },
  { name: "Lunar Robotics Laboratory Ltd", due: "2026-12-07", status: "Not due", period: "Oct 2026" },
  { name: "Monarch Craft Brewers Ltd", due: "2026-10-07", status: "Overdue queries", period: "Aug 2026" },
  { name: "Nexus Digital Transformations Ltd", due: "2026-11-07", status: "In progress", period: "Sep 2026" },
  { name: "Orion Space Optics Ltd", due: "2026-10-07", status: "Ready to submit", period: "Aug 2026" },
  { name: "Palatine Architectural Design Ltd", due: "2026-11-07", status: "Not due", period: "Sep 2026" }
];

export const INITIAL_CLIENTS = [
  {
    id: "cl-1",
    name: "Woofington Park Limited",
    biz: "Trinova Accounting",
    no: "12345678",
    year: "2025-11-30",
    accounts: "2026-08-31",
    confirm: "2026-09-15",
    vat: "Yes",
    vatNo: "GB 987 6543 21",
    paye: "120/WA5544",
    cis: "No",
    dirs: "Sarah Jenkins, Mark Jenkins",
    owner: "Kirsty Allen",
    risk: "High",
    notes: "Active strike-off notice served. Urgent discussion required with Sarah."
  },
  {
    id: "cl-2",
    name: "R GB Elevations Ltd",
    biz: "Trinova Accounting",
    no: "08923412",
    year: "2025-10-31",
    accounts: "2026-07-31",
    confirm: "2026-11-12",
    vat: "Yes",
    vatNo: "GB 876 5432 10",
    paye: "951/RG8822",
    cis: "Subcontractor",
    dirs: "Robert Brown",
    owner: "Hamza Malik",
    risk: "High",
    notes: "Overdue statutory accounts. Awaiting final Q4 statements."
  },
  {
    id: "cl-3",
    name: "Alpha Delta Creative Ltd",
    biz: "Trinova Accounting",
    no: "11223344",
    year: "2025-12-31",
    accounts: "2026-09-30",
    confirm: "2026-10-15",
    vat: "Yes",
    vatNo: "GB 765 4321 09",
    paye: "441/AD1122",
    cis: "No",
    dirs: "Amanda Smith",
    owner: "Kirsty Allen",
    risk: "Medium",
    notes: "Year-end accounts draft awaiting Amanda's confirmation."
  },
  {
    id: "cl-4",
    name: "CFI Awarding Body Ltd",
    biz: "CFI Awarding",
    no: "07788991",
    year: "2026-03-31",
    accounts: "2026-12-31",
    confirm: "2026-11-30",
    vat: "Yes",
    vatNo: "GB 654 3210 98",
    paye: "552/CF9900",
    cis: "No",
    dirs: "Kirsty Allen, David Foster",
    owner: "Kirsty Allen",
    risk: "Low",
    notes: "Regulatory compliance audit scheduled for November."
  },
  {
    id: "cl-5",
    name: "Yellow Brick Creative Agency Ltd",
    biz: "The Thinking Tent / Yellow Brick",
    no: "05556677",
    year: "2026-02-28",
    accounts: "2026-11-30",
    confirm: "2026-10-28",
    vat: "Yes",
    vatNo: "GB 543 2109 87",
    paye: "331/YB4455",
    cis: "No",
    dirs: "Kirsty Allen",
    owner: "Kirsty Allen",
    risk: "Low",
    notes: "Internal business entity. Creative consulting and branding services."
  },
  {
    id: "cl-6",
    name: "MTDflow Systems Ltd",
    biz: "MTDflow",
    no: "13579246",
    year: "2026-04-30",
    accounts: "2027-01-31",
    confirm: "2026-12-05",
    vat: "Yes",
    vatNo: "GB 432 1098 76",
    paye: "772/MT3322",
    cis: "No",
    dirs: "Kirsty Allen, Tech Partner",
    owner: "Kirsty Allen",
    risk: "Medium",
    notes: "SaaS platform for Making Tax Digital compliance workflows."
  }
];

export const TOP3_ITEMS = [
  { rank: 1, title: "Woofington Park — Active Strike-Off Defense", desc: "First Gazette notice published. Objection window closes in 6 days. Accounts must be lodged.", isRed: true },
  { rank: 2, title: "R GB Elevations — Overdue Accounts & Penalty", desc: "Accounts are 50 days overdue. £375 penalty tier already triggered. Final bank queries pending.", isRed: true },
  { rank: 3, title: "Alpha Delta Creative — September Accounts Due", desc: "Accounts filing deadline is in 11 days. Draft prepared and waiting client sign-off.", isRed: false }
];

export const DIARY_ITEMS = [
  { time: "10:00 - 11:00", title: "CFI Awarding Board Governance Call", chip: "TODAY" },
  { time: "13:30 - 14:15", title: "Hamza Malik — Trinova Compliance & Staff Review", chip: "TODAY" },
  { time: "16:00 - 16:30", title: "Sarah Jenkins (Woofington Park) Urgent Strike-Off Briefing", chip: "URGENT" }
];

export const WAITING_SIGNOFF = [
  { title: "Alpha Delta Creative Ltd — 2025 Year End Accounts", sub: "Waiting director signature via portal · Sent 3 days ago", date: "Due in 11d" },
  { title: "Elysium Wellness Clinics — Engagement Letter & 64-8", sub: "Waiting Dr. Rachel Green countersignature · Sent yesterday", date: "Due in 5d" }
];

export const ATTENTION_EMAILS = [
  { title: "HMRC Compliance: Woofington Park Strike-Off Objection", sub: "Automated alert: Urgent action required before gazette strike-off", priority: "High" },
  { title: "Robert Brown (R GB Elevations): Bank Statements Attached", sub: "Statements for Oct-Dec provided; ready for accounts wrap-up", priority: "Normal" }
];

export const PEOPLE_WORK = [
  {
    id: "p-1",
    name: "Hamza Malik",
    role: "Senior Client Manager / Partner",
    avatar: "HM",
    tasks: [
      { client: "R GB Elevations Ltd", task: "Complete overdue accounts reconciliation", stage: "Drafting", deadline: "Today", isBlocked: false },
      { client: "Alpha Delta Creative", task: "Chase Amanda Smith for signing", stage: "Client Review", deadline: "In 2 days", isBlocked: false }
    ],
    ceoNote: "Agreed to follow up personally on R GB Elevations today."
  },
  {
    id: "p-2",
    name: "Jessica Taylor",
    role: "Tax & Compliance Senior",
    avatar: "JT",
    tasks: [
      { client: "Woofington Park Limited", task: "Prepare emergency Companies House accounts submission", stage: "Emergency Prep", deadline: "Today", isBlocked: true, blocker: "Awaiting signed balance sheet" },
      { client: "CFI Awarding Body", task: "VAT return submission Q3", stage: "Review", deadline: "In 7 days", isBlocked: false }
    ],
    ceoNote: "Jessica is handling the technical CH objection paperwork."
  }
];
