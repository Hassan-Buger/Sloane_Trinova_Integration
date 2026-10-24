/**
 * Sloane's working data set.
 *
 * `mockDb` (kept under this name for the routes and tests that import it) is the in-memory
 * working copy of everything Sloane stores itself: businesses, clients added in Sloane, tasks,
 * notes, documents, history, team, deadlines and private notes.
 *
 * - It is saved to a real database (SQLite file or Postgres via DATABASE_URL) by
 *   ./persistence.js, so nothing is lost when the server restarts.
 * - Built-in EXAMPLE records (Woofington Park and friends) are only loaded when
 *   NODE_ENV=test or SLOANE_DEMO_DATA=true. A real install starts with no example data.
 */

/** The businesses a brand-new Sloane starts with. The owner can rename or remove them. */
export const DEFAULT_BUSINESSES = [
  { id: "biz-1", name: "Trinova Accounting", type: "Accountancy & Tax", status: "Active" },
  { id: "biz-2", name: "CFI Awarding", type: "Awarding Organisation", status: "Active" },
  { id: "biz-3", name: "The Thinking Tent / Yellow Brick", type: "Consultancy & Design", status: "Active" },
  { id: "biz-4", name: "MTDflow", type: "Fintech / SaaS", status: "Active" },
  { id: "biz-5", name: "Meta Digital Accounting", type: "Digital Accounting", status: "Active" },
  { id: "biz-6", name: "Other ventures & property", type: "Holdings & Investments", status: "Active" }
];

