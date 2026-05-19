'use strict';

const cds = require('@sap/cds');

module.exports = class SalesOrderService extends cds.ApplicationService {

  async init() {
    const { SalesOrders, SalesOrderItems, SalesOrderStatusHistory } = this.entities;

    // ── Before Create: auto-generate order number ──────────────────────────

    this.before('CREATE', SalesOrders, async (req) => {
      if (!req.data.orderNumber) {
        req.data.orderNumber = await _generateOrderNumber(req);
      }
      req.data.status = 'DRAFT';
    });

    // ── Before Update: block edits when not in editable state ──────────────

    this.before('UPDATE', SalesOrders, async (req) => {
      const order = await SELECT.one.from(SalesOrders, req.data.ID);
      if (order && !['DRAFT', 'REJECTED'].includes(order.status)) {
        req.error(409, `Sales order cannot be modified in status "${order.status}".`);
      }
    });

    // ── After Read: compute totals and criticality virtual field ───────────

    this.after('READ', SalesOrders, (results) => {
      for (const order of [].concat(results)) {
        order.status_criticality = _statusCriticality(order.status);
      }
    });

    // ── Action: submitForApproval ───────────────────────────────────────────

    this.on('submitForApproval', SalesOrders, async (req) => {
      const { ID } = req.params[0];
      const order = await SELECT.one.from(SalesOrders, ID).columns('*');

      if (!order) return req.error(404, 'Sales order not found.');
      if (order.status !== 'DRAFT' && order.status !== 'REJECTED') {
        return req.error(409, `Cannot submit order in status "${order.status}".`);
      }

      // Validate: must have at least one item
      const items = await SELECT.from(SalesOrderItems).where({ header_ID: ID });
      if (!items.length) {
        return req.error(422, 'Sales order must have at least one item before submission.');
      }

      const now = new Date().toISOString();
      await UPDATE(SalesOrders, ID).with({
        status: 'PENDING_APPROVAL',
        submittedBy: req.user.id,
        submittedAt: now
      });

      await _addStatusHistory(ID, order.status, 'PENDING_APPROVAL', req.user.id, null);

      return SELECT.one.from(SalesOrders, ID);
    });

    // ── Action: approve ─────────────────────────────────────────────────────

    this.on('approve', SalesOrders, async (req) => {
      const { ID } = req.params[0];
      const { comment } = req.data;
      const order = await SELECT.one.from(SalesOrders, ID);

      if (!order) return req.error(404, 'Sales order not found.');
      if (order.status !== 'PENDING_APPROVAL') {
        return req.error(409, `Cannot approve order in status "${order.status}".`);
      }

      const now = new Date().toISOString();
      await UPDATE(SalesOrders, ID).with({
        status: 'APPROVED',
        approver: req.user.id,
        approvedRejectedAt: now,
        approvalComment: comment
      });

      await _addStatusHistory(ID, 'PENDING_APPROVAL', 'APPROVED', req.user.id, comment);

      // Auto-post to S/4HANA
      try {
        await _postToS4HANA(ID, req);
      } catch (err) {
        cds.log('SalesOrderService').warn('Auto-post to S4 failed, order stays Approved for manual retry:', err.message);
      }

      return SELECT.one.from(SalesOrders, ID);
    });

    // ── Action: reject ──────────────────────────────────────────────────────

    this.on('rejectOrder', SalesOrders, async (req) => {
      const { ID } = req.params[0];
      const { comment } = req.data;
      const order = await SELECT.one.from(SalesOrders, ID);

      if (!order) return req.error(404, 'Sales order not found.');
      if (order.status !== 'PENDING_APPROVAL') {
        return req.error(409, `Cannot reject order in status "${order.status}".`);
      }
      if (!comment) return req.error(422, 'A rejection comment is mandatory.');

      await UPDATE(SalesOrders, ID).with({
        status: 'REJECTED',
        approver: req.user.id,
        approvedRejectedAt: new Date().toISOString(),
        approvalComment: comment
      });

      await _addStatusHistory(ID, 'PENDING_APPROVAL', 'REJECTED', req.user.id, comment);

      return SELECT.one.from(SalesOrders, ID);
    });

    // ── Action: retract ─────────────────────────────────────────────────────

    this.on('retract', SalesOrders, async (req) => {
      const { ID } = req.params[0];
      const order = await SELECT.one.from(SalesOrders, ID);

      if (!order) return req.error(404, 'Sales order not found.');
      if (order.status !== 'PENDING_APPROVAL') {
        return req.error(409, `Cannot retract order in status "${order.status}".`);
      }
      if (order.submittedBy !== req.user.id && !req.user.is('Admin')) {
        return req.error(403, 'Only the submitter or an Admin can retract the order.');
      }

      await UPDATE(SalesOrders, ID).with({ status: 'DRAFT' });
      await _addStatusHistory(ID, 'PENDING_APPROVAL', 'DRAFT', req.user.id, 'Retracted by submitter');

      return SELECT.one.from(SalesOrders, ID);
    });

    // ── Action: postToS4HANA (manual retry) ────────────────────────────────

    this.on('postToS4HANA', SalesOrders, async (req) => {
      const { ID } = req.params[0];
      const order = await SELECT.one.from(SalesOrders, ID);

      if (!order) return req.error(404, 'Sales order not found.');
      if (!['APPROVED', 'POST_FAILED'].includes(order.status)) {
        return req.error(409, `Can only post orders in APPROVED or POST_FAILED status. Current: "${order.status}".`);
      }

      await _postToS4HANA(ID, req);

      return SELECT.one.from(SalesOrders, ID);
    });

    await super.init();
  }
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function _generateOrderNumber(req) {
  const year = new Date().getFullYear().toString().slice(-2);
  try {
    const db = await cds.connect.to('db');
    const { SalesOrderHeaders } = db.model.entities('com.sap.btp.salesorder');
    const [{ cnt }] = await db.run(SELECT`count(*) as cnt`.from(SalesOrderHeaders));
    const seq = String((Number(cnt) ?? 0) + 1).padStart(7, '0');
    return `${year}${seq}`;
  } catch {
    // Fallback: timestamp-based
    return `${year}${Date.now().toString().slice(-7)}`;
  }
}

function _statusCriticality(status) {
  const map = {
    DRAFT:            2,   // blue / neutral
    PENDING_APPROVAL: 3,   // orange / warning
    APPROVED:         3,   // orange (approved but not yet posted)
    REJECTED:         1,   // red / negative
    POSTED:           5,   // green / positive
    POST_FAILED:      1    // red
  };
  return map[status] ?? 0;
}

async function _addStatusHistory(headerID, fromStatus, toStatus, user, comment) {
  await INSERT.into('com_sap_btp_salesorder_SalesOrderStatusHistory').entries({
    ID: cds.utils.uuid(),
    header_ID: headerID,
    fromStatus,
    toStatus,
    changedBy: user,
    changedAt: new Date().toISOString(),
    comment
  });
}

async function _postToS4HANA(orderID, req) {
  const { SalesOrders, SalesOrderItems } = cds.db.model.entities('com.sap.btp.salesorder');

  const [order, items] = await Promise.all([
    SELECT.one.from(SalesOrders, orderID),
    SELECT.from(SalesOrderItems).where({ header_ID: orderID })
  ]);

  // Build S/4HANA payload aligned to API_SALES_ORDER_SRV
  const s4Payload = {
    SalesOrderType:       order.orderType,
    SalesOrganization:    order.salesOrganization,
    DistributionChannel:  order.distributionChannel,
    OrganizationDivision: order.division,
    PurchaseOrderByCustomer: order.purchaseOrderByCustomer || '',
    RequestedDeliveryDate: order.requestedDeliveryDate
      ? `/Date(${new Date(order.requestedDeliveryDate).getTime()})/`
      : undefined,
    to_Partner: {
      results: _buildPartnerItems(order)
    },
    to_Item: {
      results: items.map((item, idx) => ({
        SalesOrderItem:       String((idx + 1) * 10).padStart(6, '0'),
        Material:             item.material,
        SalesOrderItemText:   item.materialDescription || '',
        RequestedQuantity:    String(item.requestedQuantity),
        RequestedQuantityUnit: item.quantityUnit,
        ItemGrossWeight:      '0',
        Plant:                item.plant || ''
      }))
    }
  };

  let s4SalesOrderNumber, postError;

  try {
    const s4 = await cds.connect.to('s4hana');
    const response = await s4.post('/A_SalesOrder', s4Payload);
    s4SalesOrderNumber = response?.SalesOrder;

    await UPDATE(SalesOrders, orderID).with({
      status: 'POSTED',
      s4SalesOrder: s4SalesOrderNumber,
      s4PostedAt: new Date().toISOString(),
      s4PostError: null
    });

    await _addStatusHistory(orderID, 'APPROVED', 'POSTED', req.user?.id ?? 'system', `S4 Order: ${s4SalesOrderNumber}`);

    cds.log('SalesOrderService').info(`Posted to S4HANA: BTP order ${order.orderNumber} → S4 ${s4SalesOrderNumber}`);
  } catch (err) {
    postError = err.message || String(err);
    cds.log('SalesOrderService').error('S4HANA post failed:', postError);

    await UPDATE(SalesOrders, orderID).with({
      status: 'POST_FAILED',
      s4PostError: postError.substring(0, 1000)
    });

    await _addStatusHistory(orderID, 'APPROVED', 'POST_FAILED', req.user?.id ?? 'system', postError.substring(0, 500));

    throw err;
  }
}

function _buildPartnerItems(order) {
  const partners = [];
  if (order.soldToParty)  partners.push({ PartnerFunction: 'AG', Customer: order.soldToParty });
  if (order.shipToParty)  partners.push({ PartnerFunction: 'WE', Customer: order.shipToParty });
  if (order.billToParty)  partners.push({ PartnerFunction: 'RE', Customer: order.billToParty });
  if (order.payerParty)   partners.push({ PartnerFunction: 'RG', Customer: order.payerParty });
  return partners;
}
