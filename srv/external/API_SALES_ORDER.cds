// Minimal external model for SAP API_SALES_ORDER_SRV (OData v2)
// Full API: https://api.sap.com/api/API_SALES_ORDER_SRV

service API_SALES_ORDER {

  entity A_SalesOrder {
    key SalesOrder                : String(10);
        SalesOrderType            : String(4);
        SalesOrganization         : String(4);
        DistributionChannel       : String(2);
        OrganizationDivision      : String(2);
        SalesGroup                : String(3);
        SalesOffice               : String(4);
        SalesDistrict             : String(6);
        SoldToParty               : String(10);
        PurchaseOrderByCustomer   : String(35);
        CustomerPurchaseOrderDate : Date;
        SalesOrderDate            : Date;
        TotalNetAmount            : Decimal(15, 2);
        TransactionCurrency       : String(5);
        SDDocumentReason          : String(3);
        RequestedDeliveryDate     : Date;
        ShippingCondition         : String(2);
        IncotermsClassification   : String(3);
        CustomerPaymentTerms      : String(4);
        CreatedByUser             : String(12);
        CreationDate              : Date;
        LastChangeDate            : Date;
        OverallSDProcessStatus    : String(1);

        to_Item                   : Composition of many A_SalesOrderItem on to_Item.SalesOrder = $self.SalesOrder;
        to_Partner                : Composition of many A_SalesOrderHeaderPartner on to_Partner.SalesOrder = $self.SalesOrder;
  }

  entity A_SalesOrderItem {
    key SalesOrder                : String(10);
    key SalesOrderItem            : String(6);
        SalesOrderItemCategory    : String(4);
        SalesOrderItemText        : String(40);
        PurchaseOrderByCustomer   : String(35);
        Material                  : String(40);
        MaterialByCustomer        : String(35);
        RequestedQuantity         : Decimal(13, 3);
        RequestedQuantityUnit     : String(3);
        ItemGrossWeight           : Decimal(15, 3);
        ItemNetWeight             : Decimal(15, 3);
        ItemWeightUnit            : String(3);
        NetAmount                 : Decimal(15, 2);
        TransactionCurrency       : String(5);
        Plant                     : String(4);
        StorageLocation           : String(4);
        ShippingPoint             : String(4);
        SalesOrderItemReasonCode  : String(3);
  }

  entity A_SalesOrderHeaderPartner {
    key SalesOrder       : String(10);
    key PartnerFunction  : String(2);
        Customer         : String(10);
        Supplier         : String(10);
        Personnel        : String(8);
        ContactPerson    : String(10);
  }
}