const SAMPLE_DATA = {
  // Business Areas (Practice verticals / business divisions)
  businesses: DEFAULT_BUSINESSES.map(b => ({ ...b })),

  // Clients (Top-level client entities)
  clients: [
    {
      id: "cli_woofington_grp",
      name: "Jenkins Family Holdings / Woofington Group",
      clientType: "Corporate Group",
      businessArea: "Trinova Accounting",
      status: "Active",
      assignedManagerId: "usr_kirsty_allen",
      assignedManagerName: "Kirsty Allen",
      companyIds: ["comp_woofington_park_01", "comp_jenkins_pet_02"],
      contacts: [
        {
          id: "cnt_sarah_jenkins",
          name: "Sarah Jenkins",
          email: "sarah@woofingtonpark.co.uk",
          phone: "+44 7700 900123",
          isPrimary: true
        },
        {
          id: "cnt_mark_jenkins",
          name: "Mark Jenkins",
          email: "mark@woofingtonpark.co.uk",
          phone: "+44 7700 900456",
          isPrimary: false
        }
      ],
      createdAt: "2024-03-15T09:00:00.000Z"
    },
    {
      id: "cli_rgb_elevations",
      name: "R GB Elevations",
      clientType: "SME",
      businessArea: "Trinova Accounting",
      status: "Active",
      assignedManagerId: "usr_hamza_malik",
      assignedManagerName: "Hamza Malik",
      companyIds: ["comp_rgb_elevations_01"],
      contacts: [
        {
          id: "cnt_robert_brown",
          name: "Robert Brown",
          email: "robert@rgbelevations.co.uk",
          phone: "+44 7700 900789",
          isPrimary: true
        }
      ],
      createdAt: "2023-11-20T14:30:00.000Z"
    },
    {
      id: "cli_alpha_delta",
      name: "Alpha Delta Creative",
      clientType: "Design Agency",
      businessArea: "Trinova Accounting",
      status: "Active",
      assignedManagerId: "usr_kirsty_allen",
      assignedManagerName: "Kirsty Allen",
      companyIds: ["comp_alpha_delta_01"],
      contacts: [
        {
          id: "cnt_amanda_smith",
          name: "Amanda Smith",
          email: "amanda@alphadelta.co.uk",
          phone: "+44 7700 900321",
          isPrimary: true
        }
      ],
      createdAt: "2025-01-10T11:15:00.000Z"
    },
    {
      id: "cli_cfi_awarding",
      name: "CFI Awarding Body",
      clientType: "Regulated Body",
      businessArea: "CFI Awarding",
      status: "Active",
      assignedManagerId: "usr_kirsty_allen",
      assignedManagerName: "Kirsty Allen",
      companyIds: ["comp_cfi_awarding_01"],
      contacts: [
        {
          id: "cnt_david_foster",
          name: "David Foster",
          email: "david@cfiawarding.org.uk",
          phone: "+44 7700 900654",
          isPrimary: true
        }
      ],
      createdAt: "2023-05-01T10:00:00.000Z"
    }
  ],

  // Companies (Individual limited companies / statutory entities)
  companies: [
    {
      id: "comp_woofington_park_01",
      clientId: "cli_woofington_grp",
      companyName: "Woofington Park Limited",
      companyNumber: "12345678",
      accountingReferenceDate: "2025-11-30",
      accountsDueDate: "2026-08-31",
      confirmationDueDate: "2026-09-15",
      vatRegistered: true,
      vatNumber: "GB987654321",
      payeRegistered: true,
      payeReference: "120/WA5544",
      cisStatus: "No",
      riskLevel: "High",
      workflowStage: "Drafting",
      // Empty value demonstration: genuinely null/empty in DB
      secondaryVatNumber: null,
      // Unavailable value demonstration: access requires elevated clearance
      financials: {
        status: "unavailable",
        reason: "permission_denied"
      },
      officers: [
        {
          id: "off_sarah_jenkins",
          name: "Sarah Jenkins",
          role: "Director",
          appointedOn: "2019-06-12",
          shares: "60%",
          isActive: true
        },
        {
          id: "off_mark_jenkins",
          name: "Mark Jenkins",
          role: "Director / Shareholder",
          appointedOn: "2019-06-12",
          shares: "40%",
          isActive: true
        }
      ],
      services: [
        {
          id: "srv_year_end_01",
          name: "Year End Statutory Accounts",
          status: "Active",
          assigneeId: "usr_jessica_taylor",
          assigneeName: "Jessica Taylor"
        },
        {
          id: "srv_strikeoff_defense_01",
          name: "Emergency Strike-Off Defense",
          status: "In_Progress",
          assigneeId: "usr_jessica_taylor",
          assigneeName: "Jessica Taylor"
        }
      ],
      notes: "Active strike-off notice published. Emergency objection and filing in progress."
    },
    {
      id: "comp_jenkins_pet_02",
      clientId: "cli_woofington_grp",
      companyName: "Jenkins Pet Supplies Ltd",
      companyNumber: "12345679",
      accountingReferenceDate: "2026-02-28",
      accountsDueDate: "2026-11-30",
      confirmationDueDate: "2026-10-15",
      vatRegistered: false,
      vatNumber: null, // Genuinely null
      payeRegistered: false,
      payeReference: null,
      cisStatus: "No",
      riskLevel: "Low",
      workflowStage: "Onboarding",
      officers: [
        {
          id: "off_sarah_jenkins_2",
          name: "Sarah Jenkins",
          role: "Director",
          appointedOn: "2021-02-01",
          shares: "100%",
          isActive: true
        }
      ],
      services: [
        {
          id: "srv_bookkeeping_02",
          name: "Quarterly Bookkeeping",
          status: "Active",
          assigneeId: "usr_hamza_malik",
          assigneeName: "Hamza Malik"
        }
      ],
      notes: "Trading subsidiary for pet grooming consumables."
    },
    {
      id: "comp_rgb_elevations_01",
      clientId: "cli_rgb_elevations",
      companyName: "R GB Elevations Ltd",
      companyNumber: "08923412",
      accountingReferenceDate: "2025-10-31",
      accountsDueDate: "2026-07-31",
      confirmationDueDate: "2026-11-12",
      vatRegistered: true,
      vatNumber: "GB876543210",
      payeRegistered: true,
      payeReference: "951/RG8822",
      cisStatus: "Subcontractor",
      riskLevel: "High",
      workflowStage: "Information_Gathering",
      officers: [
        {
          id: "off_robert_brown",
          name: "Robert Brown",
          role: "Director",
          appointedOn: "2018-04-15",
          shares: "100%",
          isActive: true
        }
      ],
      services: [
        {
          id: "srv_year_end_02",
          name: "Year End Accounts & CIS Reconciliation",
          status: "Overdue",
          assigneeId: "usr_hamza_malik",
          assigneeName: "Hamza Malik"
        }
      ],
      notes: "Accounts 50 days overdue. £375 penalty incurred. Final bank queries unresolved."
    },
    {
      id: "comp_alpha_delta_01",
      clientId: "cli_alpha_delta",
      companyName: "Alpha Delta Creative Ltd",
      companyNumber: "11223344",
      accountingReferenceDate: "2025-12-31",
      accountsDueDate: "2026-09-30",
      confirmationDueDate: "2026-10-15",
      vatRegistered: true,
      vatNumber: "GB765432109",
      payeRegistered: true,
      payeReference: "441/AD1122",
      cisStatus: "No",
      riskLevel: "Medium",
      workflowStage: "Review",
      officers: [
        {
          id: "off_amanda_smith",
          name: "Amanda Smith",
          role: "Director",
          appointedOn: "2020-01-10",
          shares: "100%",
          isActive: true
        }
      ],
      services: [
        {
          id: "srv_year_end_03",
          name: "Annual Accounts & Corporation Tax",
          status: "In_Review",
          assigneeId: "usr_kirsty_allen",
          assigneeName: "Kirsty Allen"
        }
      ],
      notes: "Draft prepared; awaiting final approval before 30 September."
    },
    {
      id: "comp_cfi_awarding_01",
      clientId: "cli_cfi_awarding",
      companyName: "CFI Awarding Body Ltd",
      companyNumber: "07788991",
      accountingReferenceDate: "2026-03-31",
      accountsDueDate: "2026-12-31",
      confirmationDueDate: "2026-11-30",
      vatRegistered: true,
      vatNumber: "GB654321098",
      payeRegistered: true,
      payeReference: "552/CF9900",
      cisStatus: "No",
      riskLevel: "Low",
      workflowStage: "Drafting",
      officers: [
        {
          id: "off_kirsty_allen",
          name: "Kirsty Allen",
          role: "Director",
          appointedOn: "2015-08-01",
          shares: "50%",
          isActive: true
        },
        {
          id: "off_david_foster",
          name: "David Foster",
          role: "Director",
          appointedOn: "2015-08-01",
          shares: "50%",
          isActive: true
        }
      ],
      services: [
        {
          id: "srv_audit_compliance_01",
          name: "Regulatory Compliance & Audit",
          status: "Active",
          assigneeId: "usr_kirsty_allen",
          assigneeName: "Kirsty Allen"
        }
      ],
      notes: "Regulated awarding organisation. Annual review scheduled for Q4."
    }
  ],

  // Statutory Filing Tracker (Sourced from practice filing workbook)
  statutoryTracker: [
    { companyNumber: "12345678", name: "Woofington Park Limited", yearEnd: "2025-11-30", accountsDueDate: "2026-08-31", confirmationDueDate: "2026-09-15", status: "Draft sent to client", directors: "Sarah Jenkins, Mark Jenkins", fee: "£1,850", notes: "Active strike-off proposal flagged on Companies House" },
    { companyNumber: "08923412", name: "R GB Elevations Ltd", yearEnd: "2025-10-31", accountsDueDate: "2026-07-31", confirmationDueDate: "2026-11-12", status: "Awaiting bank statements", directors: "Robert Brown", fee: "£2,400", notes: "Accounts currently overdue" },
    { companyNumber: "11223344", name: "Alpha Delta Creative Ltd", yearEnd: "2025-12-31", accountsDueDate: "2026-09-30", confirmationDueDate: "2026-10-15", status: "In progress", directors: "Amanda Smith", fee: "£1,500", notes: "Filing due in 11 days" },
    { companyNumber: "09876543", name: "Apex Pinnacle Logistics Ltd", yearEnd: "2025-12-31", accountsDueDate: "2026-09-30", confirmationDueDate: "2026-10-20", status: "In review", directors: "David Cole", fee: "£3,200", notes: "Filing due in 11 days" },
    { companyNumber: "10554433", name: "Beacon Hill Consultancy Ltd", yearEnd: "2026-01-31", accountsDueDate: "2026-10-31", confirmationDueDate: "2026-11-15", status: "Waiting records", directors: "Elena Rostova", fee: "£1,200", notes: "Standard cycle" },
    { companyNumber: "13445566", name: "Bluebird Retail Ventures Ltd", yearEnd: "2026-01-31", accountsDueDate: "2026-10-31", confirmationDueDate: "2026-11-20", status: "Records received", directors: "Gary Cooper", fee: "£2,100", notes: "Drafting accounts" },
    { companyNumber: "07889900", name: "Crestview Media Solutions Ltd", yearEnd: "2026-02-28", accountsDueDate: "2026-11-30", confirmationDueDate: "2026-12-15", status: "Not started", directors: "Claire Taylor", fee: "£1,650", notes: "Target start mid-Oct" },
    { companyNumber: "14556677", name: "Dalton & Forge Engineering Ltd", yearEnd: "2026-02-28", accountsDueDate: "2026-11-30", confirmationDueDate: "2026-12-20", status: "Queries pending", directors: "Ian Dalton", fee: "£4,500", notes: "Complex WIP valuation" },
    { companyNumber: "06554433", name: "Elysium Wellness Clinics Ltd", yearEnd: "2025-12-31", accountsDueDate: "2026-09-30", confirmationDueDate: "2026-10-25", status: "Ready to file", directors: "Dr. Rachel Green", fee: "£2,800", notes: "Awaiting final e-sign" },
    { companyNumber: "15667788", name: "Faraday Electrical Contractors Ltd", yearEnd: "2026-03-31", accountsDueDate: "2026-12-31", confirmationDueDate: "2027-01-15", status: "Not started", directors: "Thomas Edison", fee: "£1,900", notes: "Year end March" },
    { companyNumber: "05443322", name: "Greenfield Agritech Solutions Ltd", yearEnd: "2026-03-31", accountsDueDate: "2026-12-31", confirmationDueDate: "2027-01-20", status: "Not started", directors: "Fiona MacLeod", fee: "£2,200", notes: "R&D claim review required" },
    { companyNumber: "16778899", name: "Halcyon Hospitality Group Ltd", yearEnd: "2025-11-30", accountsDueDate: "2026-08-31", confirmationDueDate: "2026-09-25", status: "Client query", directors: "Marcus Vance", fee: "£5,400", notes: "PAST DATE · verify current filing status" },
    { companyNumber: "04332211", name: "Ironclad Security Systems Ltd", yearEnd: "2026-01-31", accountsDueDate: "2026-10-31", confirmationDueDate: "2026-11-30", status: "In progress", directors: "Sean Connery", fee: "£1,750", notes: "Bank reconciliation cleared" },
    { companyNumber: "17889900", name: "Javelin Freight Transport Ltd", yearEnd: "2025-12-31", accountsDueDate: "2026-09-30", confirmationDueDate: "2026-10-30", status: "Draft prepared", directors: "Oliver Twist", fee: "£3,100", notes: "Due end of month" },
    { companyNumber: "03221100", name: "Kestrel Drone Imaging Ltd", yearEnd: "2026-02-28", accountsDueDate: "2026-11-30", confirmationDueDate: "2026-12-30", status: "Not started", directors: "Peter Parker", fee: "£1,400", notes: "Asset register update needed" },
    { companyNumber: "18990011", name: "Lunar Robotics Laboratory Ltd", yearEnd: "2026-03-31", accountsDueDate: "2026-12-31", confirmationDueDate: "2027-01-30", status: "Not started", directors: "Neil Armstrong", fee: "£4,000", notes: "Innovate UK grant reconciliation" },
    { companyNumber: "02110099", name: "Monarch Craft Brewers Ltd", yearEnd: "2025-10-31", accountsDueDate: "2026-07-31", confirmationDueDate: "2026-10-01", status: "Overdue", directors: "Arthur Guinness", fee: "£2,600", notes: "PAST DATE · urgent follow up" },
    { companyNumber: "19001122", name: "Nexus Digital Transformations Ltd", yearEnd: "2026-01-31", accountsDueDate: "2026-10-31", confirmationDueDate: "2026-11-15", status: "Records received", directors: "Steve Jobs", fee: "£3,500", notes: "VAT cross-check complete" },
    { companyNumber: "01009988", name: "Orion Space Optics Ltd", yearEnd: "2025-12-31", accountsDueDate: "2026-09-30", confirmationDueDate: "2026-10-15", status: "Ready for signature", directors: "Carl Sagan", fee: "£2,900", notes: "Sent for client sign-off" },
    { companyNumber: "20112233", name: "Palatine Architectural Design Ltd", yearEnd: "2026-02-28", accountsDueDate: "2026-11-30", confirmationDueDate: "2026-12-15", status: "In progress", directors: "Zaha Hadid", fee: "£3,800", notes: "Fee quote revised" },
    { companyNumber: "88776655", name: "Old Docklands Logistics Ltd", yearEnd: "2025-12-31", accountsDueDate: "2026-09-30", confirmationDueDate: "2026-10-15", status: "Dissolved", directors: "George Miller", fee: "£0", notes: "DISSOLVED — company dissolved in May 2026" }
  ],

  // Trinova Tasks (Adhering to context/field-mapping.md §5 and 04_backend_integration_context.md §4–5)
  tasks: [
    {
      id: "tsk_woofington_emergency",
      companyId: "comp_woofington_park_01",
      companyName: "Woofington Park Limited",
      title: "Prepare emergency Companies House accounts submission",
      description: "Draft emergency objection to strike-off and file overdue balance sheet.",
      status: "In_Progress",
      priority: "High",
      dueDate: "2026-09-20",
      isBlocked: true,
      blocker: "Awaiting signed balance sheet from Sarah Jenkins",
      assigneeId: "usr_jessica_taylor",
      assigneeName: "Jessica Taylor",
      creatorId: "actor_kirsty_allen",
      creatorName: "Kirsty Allen",
      version: 1,
      createdAt: "2026-09-18T09:00:00.000Z",
      updatedAt: "2026-09-18T09:00:00.000Z"
    },
    {
      id: "tsk_rgb_reconciliation",
      companyId: "comp_rgb_elevations_01",
      companyName: "R GB Elevations Ltd",
      title: "Complete overdue accounts reconciliation",
      description: "Reconcile missing Q4 bank statements and finalize CIS deductions.",
      status: "In_Progress",
      priority: "Urgent",
      dueDate: "2026-09-19",
      isBlocked: false,
      blocker: null,
      assigneeId: "usr_hamza_malik",
      assigneeName: "Hamza Malik",
      creatorId: "actor_kirsty_allen",
      creatorName: "Kirsty Allen",
      version: 1,
      createdAt: "2026-09-17T11:30:00.000Z",
      updatedAt: "2026-09-17T11:30:00.000Z"
    },
    {
      id: "tsk_alpha_signing",
      companyId: "comp_alpha_delta_01",
      companyName: "Alpha Delta Creative Ltd",
      title: "Chase Amanda Smith for signing",
      description: "Follow up on annual accounts draft sent via portal.",
      status: "Pending",
      priority: "Medium",
      dueDate: "2026-09-21",
      isBlocked: false,
      blocker: null,
      assigneeId: "usr_hamza_malik",
      assigneeName: "Hamza Malik",
      creatorId: "actor_kirsty_allen",
      creatorName: "Kirsty Allen",
      version: 1,
      createdAt: "2026-09-19T08:15:00.000Z",
      updatedAt: "2026-09-19T08:15:00.000Z"
    },
    {
      id: "tsk_cfi_vat",
      companyId: "comp_cfi_awarding_01",
      companyName: "CFI Awarding Body Ltd",
      title: "VAT return submission Q3",
      description: "Prepare and submit regulated entity quarterly VAT return.",
      status: "Under_Review",
      priority: "Normal",
      dueDate: "2026-09-26",
      isBlocked: false,
      blocker: null,
      assigneeId: "usr_jessica_taylor",
      assigneeName: "Jessica Taylor",
      creatorId: "actor_kirsty_allen",
      creatorName: "Kirsty Allen",
      version: 1,
      createdAt: "2026-09-15T14:00:00.000Z",
      updatedAt: "2026-09-15T14:00:00.000Z"
    }
  ],

  // Trinova Conversations & Threads (context/field-mapping.md §7)
  conversations: [
    {
      id: "conv_woofington_emergency",
      companyId: "comp_woofington_park_01",
      companyName: "Woofington Park Limited",
      subject: "Urgent: Companies House Strike-Off & Accounts Objection",
      participantIds: ["usr_kirsty_allen", "usr_jessica_taylor", "cnt_sarah_jenkins"],
      lastMessageAt: "2026-09-18T16:30:00.000Z",
      messageCount: 2,
      status: "Active"
    },
    {
      id: "conv_alpha_accounts_review",
      companyId: "comp_alpha_delta_01",
      companyName: "Alpha Delta Creative Ltd",
      subject: "2025 Year End Accounts Draft Review",
      participantIds: ["usr_hamza_malik", "cnt_amanda_smith"],
      lastMessageAt: "2026-09-17T14:10:00.000Z",
      messageCount: 1,
      status: "Active"
    }
  ],

  // Trinova Portal Messages (context/field-mapping.md §7)
  messages: [
    {
      id: "msg_woof_01",
      conversationId: "conv_woofington_emergency",
      senderId: "cnt_sarah_jenkins",
      senderName: "Sarah Jenkins",
      senderType: "client",
      body: "Hi Kirsty, we received the notice from Companies House. What do we need to sign?",
      createdAt: "2026-09-18T15:20:00.000Z"
    },
    {
      id: "msg_woof_02",
      conversationId: "conv_woofington_emergency",
      senderId: "usr_kirsty_allen",
      senderName: "Kirsty Allen",
      senderType: "staff",
      body: "Sarah, Jessica is preparing the formal objection now. Please review and sign the draft balance sheet as soon as it arrives.",
      createdAt: "2026-09-18T16:30:00.000Z"
    },
    {
      id: "msg_alpha_01",
      conversationId: "conv_alpha_accounts_review",
      senderId: "usr_hamza_malik",
      senderName: "Hamza Malik",
      senderType: "staff",
      body: "Amanda, your draft accounts for year ending 31 Dec 2025 are ready in the portal for your review.",
      createdAt: "2026-09-17T14:10:00.000Z"
    }
  ],

  // Trinova Internal Company Notes (context/field-mapping.md §9)
  // Protected by privacy boundary - only written via explicit user action
  notes: [
    {
      id: "not_woof_01",
      companyId: "comp_woofington_park_01",
      companyName: "Woofington Park Limited",
      text: "Spoke with Sarah Jenkins. Strike-off was triggered by delayed filing; bank statements are now with Jessica.",
      visibility: "staff_only",
      authorId: "actor_kirsty_allen",
      authorName: "Kirsty Allen",
      explicitConfirmation: true,
      createdAt: "2026-09-18T12:00:00.000Z"
    }
  ],

  // Trinova Documents & File Metadata (context/field-mapping.md §8)
  documents: [
    {
      id: "doc_woofington_draft_balance_sheet",
      companyId: "comp_woofington_park_01",
      companyName: "Woofington Park Limited",
      filename: "Woofington_Draft_Balance_Sheet_2025.pdf",
      mimeType: "application/pdf",
      sizeBytes: 245000,
      category: "Accounts",
      uploadedBy: "Jessica Taylor",
      isOriginal: true,
      version: 1,
      storagePath: null, // Virtual seed metadata
      createdAt: "2026-09-18T10:00:00.000Z"
    },
    {
      id: "doc_alpha_year_end_accounts",
      companyId: "comp_alpha_delta_01",
      companyName: "Alpha Delta Creative Ltd",
      filename: "Alpha_Delta_Creative_Accounts_Draft.pdf",
      mimeType: "application/pdf",
      sizeBytes: 312000,
      category: "Accounts",
      uploadedBy: "Hamza Malik",
      isOriginal: true,
      version: 1,
      storagePath: null,
      createdAt: "2026-09-17T09:30:00.000Z"
    }
  ],

  // Client Timeline Events (Unified Event Model)
  timeline_events: [
    {
      id: "evt_woof_001",
      clientId: "cli_woofington_grp",
      companyId: "comp_woofington_park_01",
      eventType: "COMPANIES_HOUSE_STATUS_CHANGED",
      title: "First Gazette Notice for Strike-Off Received",
      description: "Companies House issued First Gazette notice of compulsory strike-off due to outstanding accounts.",
      occurredAt: "2026-09-18T08:30:00.000Z",
      createdAt: "2026-09-18T08:35:00.000Z",
      actorType: "companies_house",
      actorId: "ch_system",
      source: "companies_house",
      severity: "critical",
      visibility: "shared",
      externalId: "ch_gazette_not_20260918",
      metadata: {
        companyNumber: "09876543",
        gazettePublicationDate: "2026-09-18",
        noticeType: "GAZ1"
      }
    },
    {
      id: "evt_woof_003",
      clientId: "cli_woofington_grp",
      companyId: "comp_woofington_park_01",
      eventType: "DOCUMENT_UPLOADED",
      title: "Draft Balance Sheet Uploaded for Review",
      description: "Accounts preparation file 'Woofington_Draft_Balance_Sheet_2025.pdf' uploaded by Jessica Taylor.",
      occurredAt: "2026-09-18T10:00:00.000Z",
      createdAt: "2026-09-18T10:00:00.000Z",
      actorType: "user",
      actorId: "usr_jessica_taylor",
      source: "document",
      severity: "normal",
      visibility: "shared",
      externalId: "doc_woofington_draft_balance_sheet",
      metadata: {
        filename: "Woofington_Draft_Balance_Sheet_2025.pdf",
        category: "Accounts",
        sizeBytes: 245000
      }
    },
    {
      id: "evt_woof_004",
      clientId: "cli_woofington_grp",
      companyId: "comp_woofington_park_01",
      eventType: "TASK_CREATED",
      title: "Urgent Task: File Objection to Strike-Off",
      description: "Formal objection and revised accounts submission assigned to Jessica Taylor.",
      occurredAt: "2026-09-18T09:15:00.000Z",
      createdAt: "2026-09-18T09:15:00.000Z",
      actorType: "user",
      actorId: "actor_kirsty_allen",
      source: "task",
      severity: "urgent",
      visibility: "shared",
      externalId: "tsk_woofington_emergency",
      metadata: {
        dueDate: "2026-09-19",
        assigneeId: "usr_jessica_taylor"
      }
    },
    {
      id: "evt_woof_005",
      clientId: "cli_woofington_grp",
      companyId: "comp_woofington_park_01",
      eventType: "NOTE_CREATED",
      title: "Executive Staff Discussion Note",
      description: "Spoke with Sarah Jenkins. Strike-off was triggered by delayed filing; bank statements are now with Jessica.",
      occurredAt: "2026-09-18T12:00:00.000Z",
      createdAt: "2026-09-18T12:00:00.000Z",
      actorType: "user",
      actorId: "actor_kirsty_allen",
      source: "trinova",
      severity: "normal",
      visibility: "shared",
      externalId: "not_woof_01",
      metadata: {
        author: "Kirsty Allen",
        visibility: "staff_only"
      }
    },
    {
      id: "evt_woof_006",
      clientId: "cli_woofington_grp",
      companyId: null,
      eventType: "CEO_NOTE_CREATED",
      title: "Confidential CEO Strategic Assessment",
      description: "Private note: Consider restructuring Woofington holding entities in Q4 pending resolution.",
      occurredAt: "2026-09-18T13:00:00.000Z",
      createdAt: "2026-09-18T13:00:00.000Z",
      actorType: "user",
      actorId: "actor_kirsty_allen",
      source: "user",
      severity: "normal",
      visibility: "private",
      externalId: null,
      metadata: {
        category: "CEO Brain Private"
      }
    },
    {
      id: "evt_rgb_001",
      clientId: "cli_rgb_elevations",
      companyId: "comp_rgb_elevations_01",
      eventType: "STATUTORY_DEADLINE",
      title: "Statutory Accounts Overdue (50 Days)",
      description: "Accounts for period ended 2025-10-31 are now 50 days overdue. Penalty tier 2 (£375) active.",
      occurredAt: "2026-09-10T00:00:00.000Z",
      createdAt: "2026-09-10T00:01:00.000Z",
      actorType: "system",
      actorId: "sys_statutory_monitor",
      source: "system",
      severity: "urgent",
      visibility: "shared",
      externalId: "stat_rgb_accounts_2025",
      metadata: {
        overdueDays: 50,
        deadline: "2026-07-31"
      }
    },
    {
      id: "evt_rgb_002",
      clientId: "cli_rgb_elevations",
      companyId: "comp_rgb_elevations_01",
      eventType: "TASK_CREATED",
      title: "Chased Client for Bank Statements",
      description: "Robert Brown contacted regarding missing November statements.",
      occurredAt: "2026-09-16T11:00:00.000Z",
      createdAt: "2026-09-16T11:00:00.000Z",
      actorType: "user",
      actorId: "usr_hamza_malik",
      source: "task",
      severity: "normal",
      visibility: "shared",
      externalId: "tsk_rgb_chase_statements",
      metadata: {
        assignee: "Hamza Malik"
      }
    },
    {
      id: "evt_alpha_001",
      clientId: "cli_alpha_delta",
      companyId: "comp_alpha_delta_01",
      eventType: "DOCUMENT_UPLOADED",
      title: "Year End Accounts Draft Uploaded",
      description: "Alpha Delta Creative accounts draft ready for client sign-off.",
      occurredAt: "2026-09-17T09:30:00.000Z",
      createdAt: "2026-09-17T09:30:00.000Z",
      actorType: "user",
      actorId: "usr_hamza_malik",
      source: "document",
      severity: "normal",
      visibility: "shared",
      externalId: "doc_alpha_year_end_accounts",
      metadata: {
        filename: "Alpha_Delta_Creative_Accounts_Draft.pdf"
      }
    },
    {
      id: "evt_cfi_001",
      clientId: "cli_cfi_awarding",
      companyId: "comp_cfi_awarding_01",
      eventType: "VAT_DEADLINE",
      title: "Q3 Regulated Body VAT Return Due",
      description: "HMRC VAT submission scheduled for 2026-09-26.",
      occurredAt: "2026-09-15T14:00:00.000Z",
      createdAt: "2026-09-15T14:00:00.000Z",
      actorType: "system",
      actorId: "sys_vat_monitor",
      source: "system",
      severity: "normal",
      visibility: "shared",
      externalId: "vat_q3_cfi_2026",
      metadata: {
        dueDate: "2026-09-26"
      }
    }
  ]
};

