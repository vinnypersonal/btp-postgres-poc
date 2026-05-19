namespace com.sap.btp.salesorder;

using { cuid, managed, sap.common } from '@sap/cds/common';

// ─── Status Code List ──────────────────────────────────────────────────────

type SalesOrderStatus : String(20) enum {
  Draft           = 'DRAFT';
  PendingApproval = 'PENDING_APPROVAL';
  Approved        = 'APPROVED';
  Rejected        = 'REJECTED';
  Posted          = 'POSTED';
  PostFailed      = 'POST_FAILED';
}

// ─── Sales Order Header (mirrors SAP VBAK) ─────────────────────────────────

entity SalesOrderHeaders : cuid, managed {
  // Document identification
  orderNumber         : String(10);                // Generated, mirrors VBELN
  orderType           : String(4) not null;        // AUART e.g. OR, ZOR
  salesOrganization   : String(4) not null;        // VKORG e.g. 1000
  distributionChannel : String(2) not null;        // VTWEG e.g. 10
  division            : String(2) not null;        // SPART e.g. 00

  // Partner data
  soldToParty         : String(10) not null;       // KUNNR
  shipToParty         : String(10);                // KUNNR for ship-to
  billToParty         : String(10);                // KUNNR for bill-to
  payerParty          : String(10);                // KUNNR for payer

  // Dates
  requestedDeliveryDate : Date;                    // VDATU
  pricingDate           : Date;                    // PRSDT
  purchaseOrderByCustomer : String(35);            // BSTNK (customer PO)

  // Values
  netAmount           : Decimal(15,2);
  taxAmount           : Decimal(15,2);
  totalAmount         : Decimal(15,2);
  currency            : String(5) default 'EUR';   // WAERK

  // Workflow
  status              : SalesOrderStatus default 'DRAFT';
  submittedBy         : String(255);
  submittedAt         : Timestamp;
  approver            : String(255);
  approvedRejectedAt  : Timestamp;
  approvalComment     : String(500);

  // S/4HANA back-reference (set after successful posting)
  s4SalesOrder        : String(10);                // VBELN from S4H
  s4PostedAt          : Timestamp;
  s4PostError         : String(1000);

  // Composition associations
  items               : Composition of many SalesOrderItems on items.header = $self;
  attachments         : Composition of many SalesOrderAttachments on attachments.header = $self;
  statusHistory       : Composition of many SalesOrderStatusHistory on statusHistory.header = $self;
}

// ─── Sales Order Items (mirrors SAP VBAP) ──────────────────────────────────

entity SalesOrderItems : cuid, managed {
  header              : Association to SalesOrderHeaders;
  itemNumber          : Integer not null;          // POSNR e.g. 10, 20, 30
  higherLevelItem     : Integer default 0;         // UEPOS (sub-items)

  // Material
  material            : String(40) not null;       // MATNR
  materialDescription : String(40);               // ARKTX
  materialGroup       : String(9);                 // MATKL

  // Quantities & Units
  requestedQuantity   : Decimal(13,3) not null;   // KWMENG
  quantityUnit        : String(3) not null;        // VRKME e.g. EA, KG, PC
  confirmedQuantity   : Decimal(13,3);             // BMENG

  // Pricing
  netPrice            : Decimal(15,2);             // NETPR
  netAmount           : Decimal(15,2);             // NETWR
  taxAmount           : Decimal(15,2);
  currency            : String(5);                 // WAERK

  // Logistics
  plant               : String(4);                 // WERKS
  storageLocation     : String(4);                 // LGORT
  shippingPoint       : String(4);                 // VSTEL
  requestedDeliveryDate : Date;                    // EDATU (item level override)
  deliveryGroup       : Integer;                   // ABGRU

  // S/4HANA item reference
  s4SalesOrderItem    : String(6);                 // POSNR from S4H
}

// ─── Attachments ────────────────────────────────────────────────────────────

entity SalesOrderAttachments : cuid, managed {
  header      : Association to SalesOrderHeaders;
  fileName    : String(255) not null;
  mimeType    : String(100);
  fileSize    : Integer;
  content     : LargeBinary @Core.MediaType: mimeType;
  url         : String(500);                       // Alternative: store in Object Store
  category    : String(50);                        // e.g. PO_DOCUMENT, SPEC, IMAGE
  description : String(200);
}

// ─── Audit / Status History ─────────────────────────────────────────────────

entity SalesOrderStatusHistory : cuid {
  header      : Association to SalesOrderHeaders;
  fromStatus  : SalesOrderStatus;
  toStatus    : SalesOrderStatus;
  changedBy   : String(255);
  changedAt   : Timestamp;
  comment     : String(500);
}
