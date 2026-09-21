# Field Mapping: Sloane ⇄ Trinova

> **Authority:** Derived from `context/06_testing_deployment_context.md` §2 and `context/04_backend_integration_context.md` §4–5.  
> **Status:** Draft / Baseline Specification. Trinova source table/column names and physical database types are marked as `[PENDING: Trinova repo inspection]` to strictly avoid inventing unverified schema names.

---

## 1. Clients & Companies

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: client_id]` | `clientId` / `client.id` | Read | String / UUID | Required | Stable internal identifier; string format | Non-empty valid identifier | Client anchor |
| `[PENDING: company_id]` | `companyId` / `client.companyId` | Read | String / UUID | Required | Stable internal identifier; string format | Non-empty valid identifier | One client → Many companies |
| `[PENDING: company_name]` | `name` / `company_name` | Read | String | Required | Trim whitespace; preserve legal suffix | Max length 255 | Attribute of Company |
| `[PENDING: company_number]` | `no` / `company_number` | Read | String | Optional | 8-character string (zero-padded where applicable); uppercase | Alphanumeric (UK CRN, 8 chars) | Attribute of Company |
| `[PENDING: accounting_reference_date]` | `year` / `year_end` | Read | String (Date) | Optional | ISO `YYYY-MM-DD` | Valid calendar date | Attribute of Company |
| `[PENDING: vat_registered]` | `vat` | Read | Boolean / Enum | Optional | Map boolean / enum to `'Yes'/'No'` | Valid boolean/enum | Attribute of Company |
| `[PENDING: vat_number]` | `vatNo` | Read | String | Optional | Trim; strip spaces | 9-digit GB format or country code prefixed | Attribute of Company |
| `[PENDING: paye_registered]` | `paye` | Read | Boolean / String | Optional | Map to string / status indicator | Alphanumeric | Attribute of Company |
| `[PENDING: cis_status]` | `cis` | Read | Enum | Optional | Map to `'No'/'Contractor'/'Subcontractor'/'Both'` | Strict enum match | Attribute of Company |
| `[PENDING: internal_owner_id]` | `owner` | Read | String (User name) | Optional | Resolve Trinova staff user ID to display name | Valid user reference | Company → Assigned Staff |
| `[PENDING: client_risk_level]` | `risk` | Read | Enum | Optional | Map to `'Low'/'Medium'/'High'` | Strict enum match | Attribute of Company/Client |

---

## 2. Directors & Shareholders

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: officer_id]` | `officers[].id` | Read | String / UUID | Required | Stable officer identifier | Valid ID | Officer identifier |
| `[PENDING: officer_name]` | `officers[].name` | Read | String | Required | Full display name | Non-empty string | Company → Many officers |
| `[PENDING: officer_role]` | `officers[].role` | Read | Enum / String | Required | `'Director'`, `'Shareholder'`, `'Secretary'`, or `'Both'` | Permitted role enum | Attribute of Officer |
| `[PENDING: appointment_date]` | `officers[].appointedOn` | Read | String (Date) | Optional | ISO `YYYY-MM-DD` | Valid calendar date | Attribute of Officer |
| `[PENDING: shareholding_pct]` | `officers[].shares` | Read | Decimal / String | Optional | Formatted percentage or share count | Numeric >= 0 | Attribute of Shareholder |
| `[PENDING: is_active]` | `officers[].isActive` | Read | Boolean | Required | Active status flag | Boolean | Attribute of Officer |

*Note: In the Sloane prototype, directors were stored as a flat string (`dirs`). In production, this structured array replaces the flat string.*

---