/** Every list Sloane keeps. The id column is how a row is told apart when saving. */
export const COLLECTIONS = {
  businesses: { id: r => r.id },
  clients: { id: r => r.id },
  companies: { id: r => r.id },
  statutoryTracker: { id: r => r.id || r.companyNumber },
  vatReturns: { id: r => r.id },
  tasks: { id: r => r.id },
  teamMembers: { id: r => r.id },
  conversations: { id: r => r.id },
  messages: { id: r => r.id },
  notes: { id: r => r.id },
  documents: { id: r => r.id },
  timeline_events: { id: r => r.id },
  signingRequests: { id: r => r.id },
  ceoNotes: { id: r => r.id },
  clientBusiness: { id: r => r.id },
  // Deleted items, kept for 30 days so they can be put back (see services/bin.js)
  bin: { id: r => r.id },
  // Two-step sign-in: encrypted authenticator key, hashed recovery codes, trusted browsers
  security: { id: r => r.id }
};

/** Whether the built-in example records should be loaded (tests and explicit demo mode only). */
export function sampleDataEnabled() {
  // NODE_TEST_CONTEXT is set by `node --test`; test files can import this module before
  // their fixtures have had a chance to set NODE_ENV.
  return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT) || process.env.SLOANE_DEMO_DATA === 'true';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** Gives the example filing-tracker rows an id so they can be edited and removed like any other. */
