using { com.sap.btp.salesorder as db } from '../db/schema';

// ─── Main Service ────────────────────────────────────────────────────────────

service SalesOrderService @(path: '/api/sales-orders') {

  // ── Header ──────────────────────────────────────────────────────────────

  @odata.draft.enabled
  @cds.redirection.target
  entity SalesOrders as projection on db.SalesOrderHeaders {
    *,
    items        : redirected to SalesOrderItems,
    attachments  : redirected to SalesOrderAttachments,
    statusHistory: redirected to SalesOrderStatusHistory
  } actions {
    // Lifecycle actions
    action submitForApproval()                    returns SalesOrders;
    action approve(comment: String(500))          returns SalesOrders;
    action rejectOrder(comment: String(500) not null) returns SalesOrders;
    action retract()                              returns SalesOrders;      // pull back from approval

    // S/4HANA posting (called automatically on approve, exposed for retry)
    action postToS4HANA()                         returns SalesOrders;
  }

  // ── Items ──────────────────────────────────────────────────────────────

  entity SalesOrderItems as projection on db.SalesOrderItems;

  // ── Attachments ────────────────────────────────────────────────────────

  entity SalesOrderAttachments as projection on db.SalesOrderAttachments;

  // ── Status History (read-only) ─────────────────────────────────────────

  @readonly
  entity SalesOrderStatusHistory as projection on db.SalesOrderStatusHistory;

  // ── Approval inbox: orders pending review ─────────────────────────────

  @readonly
  entity PendingApprovals as select from db.SalesOrderHeaders {
    ID, orderNumber, orderType, soldToParty, salesOrganization,
    totalAmount, currency, submittedBy, submittedAt, status
  } where status = 'PENDING_APPROVAL';
}

// ─── UI Annotations ──────────────────────────────────────────────────────────

annotate SalesOrderService.SalesOrders with @(
  UI.LineItem: [
    { Value: orderNumber,         Label: 'Order #' },
    { Value: orderType,           Label: 'Type' },
    { Value: soldToParty,         Label: 'Sold-To Party' },
    { Value: salesOrganization,   Label: 'Sales Org' },
    { Value: totalAmount,         Label: 'Total' },
    { Value: currency,            Label: 'Currency' },
    { Value: status,              Label: 'Status' },
    { Value: createdAt,           Label: 'Created On' }
  ],
  UI.HeaderInfo: {
    TypeName:       'Sales Order',
    TypeNamePlural: 'Sales Orders',
    Title:          { Value: orderNumber },
    Description:    { Value: soldToParty }
  },
  UI.Facets: [
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'GeneralInfo',
      Label:  'General Information',
      Target: '@UI.FieldGroup#General'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'PartnerData',
      Label:  'Partner Data',
      Target: '@UI.FieldGroup#Partners'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'ItemsSection',
      Label:  'Items',
      Target: 'items/@UI.LineItem'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'AttachmentsSection',
      Label:  'Attachments',
      Target: 'attachments/@UI.LineItem'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'ApprovalSection',
      Label:  'Approval Info',
      Target: '@UI.FieldGroup#Approval'
    },
    {
      $Type:  'UI.ReferenceFacet',
      ID:     'StatusHistorySection',
      Label:  'Status History',
      Target: 'statusHistory/@UI.LineItem'
    }
  ],
  UI.FieldGroup #General: {
    Label: 'General Information',
    Data: [
      { Value: orderNumber },
      { Value: orderType },
      { Value: salesOrganization },
      { Value: distributionChannel },
      { Value: division },
      { Value: requestedDeliveryDate },
      { Value: pricingDate },
      { Value: purchaseOrderByCustomer },
      { Value: currency },
      { Value: netAmount },
      { Value: taxAmount },
      { Value: totalAmount }
    ]
  },
  UI.FieldGroup #Partners: {
    Label: 'Partner Data',
    Data: [
      { Value: soldToParty },
      { Value: shipToParty },
      { Value: billToParty },
      { Value: payerParty }
    ]
  },
  UI.FieldGroup #Approval: {
    Label: 'Approval Details',
    Data: [
      { Value: status },
      { Value: submittedBy },
      { Value: submittedAt },
      { Value: approver },
      { Value: approvedRejectedAt },
      { Value: approvalComment },
      { Value: s4SalesOrder },
      { Value: s4PostedAt }
    ]
  }
);

annotate SalesOrderService.SalesOrderItems with @(
  UI.LineItem: [
    { Value: itemNumber,            Label: 'Item' },
    { Value: material,              Label: 'Material' },
    { Value: materialDescription,   Label: 'Description' },
    { Value: requestedQuantity,     Label: 'Quantity' },
    { Value: quantityUnit,          Label: 'UoM' },
    { Value: netPrice,              Label: 'Net Price' },
    { Value: netAmount,             Label: 'Net Amount' },
    { Value: plant,                 Label: 'Plant' }
  ]
);

annotate SalesOrderService.SalesOrderAttachments with @(
  UI.LineItem: [
    { Value: fileName,    Label: 'File Name' },
    { Value: category,    Label: 'Category' },
    { Value: mimeType,    Label: 'Type' },
    { Value: fileSize,    Label: 'Size (bytes)' },
    { Value: description, Label: 'Description' },
    { Value: createdAt,   Label: 'Uploaded On' },
    { Value: createdBy,   Label: 'Uploaded By' }
  ]
);

annotate SalesOrderService.SalesOrderStatusHistory with @(
  UI.LineItem: [
    { Value: fromStatus, Label: 'From Status' },
    { Value: toStatus,   Label: 'To Status' },
    { Value: changedBy,  Label: 'Changed By' },
    { Value: changedAt,  Label: 'Changed At' },
    { Value: comment,    Label: 'Comment' }
  ]
);