## 3. Contacts

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: contact_id]` | `contacts[].id` | Read | String / UUID | Required | Stable contact identifier | Valid ID | Contact identifier |
| `[PENDING: contact_name]` | `contacts[].name` | Read | String | Required | Full name | Non-empty string | Client/Company → Many contacts |
| `[PENDING: contact_email]` | `contacts[].email` | Read | String | Optional | Lowercase trimmed | Valid email format | Attribute of Contact |
| `[PENDING: contact_phone]` | `contacts[].phone` | Read | String | Optional | International or standard UK format | Valid phone format | Attribute of Contact |
| `[PENDING: is_primary_contact]` | `contacts[].isPrimary` | Read | Boolean | Required | Boolean flag | Exactly one primary per entity | Attribute of Contact |

---

## 4. Services & Team Assignments

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: service_id]` | `services[].id` | Read | String / UUID | Required | Stable service identifier | Valid ID | Service identifier |
| `[PENDING: service_name]` | `services[].name` | Read | String | Required | e.g. "Year End Accounts", "VAT Returns", "Payroll" | Permitted service list | Company → Many services |
| `[PENDING: service_status]` | `services[].status` | Read | Enum / String | Required | Active, Paused, Terminated | Permitted status | Attribute of Service |
| `[PENDING: assigned_user_id]` | `services[].assigneeId` | Read | String / UUID | Optional | Team member identifier | Valid user ID | Service → Assigned Staff |
| `[PENDING: assigned_user_name]` | `services[].assigneeName` | Read | String | Optional | Display name | Non-empty string | Denormalized / Resolved name |

---

## 5. Workflow & Tasks

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: task_id]` | `tasks[].id` | Read | String / UUID | Required | Stable task identifier | Valid ID | Task anchor |
| `[PENDING: task_title]` | `tasks[].title` | Both | String | Required | Task headline | Max length 255 | Attribute of Task |
| `[PENDING: task_description]` | `tasks[].description` | Both | String | Optional | Rich text or plain text description | Text | Attribute of Task |
| `[PENDING: task_due_date]` | `tasks[].dueDate` | Both | String (Date) | Optional | ISO `YYYY-MM-DD` | Valid calendar date | Attribute of Task |
| `[PENDING: task_status]` | `tasks[].status` | Both | Enum | Required | Map to Trinova permitted statuses (`Pending`, `In_Progress`, `Completed`, etc.) | Must use Trinova portal status rules | Attribute of Task |
| `[PENDING: task_completion_rule]`| `tasks[].completion` | Write | Object / Enum | Optional | Completion payload required by Trinova | Enforce Trinova completion rules | Attribute of Task |
| `[PENDING: task_company_id]` | `tasks[].companyId` | Both | String / UUID | Required | Links task to company | Must exist in Trinova | Task → Company |
| `[PENDING: task_creator_id]` | `tasks[].creatorId` | Read | String / UUID | Required | Recorded acting user ID | Authorised user | Task → User |
| `[PENDING: idempotency_key]` | `idempotencyKey` | Write (Header) | String (UUID) | Required (on create) | Prevent duplicate task creation | Valid UUID v4 | Request-level header |

---

## 6. Document Requests

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: request_id]` | `docRequests[].id` | Read | String / UUID | Required | Stable request identifier | Valid ID | Request anchor |
| `[PENDING: request_title]` | `docRequests[].title` | Read | String | Required | Item requested from client | Non-empty string | Attribute of Request |
| `[PENDING: request_status]` | `docRequests[].status` | Read | Enum | Required | `Pending`, `Received`, `Overdue` | Permitted enum | Attribute of Request |
| `[PENDING: request_due_date]` | `docRequests[].dueDate`| Read | String (Date) | Optional | ISO `YYYY-MM-DD` | Valid calendar date | Attribute of Request |
| `[PENDING: request_company_id]` | `docRequests[].companyId` | Read | String / UUID | Required | Linked company | Valid company ID | Request → Company |

---