function withTrackerIds(rows) {
  return rows.map(r => ({ ...r, id: r.id || `dl_${r.companyNumber}`, origin: 'sample' }));
}

/** Builds a fresh data set: either empty (real install) or with the example records. */
export function buildInitialData(withSamples = sampleDataEnabled()) {
  const data = {};
  for (const name of Object.keys(COLLECTIONS)) data[name] = [];
  data.businesses = DEFAULT_BUSINESSES.map(b => ({ ...b }));

  if (withSamples) {
    const sample = clone(SAMPLE_DATA);
    for (const name of Object.keys(sample)) data[name] = sample[name];
    data.statutoryTracker = withTrackerIds(data.statutoryTracker);
    data.teamMembers = [
      { id: 'usr_kirsty_allen', name: 'Kirsty Allen', role: 'Chief Executive', email: '' },
      { id: 'usr_jessica_taylor', name: 'Jessica Taylor', role: 'Accountant', email: '' },
      { id: 'usr_hamza_malik', name: 'Hamza Malik', role: 'Accountant', email: '' }
    ];
  }
  return data;
}

export const mockDb = buildInitialData();
export const db = mockDb;

/** Puts a fresh data set back into mockDb without replacing the object other modules hold. */
export function resetData(withSamples = sampleDataEnabled()) {
  const fresh = buildInitialData(withSamples);
  for (const name of Object.keys(COLLECTIONS)) {
    mockDb[name].length = 0;
    mockDb[name].push(...fresh[name]);
  }
  return mockDb;
}
