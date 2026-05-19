'use strict';

/**
 * Role-check helpers used across service handlers.
 * In production XSUAA provides roles; in dev mocked users have them.
 */

const ROLES = {
  SALES_PROCESSOR: 'SalesProcessor',
  APPROVER: 'Approver',
  ADMIN: 'Admin'
};

function requireRole(req, ...roles) {
  const hasRole = roles.some(r => req.user.is(r));
  if (!hasRole) {
    req.error(403, `Access denied. Required role(s): ${roles.join(' or ')}`);
    return false;
  }
  return true;
}

module.exports = { ROLES, requireRole };