## 7. Messages & Conversations

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: conversation_id]` | `conversations[].id` | Read | String / UUID | Required | Conversation thread identifier | Valid ID | Thread anchor |
| `[PENDING: conversation_subject]`| `conversations[].subject`| Read | String | Optional | Thread subject line | Max length 255 | Attribute of Thread |
| `[PENDING: message_id]` | `messages[].id` | Read | String / UUID | Required | Message identifier | Valid ID | Message anchor |
| `[PENDING: message_body]` | `messages[].body` | Both | String | Required | Message text content | Non-empty | Thread → Many messages |
| `[PENDING: message_sender_id]` | `messages[].senderId` | Both | String / UUID | Required | Author ID | Authorised actor ID | Message → User |
| `[PENDING: message_created_at]`| `messages[].createdAt`| Read | String (ISO) | Required | ISO 8601 UTC timestamp | Valid timestamp | Attribute of Message |
| `[PENDING: idempotency_key]` | `idempotencyKey` | Write (Header) | String (UUID) | Required (on send) | Prevent duplicate message send | Valid UUID v4 | Request-level header |

---

## 8. Documents

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: document_id]` | `documents[].id` | Read | String / UUID | Required | Stable document identifier | Valid ID | Document anchor |
| `[PENDING: document_name]` | `documents[].name` | Both | String | Required | Original filename | Allowed filename characters | Attribute of Document |
| `[PENDING: document_mime]` | `documents[].mimeType`| Both | String | Required | MIME type string | Whitelisted file types | Attribute of Document |
| `[PENDING: document_size]` | `documents[].size` | Read | Integer (Bytes)| Required | Byte size | Positive integer <= max upload limit | Attribute of Document |
| `[PENDING: document_category]`| `documents[].category`| Both | String / Enum | Optional | Tax, Statutory, Payroll, Permanent | Permitted category | Attribute of Document |
| `[PENDING: document_company_id]`| `documents[].companyId`| Both | String / UUID | Required | Target company folder | Valid company ID | Document → Company |
| `[PENDING: document_storage_path]`| `documents[].downloadUrl`| Read | String (URL) | Required | Signed, time-limited download URL | Pre-signed URL; authorised access | Private storage pointer |
| `[PENDING: idempotency_key]` | `idempotencyKey` | Write (Header) | String (UUID) | Required (on upload) | Prevent duplicate document creation | Valid UUID v4 | Request-level header |

---

## 9. Activity Feed

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: activity_id]` | `activity[].id` | Read | String / UUID | Required | Activity record identifier | Valid ID | Event anchor |
| `[PENDING: activity_action]` | `activity[].action` | Read | String / Enum | Required | e.g. `document_uploaded`, `message_sent` | Permitted event types | Attribute of Activity |
| `[PENDING: activity_actor_id]`| `activity[].actorId` | Read | String / UUID | Required | User/Client who performed action | Valid actor ID | Activity → Actor |
| `[PENDING: activity_actor_name]`| `activity[].actorName`| Read | String | Optional | Display name of actor | String | Attribute of Activity |
| `[PENDING: activity_timestamp]`| `activity[].timestamp` | Read | String (ISO) | Required | ISO 8601 UTC timestamp | Valid timestamp | Attribute of Activity |
| `[PENDING: activity_company_id]`| `activity[].companyId`| Read | String / UUID | Required | Linked company | Valid company ID | Activity → Company |

---

## 10. Review & Sign-Off Items (Read Counterpart to Signing)

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: signoff_item_id]` | `signoffs[].id` | Read | String / UUID | Required | Review item identifier | Valid ID | Item anchor |
| `[PENDING: signoff_type]` | `signoffs[].type` | Read | Enum / String | Required | `'document_signature'`, `'accounts_approval'`, `'tax_return_review'` | Permitted types | Attribute of Signoff |
| `[PENDING: signoff_status]` | `signoffs[].status` | Read | Enum | Required | `Pending`, `Approved`, `Rejected`, `Signed` | Permitted status | Attribute of Signoff |
| `[PENDING: signoff_assigned_to]`| `signoffs[].assignedTo`| Read | String / UUID | Optional | Kirsty or assigned staff member ID | Valid user ID | Signoff → Staff |
| `[PENDING: signoff_company_id]`| `signoffs[].companyId` | Read | String / UUID | Required | Linked company | Valid company ID | Signoff → Company |
| `[PENDING: signoff_due_date]` | `signoffs[].dueDate` | Read | String (Date) | Optional | ISO `YYYY-MM-DD` | Valid date | Attribute of Signoff |

