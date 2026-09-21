# Unit 02: Client, Company & Entity Read Endpoints

## 1. Goal
Implement the versioned read API endpoints (`GET /api/v1/clients`, `GET /api/v1/clients/{id}`, `GET /api/v1/companies/{id}`) returning structured client, company, director, shareholder, contact, and service records, explicitly differentiating empty, unavailable, and unsupported fields.

## 2. Design
- **Read Contract:** Per `context/04_backend_integration_context.md` §4, Sloane must read client ID, company ID, company name, company number, directors/shareholders, contacts, services, team assignments, and sign-off items.
- **Structured Relations:** Per `04_backend_integration_context.md` §4 and `01_product_context.md` §Client 360, structured arrays replace the prototype's flat text fields (e.g. multiple directors and contacts linked to stable company IDs).
- **Data State Distinction:** Per `04_backend_integration_context.md` §4, API responses must cleanly distinguish genuinely empty fields (`null`), unavailable fields (`unavailable` status wrapper), and unsupported attributes (absent).
- **Stable IDs:** Per `04_backend_integration_context.md` §6, all entity references must use stable internal IDs, never names.

## 3. Implementation
### 3.1 Client & Company Listing and Detail Endpoints
- Implement `GET /api/v1/clients` with cursor/page pagination, text filter, and business area query parameters.
- Implement `GET /api/v1/clients/{id}` returning client details, linked companies array, and primary contacts.
- Implement `GET /api/v1/companies/{id}` returning company profile (CRN, accounting reference date, VAT/PAYE/CIS status), directors/shareholders array, contacts array, and assigned services.

### 3.2 Structured Entities Serialization
- Serialize directors and shareholders into structured objects (`id`, `name`, `role`, `appointedOn`, `shares`, `isActive`).
- Serialize contacts into structured objects (`id`, `name`, `email`, `phone`, `isPrimary`).
- Link all records to stable parent IDs (`clientId`, `companyId`).

### 3.3 Three-State Data Handling
- Return `null` for fields that are present in schema but empty in Trinova.
- Return structured unavailable metadata for fields where access was denied or failed temporarily.
- Never invent or synthesize values for missing database records.

## 4. Dependencies
- Trinova database schema models (Client, Company, Director, Contact, Service).
- Auth middleware from Unit 01.
- Pagination utility supporting stable cursor or offset-based bounds.

## 5. Verification Checklist
Per `context/06_testing_deployment_context.md` §3 (Read Testing):
- [ ] Required fields (`clientId`, `companyId`, `company_name`) are present and validly typed.
- [ ] Multiple companies per client are correctly returned as a nested collection.
- [ ] Multiple directors/shareholders per company are structured as an array, not a single string.
- [ ] Multiple contacts per client/company are structured as an array with primary flag indicated.
- [ ] Truly empty fields return explicit `null`.
- [ ] Unavailable fields return explicit unavailable indicator rather than defaulting to empty string.
- [ ] Invalid or non-existent client/company IDs return `404 Not Found`.
- [ ] Pagination returns page metadata (`page`, `pageSize`, `total`, `hasMore`).
- [ ] Cross-tenant data isolation is enforced (no unauthorized entity leakage).
