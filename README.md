# BTP PostgreSQL POC — Sales Order CRUD + Approval + S/4HANA

A **SAP CAP (Cloud Application Programming Model)** application demonstrating:
- Full CRUD for Sales Orders (Header / Items / Attachments)
- 1-level approval workflow in BTP
- Automatic posting to **S/4HANA** via `API_SALES_ORDER_SRV` on approval
- **PostgreSQL** as the persistence layer (BTP PostgreSQL Hyperscaler Option)
- Fiori Elements UI with OData v4

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BTP LANDSCAPE                            │
│                                                                  │
│  ┌──────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │ Fiori UI │───▶│   CAP Service    │───▶│   PostgreSQL DB   │  │
│  │(Approuter│    │   (Node.js)      │    │ (BTP Hyperscaler) │  │
│  │ + UI5)   │    └────────┬─────────┘    └──────────────────┘  │
│  └──────────┘             │                                      │
│                    ┌──────▼──────────┐                          │
│                    │  Approval Flow  │  Draft → Pending →       │
│                    │  (In-App)       │  Approved/Rejected →      │
│                    └──────┬──────────┘  Posted                  │
│                           │ On Approve                           │
│                    ┌──────▼──────────────────────┐              │
│                    │  BTP Destination Service     │              │
│                    │  (SHD250SYSTEM)              │              │
│                    └──────┬──────────────────────┘              │
└───────────────────────────┼─────────────────────────────────────┘
                            │ API_SALES_ORDER_SRV (POST)
                     ┌──────▼──────┐
                     │  S/4HANA    │
                     └─────────────┘
```

---

## Status State Machine

```
DRAFT ──[submit]──▶ PENDING_APPROVAL ──[approve]──▶ APPROVED ──[auto-post]──▶ POSTED
  ▲                        │                            │
  │──────[retract]─────────┘                  [post fails]──▶ POST_FAILED ──[retry]──▶ POSTED
  │
  └────────────────[reject]─────────────────▶ REJECTED ──[edit+submit]──▶ PENDING_APPROVAL
```

---

## Data Model (SAP-aligned)

| Entity                   | SAP Table | Key Fields |
|--------------------------|-----------|------------|
| `SalesOrderHeaders`      | VBAK      | orderNumber, orderType, salesOrg, soldToParty |
| `SalesOrderItems`        | VBAP      | itemNumber, material, quantity, plant |
| `SalesOrderAttachments`  | —         | fileName, mimeType, content |
| `SalesOrderStatusHistory`| —         | fromStatus, toStatus, changedBy, comment |

---

## Local Development (SQLite in-memory)

```bash
npm install
npm run dev
```

Test users (mocked auth — no XSUAA needed locally):

| User  | Password | Roles                    |
|-------|----------|--------------------------|
| alice | alice    | SalesProcessor           |
| bob   | bob      | Approver                 |
| admin | admin    | SalesProcessor + Approver + Admin |

### Quick API test

```bash
# List orders (as alice)
curl -u alice:alice http://localhost:4004/api/sales-orders/SalesOrders

# Submit for approval
curl -u alice:alice -X POST \
  http://localhost:4004/api/sales-orders/SalesOrders(a1b2c3d4-0001-0001-0001-000000000001)/SalesOrderService.submitForApproval \
  -H "Content-Type: application/json" -d '{}'

# Approve (as bob)
curl -u bob:bob -X POST \
  http://localhost:4004/api/sales-orders/SalesOrders(a1b2c3d4-0001-0001-0001-000000000001)/SalesOrderService.approve \
  -H "Content-Type: application/json" \
  -d '{"comment": "Looks good, approved."}'

# Reject (as bob)
curl -u bob:bob -X POST \
  http://localhost:4004/api/sales-orders/SalesOrders(a1b2c3d4-0001-0001-0001-000000000001)/SalesOrderService.reject \
  -H "Content-Type: application/json" \
  -d '{"comment": "Price is too high, please revise."}'
```

---

## BTP Deployment

### Prerequisites

1. BTP subaccount with:
   - Cloud Foundry environment enabled
   - PostgreSQL Hyperscaler Option entitlement
   - Destination service entitlement
   - Connectivity service entitlement (if S/4HANA is on-premise)

2. Destination `SHD250SYSTEM` configured in BTP Destination Service:
   - Type: HTTP
   - Authentication: BasicAuthentication or OAuth2SAMLBearerAssertion
   - URL: `https://<your-s4h-host>:<port>`

3. Tools: `cf` CLI, `mbt` build tool, `cds` CLI

### Build & Deploy

```bash
# Install MTA build tool
npm install -g mbt

# Build the MTA archive
mbt build

# Login to Cloud Foundry
cf login -a https://api.cf.<region>.hana.ondemand.com

# Deploy
cf deploy mta_archives/btp-postgres-poc_1.0.0.mtar
```

### Environment Variables (production)

Set in `manifest.yml` or via CF environment:

```bash
cf set-env btp-postgres-poc-srv NODE_ENV production
```

---

## Project Structure

```
btp-postgres-poc/
├── db/
│   ├── schema.cds              # Data model (VBAK/VBAP aligned)
│   └── data/                   # Sample CSV data for local dev
├── srv/
│   ├── sales-order-service.cds # OData service + Fiori annotations
│   ├── sales-order-service.js  # Business logic + approval + S4H posting
│   ├── auth-helper.js          # Role check utilities
│   └── external/
│       └── API_SALES_ORDER.cds # S/4HANA API model (API_SALES_ORDER_SRV)
├── app/
│   └── sales-orders/           # Fiori Elements app (future)
├── .cdsrc.json                 # CDS configuration
├── mta.yaml                    # BTP MTA deployment descriptor
├── xs-security.json            # XSUAA roles & scopes
└── package.json
```

---

## S/4HANA Integration Notes

- Destination name: **SHD250SYSTEM**
- API: **API_SALES_ORDER_SRV** (`/sap/opu/odata/sap/API_SALES_ORDER_SRV`)
- Action used: `POST /A_SalesOrder` (creates header + items + partners in one call)
- The S/4 Sales Order number is stored back in `SalesOrderHeaders.s4SalesOrder`
- If posting fails: status → `POST_FAILED`, error stored in `s4PostError`
- Manual retry available via the `postToS4HANA` action

---

## Roadmap / Next Steps

- [ ] Add email notification on submit/approve/reject (BTP Alert Notification Service)
- [ ] Pricing conditions (KONP-like) on items
- [ ] Multi-level approval based on order value thresholds
- [ ] Fiori Elements app with custom actions toolbar
- [ ] Object Store integration for large attachments
- [ ] CI/CD pipeline via GitHub Actions → BTP
