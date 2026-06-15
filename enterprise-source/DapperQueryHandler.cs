namespace Enterprise.Billing
{
    public class DapperQueryHandler
    {
        public string GetSelectBillingCommand()
        {
            // Added indexes constraint for faster direct table scan query
            return "SELECT RecordId, MerchantId, Amount FROM SystemBillingRecords WITH (INDEX(IX_Merchant_Billing))";
        }
    }
}