---

## 11. Internal Notes (Explicit User Action Only)

| Trinova field | Sloane field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `[PENDING: note_id]` | `notes[].id` | Read | String / UUID | Required | Internal note identifier | Valid ID | Note anchor |
| `[PENDING: note_content]` | `notes[].content` | Both | String | Required | Sanitized text content | Non-empty text | Attribute of Note |
| `[PENDING: note_company_id]` | `notes[].companyId` | Both | String / UUID | Required | Target company | Valid company ID | Note → Company |
| `[PENDING: note_author_id]` | `notes[].authorId` | Both | String / UUID | Required | Author user ID | Authorised actor ID | Note → User |
| `[PENDING: note_visibility]` | `notes[].visibility` | Both | Enum | Required | `staff_only` vs `client_visible` | **Pending decision: defaults to staff_only** | Attribute of Note |
| `[PENDING: note_created_at]` | `notes[].createdAt` | Read | String (ISO) | Required | ISO 8601 UTC timestamp | Valid timestamp | Attribute of Note |

---

## 12. Companies House Server-Side Reconciliation Fields

| External CH field | Sloane / Backend field | Direction | Type | Required/optional | Transformation | Validation | Relationship |
|---|---|---|---|---|---|---|---|
| `company_name` | `chLive.name` | Read | String | Required | Overrides tracker name when live | Valid company name | Company (by CRN) |
| `company_status` | `chLive.companyStatus`| Read | String | Required | e.g. `'active'`, `'dissolved'` | Normalized string | Company (by CRN) |
| `company_status_detail` | `chLive.detail` | Read | String | Optional | e.g. `'active-proposal-to-strike-off'` | Normalized string | Company (by CRN) |
| `accounts.next_accounts.due_on` | `chLive.accountsDue` | Read | String (Date) | Optional | ISO `YYYY-MM-DD` | Valid calendar date | Company (by CRN) |
| `accounts.next_accounts.overdue` | `chLive.accountsOverdue`| Read | Boolean | Optional | Boolean flag | Boolean | Company (by CRN) |
| `confirmation_statement.next_due`| `chLive.confirmDue` | Read | String (Date) | Optional | ISO `YYYY-MM-DD` | Valid calendar date | Company (by CRN) |
| `confirmation_statement.overdue` | `chLive.confirmOverdue` | Read | Boolean | Optional | Boolean flag | Boolean | Company (by CRN) |
| Server timestamp | `chLive.checked` | Read | String (ISO) | Required | Recorded check timestamp | ISO 8601 UTC | Reconciliation metadata |

---

## 13. Empty vs. Unavailable vs. Unsupported Representation Contract

Per `context/04_backend_integration_context.md` §4 and `context/06_testing_deployment_context.md` §3, API read responses must strictly differentiate these three states in JSON schemas:

1. **Empty (`null` value with field present):**
   ```json
   {
     "companyNumber": "12345678",
     "vatNumber": null
   }
   ```
   *Interpretation:* The field is supported and accessible, but contains no value in Trinova.

2. **Unavailable (`status: "unavailable"` wrapper or omission with explicit error/permission status):**
   ```json
   {
     "companyNumber": "12345678",
     "financials": {
       "status": "unavailable",
       "reason": "permission_denied"
     }
   }
   ```
   *Interpretation:* The data exists or is supported, but cannot be fetched in this request (e.g. timeout or insufficient scope).

3. **Unsupported (field completely absent from schema / schema contract specifies unsupported):**
   *Interpretation:* Trinova does not model or store this attribute. Caller must not synthesize or assume default values.
